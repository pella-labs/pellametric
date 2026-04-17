import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Event } from "@bematist/schema";
import { createLuaRateLimiter, type LuaRedis, permissiveRateLimiter } from "./auth/rateLimit";
import type { IngestKeyRow, IngestKeyStore } from "./auth/verifyIngestKey";
import { LRUCache } from "./auth/verifyIngestKey";
import { createInMemoryClickHouseWriter } from "./clickhouse";
import { type DedupStore, dedupKey, InMemoryDedupStore } from "./dedup/checkDedup";
import { resetDeps, setDeps } from "./deps";
import { assertFlagCoherence, FlagIncoherentError, parseFlags } from "./flags";
import { handle } from "./server";
import { InMemoryOrgPolicyStore } from "./tier/enforceTier";
import { type CanonicalRow, createInMemoryWalAppender, type WalAppender } from "./wal/append";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// An in-memory ingest_keys store that supports both 2-seg (legacy) and 3-seg
// bearer lookups. Seeded in beforeAll with a row for Bearer bm_test_abc.
function makeStore(rows: IngestKeyRow[]): IngestKeyStore {
  const byKey = new Map<string, IngestKeyRow>();
  const byOrg = new Map<string, IngestKeyRow>();
  for (const r of rows) {
    byKey.set(`${r.org_id}/${r.id}`, r);
    byOrg.set(r.org_id, r);
  }
  return {
    async get(orgId, keyId) {
      if (keyId === "*") return byOrg.get(orgId) ?? null;
      return byKey.get(`${orgId}/${keyId}`) ?? null;
    },
  };
}

function makePolicyStore(
  seed: Record<string, { tier_c_managed_cloud_optin: boolean; tier_default: "A" | "B" | "C" }>,
): InMemoryOrgPolicyStore {
  const store = new InMemoryOrgPolicyStore();
  for (const [orgId, policy] of Object.entries(seed)) {
    store.seed(orgId, policy);
  }
  return store;
}

beforeAll(() => {
  // Seed a legacy 2-seg key: bm_test_abc (orgId=test, secret=abc).
  const row: IngestKeyRow = {
    id: "legacy_test_key",
    org_id: "test",
    engineer_id: "eng_test",
    key_sha256: hashSecret("abc"),
    tier_default: "B",
    revoked_at: null,
  };
  setDeps({
    store: makeStore([row]),
    cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
    rateLimiter: permissiveRateLimiter(),
    orgPolicyStore: makePolicyStore({
      test: { tier_c_managed_cloud_optin: false, tier_default: "B" },
    }),
    dedupStore: new InMemoryDedupStore(),
    wal: createInMemoryWalAppender(),
  });
});

function makeEvent(overrides: Partial<Event> = {}): Event {
  // Randomize session_id so tests don't collide on the shared dedupStore
  // (Phase-3). Tests that need a stable session_id pass it in overrides.
  return {
    client_event_id: crypto.randomUUID(),
    schema_version: 1,
    ts: "2026-04-16T12:00:00.000Z",
    tenant_id: "org_abc",
    engineer_id: "eng_hash_xyz",
    device_id: "device_1",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier: "B",
    session_id: `sess_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    event_seq: 0,
    dev_metrics: { event_kind: "llm_request" },
    ...overrides,
  };
}

function postEvents(
  body: unknown,
  auth: string | null = "Bearer bm_test_abc",
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...extraHeaders,
  };
  if (auth) headers.authorization = auth;
  return handle(
    new Request("http://localhost/v1/events", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("ingest server", () => {
  test("GET /healthz returns 200 ok", async () => {
    const res = await handle(new Request("http://localhost/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /v1/events returns 405 (wrong method)", async () => {
    const res = await handle(new Request("http://localhost/v1/events"));
    expect(res.status).toBe(405);
  });

  test("unknown route returns 404", async () => {
    const res = await handle(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });

  test("POST /v1/events without Authorization returns 401", async () => {
    const res = await handle(
      new Request("http://localhost/v1/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: [makeEvent()] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("POST /v1/events with malformed Authorization returns 401", async () => {
    const res = await postEvents({ events: [makeEvent()] }, "Basic xxx");
    expect(res.status).toBe(401);
  });

  test("POST /v1/events with valid Bearer + valid event → 202 { accepted: 1 }", async () => {
    const res = await postEvents({ events: [makeEvent()] });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: number; deduped: number; request_id: string };
    expect(body.accepted).toBe(1);
    expect(body.deduped).toBe(0);
    expect(typeof body.request_id).toBe("string");
    expect(body.request_id.length).toBeGreaterThan(0);
  });

  test("POST /v1/events with malformed event (missing client_event_id) → 400", async () => {
    const { client_event_id: _omit, ...ev } = makeEvent();
    const res = await postEvents({ events: [ev] });
    // All-invalid batch → 400 per contract 02 §Response codes.
    expect(res.status).toBe(400);
  });

  test("POST /v1/events with partial-invalid batch → 207", async () => {
    const good = makeEvent();
    const { client_event_id: _omit, ...bad } = makeEvent();
    const res = await postEvents({ events: [good, bad] });
    expect(res.status).toBe(207);
    const body = (await res.json()) as { accepted: number; rejected: unknown[] };
    expect(body.accepted).toBe(1);
    expect(body.rejected.length).toBe(1);
  });

  test("POST /v1/events with invalid JSON → 400", async () => {
    const res = await postEvents("{not json", "Bearer bm_test_abc");
    expect(res.status).toBe(400);
  });

  test("POST /v1/events without events array → 400", async () => {
    const res = await postEvents({ foo: "bar" });
    expect(res.status).toBe(400);
  });

  test("POST /v1/events with >1000 events → 413", async () => {
    const events = Array.from({ length: 1001 }, () => makeEvent());
    const res = await postEvents({ events });
    expect(res.status).toBe(413);
  });

  // --- Phase 1 additions --------------------------------------------------

  test("POST /v1/events with unknown orgId (store miss) → 401", async () => {
    const res = await postEvents({ events: [makeEvent()] }, "Bearer bm_unknownorg_abc");
    expect(res.status).toBe(401);
  });

  test("POST /v1/events with revoked key → 401", async () => {
    // Scope-local override of deps for this test only.
    const row: IngestKeyRow = {
      id: "revoked",
      org_id: "revokedorg",
      engineer_id: "eng",
      key_sha256: hashSecret("abc"),
      tier_default: "B",
      revoked_at: new Date("2026-01-01T00:00:00Z"),
    };
    setDeps({
      store: makeStore([row]),
      cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
    });
    const res = await postEvents({ events: [makeEvent()] }, "Bearer bm_revokedorg_abc");
    expect(res.status).toBe(401);
    // restore baseline
    resetDeps();
    beforeAllReseed();
  });

  test("POST /v1/events with correct key but wrong secret (hash mismatch) → 401", async () => {
    const row: IngestKeyRow = {
      id: "k1",
      org_id: "mismatchorg",
      engineer_id: "eng",
      key_sha256: hashSecret("correct-secret"),
      tier_default: "B",
      revoked_at: null,
    };
    setDeps({
      store: makeStore([row]),
      cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
    });
    const res = await postEvents({ events: [makeEvent()] }, "Bearer bm_mismatchorg_WRONG");
    expect(res.status).toBe(401);
    resetDeps();
    beforeAllReseed();
  });

  test("POST /v1/events with LRU cache hit → store queried once across two calls", async () => {
    let storeCalls = 0;
    const row: IngestKeyRow = {
      id: "cachekey",
      org_id: "cacheorg",
      engineer_id: "eng",
      key_sha256: hashSecret("abc"),
      tier_default: "B",
      revoked_at: null,
    };
    const store: IngestKeyStore = {
      async get(orgId, keyId) {
        storeCalls++;
        if (orgId === "cacheorg" && (keyId === "*" || keyId === "cachekey")) return row;
        return null;
      },
    };
    setDeps({
      store,
      cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
      orgPolicyStore: makePolicyStore({
        cacheorg: { tier_c_managed_cloud_optin: false, tier_default: "B" },
      }),
    });
    await postEvents({ events: [makeEvent()] }, "Bearer bm_cacheorg_abc");
    await postEvents({ events: [makeEvent()] }, "Bearer bm_cacheorg_abc");
    expect(storeCalls).toBe(1);
    resetDeps();
    beforeAllReseed();
  });

  test("POST /v1/events with rate-limit exhausted → 429 with Retry-After", async () => {
    const t = 1_000_000;
    const fakeRedis = makeFakeLuaRedis({ nowMs: () => t });
    const limiter = createLuaRateLimiter(fakeRedis, 2, 1); // capacity 2, refill 1 tok/s
    setDeps({ rateLimiter: limiter });
    const ok1 = await postEvents({ events: [makeEvent()] });
    expect(ok1.status).toBe(202);
    const ok2 = await postEvents({ events: [makeEvent()] });
    expect(ok2.status).toBe(202);
    const denied = await postEvents({ events: [makeEvent()] });
    expect(denied.status).toBe(429);
    const retryAfter = denied.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter ?? "0", 10)).toBeGreaterThan(0);
    resetDeps();
    beforeAllReseed();
  });

  test("POST /v1/events with 100 successive allowed calls at cost=1 all 202", async () => {
    const fakeRedis = makeFakeLuaRedis();
    const limiter = createLuaRateLimiter(fakeRedis, 1000, 1000);
    setDeps({ rateLimiter: limiter });
    for (let i = 0; i < 100; i++) {
      const r = await postEvents({ events: [makeEvent()] });
      expect(r.status).toBe(202);
    }
    resetDeps();
    beforeAllReseed();
  });

  // --- Phase 2 additions (tier enforcement + forbidden fields) -------------

  test("Phase 2 (a) POST event with top-level prompt_text (Tier B) → 400 FORBIDDEN_FIELD", async () => {
    const bad = { ...makeEvent(), prompt_text: "secret" };
    const res = await postEvents({ events: [bad] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; field: string };
    expect(body.code).toBe("FORBIDDEN_FIELD");
    expect(body.field).toBe("prompt_text");
  });

  test("Phase 2 (b) POST event tier=C with opt-in=true → 202", async () => {
    // Seed key + policy for a fresh org with opt-in on.
    const row: IngestKeyRow = {
      id: "cinkey",
      org_id: "cintenant",
      engineer_id: "eng",
      key_sha256: hashSecret("abc"),
      tier_default: "C",
      revoked_at: null,
    };
    setDeps({
      store: makeStore([row]),
      cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
      orgPolicyStore: makePolicyStore({
        cintenant: { tier_c_managed_cloud_optin: true, tier_default: "C" },
      }),
    });
    const ev: Event = { ...makeEvent({ tier: "C" }), prompt_text: "legit-content" };
    const res = await postEvents({ events: [ev] }, "Bearer bm_cintenant_abc");
    expect(res.status).toBe(202);
    resetDeps();
    beforeAllReseed();
  });

  test("Phase 2 (c) POST event tier=C with opt-in=false → 403 TIER_C_NOT_OPTED_IN", async () => {
    // baseline "test" org has opt-in=false
    const ev: Event = makeEvent({ tier: "C" });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("TIER_C_NOT_OPTED_IN");
  });

  test("Phase 2 (d) POST event tier=A with nested raw_attrs.prompt_text → 400 FORBIDDEN_FIELD", async () => {
    const ev = {
      ...makeEvent({ tier: "A" }),
      raw_attrs: { prompt_text: "snuck-in" },
    };
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; field: string };
    expect(body.code).toBe("FORBIDDEN_FIELD");
    expect(body.field).toBe("prompt_text");
  });

  test("Phase 2 (e) Missing policy (unmapped org) → 500 ORG_POLICY_MISSING", async () => {
    const row: IngestKeyRow = {
      id: "nopolkey",
      org_id: "nopoltenant",
      engineer_id: "eng",
      key_sha256: hashSecret("abc"),
      tier_default: "B",
      revoked_at: null,
    };
    // Seed the key but NOT the policy — store.get("nopoltenant") → null.
    setDeps({
      store: makeStore([row]),
      cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
      orgPolicyStore: makePolicyStore({
        // seed a different org, so "nopoltenant" lookup returns null
        other: { tier_c_managed_cloud_optin: false, tier_default: "B" },
      }),
    });
    const res = await postEvents({ events: [makeEvent()] }, "Bearer bm_nopoltenant_abc");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ORG_POLICY_MISSING");
    resetDeps();
    beforeAllReseed();
  });

  test("Phase 2 (f) GET /readyz response body includes fields_loaded=true", async () => {
    const res = await handle(new Request("http://localhost/readyz"));
    // Dep pings may fail in unit-test env → 503 is acceptable, but the payload
    // must still carry the fields_loaded flag so ops can see invariant state.
    const body = (await res.json()) as {
      deps?: { fields_loaded?: boolean };
      status: string;
    };
    expect(body.deps?.fields_loaded).toBe(true);
  });

  test("Phase 2 (g) ordering proof: payload with prompt_text AND zod-invalid → 400 FORBIDDEN_FIELD (pre-zod)", async () => {
    // Intentionally drop `client_event_id` (zod-invalid) AND add prompt_text.
    // If ordering were zod-first we'd get a zod error; proper ordering returns
    // FORBIDDEN_FIELD from enforceTier.
    const ev = {
      // client_event_id omitted
      schema_version: 1,
      ts: "2026-04-16T12:00:00.000Z",
      tenant_id: "org_abc",
      engineer_id: "eng",
      device_id: "dev",
      source: "claude-code",
      fidelity: "full",
      cost_estimated: false,
      tier: "B",
      session_id: "s",
      event_seq: 0,
      dev_metrics: { event_kind: "llm_request" },
      prompt_text: "must-reject-first",
    };
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; field?: string };
    expect(body.code).toBe("FORBIDDEN_FIELD");
    expect(body.field).toBe("prompt_text");
  });

  // --- Phase 3 additions (Redis SETNX dedup) -------------------------------

  test("Phase 3 (a) first-sight: single event → 202 {accepted:1, deduped:0}", async () => {
    beforeAllReseed();
    const res = await postEvents({ events: [makeEvent({ session_id: "p3_a" })] });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: number; deduped: number };
    expect(body.accepted).toBe(1);
    expect(body.deduped).toBe(0);
  });

  test("Phase 3 (b) duplicate replay: same event posted twice → 2nd {accepted:0, deduped:1}", async () => {
    beforeAllReseed();
    const ev = makeEvent({ session_id: "p3_b", event_seq: 7 });
    const r1 = await postEvents({ events: [ev] });
    expect(r1.status).toBe(202);
    const b1 = (await r1.json()) as { accepted: number; deduped: number };
    expect(b1.accepted).toBe(1);
    expect(b1.deduped).toBe(0);
    // Replay — same (tenant, session, seq) → dup. client_event_id can match;
    // dedup key is derived from session_id + event_seq, not client_event_id.
    const r2 = await postEvents({ events: [ev] });
    expect(r2.status).toBe(202);
    const b2 = (await r2.json()) as { accepted: number; deduped: number };
    expect(b2.accepted).toBe(0);
    expect(b2.deduped).toBe(1);
  });

  test("Phase 3 (c) partial-batch: 3 new + 2 dup → 202 {accepted:3, deduped:2}", async () => {
    beforeAllReseed();
    // First post 2 events to seed dedup.
    const seed1 = makeEvent({ session_id: "p3_c", event_seq: 1 });
    const seed2 = makeEvent({ session_id: "p3_c", event_seq: 2 });
    const seedRes = await postEvents({ events: [seed1, seed2] });
    expect(seedRes.status).toBe(202);
    // Now post a batch of 5: the 2 seeds (dup) + 3 new.
    const batch = [
      seed1,
      seed2,
      makeEvent({ session_id: "p3_c", event_seq: 3 }),
      makeEvent({ session_id: "p3_c", event_seq: 4 }),
      makeEvent({ session_id: "p3_c", event_seq: 5 }),
    ];
    const res = await postEvents({ events: batch });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: number; deduped: number };
    expect(body.accepted).toBe(3);
    expect(body.deduped).toBe(2);
  });

  test("Phase 3 (d) /readyz fails with reason='redis-eviction-policy' when maxmemory-policy=allkeys-lru", async () => {
    setDeps({ dedupStore: new InMemoryDedupStore({ policy: "allkeys-lru" }) });
    const res = await handle(new Request("http://localhost/readyz"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      checks: { redis_maxmemory_policy: { ok: boolean; reason?: string } };
    };
    expect(body.checks.redis_maxmemory_policy.ok).toBe(false);
    expect(body.checks.redis_maxmemory_policy.reason).toBe("redis-eviction-policy");
    beforeAllReseed();
  });

  test("Phase 3 (e) /readyz fails with reason='redis-unreachable' when configMaxMemoryPolicy throws", async () => {
    const throwingStore: DedupStore = {
      async setnx() {
        return true;
      },
      async configMaxMemoryPolicy() {
        throw new Error("ECONNREFUSED");
      },
    };
    setDeps({ dedupStore: throwingStore });
    const res = await handle(new Request("http://localhost/readyz"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      checks: { redis_maxmemory_policy: { ok: boolean; reason?: string } };
    };
    expect(body.checks.redis_maxmemory_policy.ok).toBe(false);
    expect(body.checks.redis_maxmemory_policy.reason).toBe("redis-unreachable");
    beforeAllReseed();
  });

  test("Phase 3 (f) dedup NOT called for Tier-A-rejected events (PRD test 7)", async () => {
    const spy = makeSpyDedupStore();
    setDeps({ dedupStore: spy });
    const bad = { ...makeEvent({ session_id: "p3_f" }), prompt_text: "leak" };
    const res = await postEvents({ events: [bad] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; field: string };
    expect(body.code).toBe("FORBIDDEN_FIELD");
    expect(spy.setnxCallCount).toBe(0);
    beforeAllReseed();
  });

  test("Phase 3 (g) dedup NOT called for zod-rejected events (may be called for valid siblings)", async () => {
    const spy = makeSpyDedupStore();
    setDeps({ dedupStore: spy });
    const good = makeEvent({ session_id: "p3_g", event_seq: 1 });
    const { client_event_id: _omit, ...bad } = makeEvent({
      session_id: "p3_g",
      event_seq: 2,
    });
    const res = await postEvents({ events: [good, bad] });
    expect(res.status).toBe(207);
    // Exactly 1 setnx call — for the valid sibling. Zero for the zod-rejected one.
    expect(spy.setnxCallCount).toBe(1);
    // Spot-check the key matches the valid event.
    expect(spy.setnxKeys[0]).toBe(dedupKey({ tenantId: "test", sessionId: "p3_g", eventSeq: 1 }));
    beforeAllReseed();
  });

  test("Phase 3 (h) Redis unavailable during POST → 503 {code: 'REDIS_UNAVAILABLE'}", async () => {
    const throwingStore: DedupStore = {
      async setnx() {
        throw new Error("ECONNREFUSED");
      },
      async configMaxMemoryPolicy() {
        return "noeviction";
      },
    };
    setDeps({ dedupStore: throwingStore });
    const res = await postEvents({ events: [makeEvent({ session_id: "p3_h" })] });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("REDIS_UNAVAILABLE");
    beforeAllReseed();
  });

  test("Phase 3 (i) hash-tag key format asserted: dedupKey === 'dedup:{org_abc}:sess_1:5'", () => {
    expect(dedupKey({ tenantId: "org_abc", sessionId: "sess_1", eventSeq: 5 })).toBe(
      "dedup:{org_abc}:sess_1:5",
    );
  });

  // --- Phase 4 additions (WAL append + CH writer + readyz shape) ----------

  test("Phase 4 (a) POST one valid event → wal.append called once with canonicalized row", async () => {
    beforeAllReseed();
    const spy = makeSpyWalAppender();
    setDeps({ wal: spy });
    const ev = makeEvent({ session_id: "p4_a", event_seq: 0 });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(202);
    expect(spy.appendCallCount).toBe(1);
    expect(spy.lastBatch?.length).toBe(1);
    const row = spy.lastBatch?.[0] as CanonicalRow;
    // Server-derived identity overrides the wire tenant_id.
    expect(row.tenant_id).toBe("test");
    expect(row.client_event_id).toBe(ev.client_event_id);
    beforeAllReseed();
  });

  test("Phase 4 (b) 3 events with 1 dup → wal.append called with 2 rows", async () => {
    beforeAllReseed();
    const spy = makeSpyWalAppender();
    setDeps({ wal: spy });
    const e1 = makeEvent({ session_id: "p4_b", event_seq: 1 });
    const e2 = makeEvent({ session_id: "p4_b", event_seq: 2 });
    const e3 = makeEvent({ session_id: "p4_b", event_seq: 3 });
    // Pre-seed e2 as already-seen.
    await postEvents({ events: [e2] });
    spy.reset();
    const res = await postEvents({ events: [e1, e2, e3] });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: number; deduped: number };
    expect(body.accepted).toBe(2);
    expect(body.deduped).toBe(1);
    expect(spy.appendCallCount).toBe(1);
    expect(spy.lastBatch?.length).toBe(2);
    beforeAllReseed();
  });

  test("Phase 4 (c) WAL throw → 503 WAL_UNAVAILABLE", async () => {
    beforeAllReseed();
    const throwing: WalAppender = {
      async append() {
        throw new Error("redis:unavailable");
      },
      async close() {},
    };
    setDeps({ wal: throwing });
    const res = await postEvents({ events: [makeEvent({ session_id: "p4_c" })] });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("WAL_UNAVAILABLE");
    beforeAllReseed();
  });

  test("Phase 4 (d) /readyz includes clickhouse_ping via injected CH writer", async () => {
    const ch = createInMemoryClickHouseWriter();
    // Force CLICKHOUSE_URL set so clickhousePing actually calls the writer.
    const originalUrl = process.env.CLICKHOUSE_URL;
    process.env.CLICKHOUSE_URL = "http://localhost:8123";
    try {
      setDeps({ clickhouseWriter: ch });
      ch.setPingResult(true);
      let res = await handle(new Request("http://localhost/readyz"));
      let body = (await res.json()) as {
        checks: { clickhouse_ping: boolean };
      };
      expect(body.checks.clickhouse_ping).toBe(true);

      ch.setPingResult(false);
      res = await handle(new Request("http://localhost/readyz"));
      expect(res.status).toBe(503);
      body = (await res.json()) as { checks: { clickhouse_ping: boolean } };
      expect(body.checks.clickhouse_ping).toBe(false);
    } finally {
      if (originalUrl === undefined) {
        delete process.env.CLICKHOUSE_URL;
      } else {
        process.env.CLICKHOUSE_URL = originalUrl;
      }
      beforeAllReseed();
    }
  });

  test("Phase 4 (e) /readyz surfaces wal_consumer_lag shape", async () => {
    const res = await handle(new Request("http://localhost/readyz"));
    const body = (await res.json()) as {
      checks: { wal_consumer_lag: { ok: boolean; lag: number; reason?: string } };
    };
    expect(body.checks.wal_consumer_lag).toBeDefined();
    expect(typeof body.checks.wal_consumer_lag.ok).toBe("boolean");
    expect(typeof body.checks.wal_consumer_lag.lag).toBe("number");
    // Consumer not wired in tests → reason='consumer-disabled'.
    expect(body.checks.wal_consumer_lag.reason).toBe("consumer-disabled");
  });

  test("Phase 4 (f) flag coherence: OTLP_RECEIVER_ENABLED=1 WAL_CONSUMER_ENABLED=0 → throws", () => {
    const flags = parseFlags({ OTLP_RECEIVER_ENABLED: "1", WAL_CONSUMER_ENABLED: "0" });
    expect(() => assertFlagCoherence(flags)).toThrow(FlagIncoherentError);
  });

  // --- Phase 6 meta: enforceTier NEVER invoked on /v1/webhooks/* -----------

  test("Phase 6 (meta) enforceTier spy count stays 0 across webhook path", async () => {
    const { _testHooks } = await import("./server");
    const { createInMemoryOrgResolver } = await import("./deps");
    const { createInMemoryGitEventsStore } = await import("./webhooks/gitEventsStore");
    const resolver = createInMemoryOrgResolver();
    resolver.seed("dev", "org_internal_id");
    const policyStore = new InMemoryOrgPolicyStore();
    policyStore.seed("org_internal_id", {
      tier_c_managed_cloud_optin: false,
      tier_default: "B",
      webhook_secrets: { github: "s" },
    });
    setDeps({
      orgResolver: resolver,
      orgPolicyStore: policyStore,
      gitEventsStore: createInMemoryGitEventsStore(),
      webhookDedup: new InMemoryDedupStore(),
      flags: {
        ENFORCE_TIER_A_ALLOWLIST: false,
        WAL_APPEND_ENABLED: false,
        WAL_CONSUMER_ENABLED: false,
        OTLP_RECEIVER_ENABLED: false,
        WEBHOOKS_ENABLED: true,
        CLICKHOUSE_WRITER: "client",
      },
    });
    _testHooks.reset();
    const res = await handle(
      new Request("http://localhost/v1/webhooks/github?org=dev", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "meta-del",
          // Bad sig is fine — we're asserting enforceTier is never called
          // regardless of verification outcome.
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: JSON.stringify({
          action: "opened",
          pull_request: { node_id: "PR_META" },
          repository: { node_id: "R_1" },
        }),
      }),
    );
    // 401 or 200 — either way, enforceTier is a no-touch.
    expect([200, 401]).toContain(res.status);
    expect(_testHooks.enforceTierCallCount).toBe(0);
    resetDeps();
    beforeAllReseed();
  });

  test("Phase 3 ordering invariant: Tier-B with prompt_text increments no setnx; valid event increments by 1", async () => {
    const spy = makeSpyDedupStore();
    setDeps({ dedupStore: spy });
    // 1. Reject path: prompt_text → 400 FORBIDDEN_FIELD, spy untouched.
    const bad = { ...makeEvent({ session_id: "p3_ord_bad" }), prompt_text: "leak" };
    const r1 = await postEvents({ events: [bad] });
    expect(r1.status).toBe(400);
    expect(spy.setnxCallCount).toBe(0);
    // 2. Accept path: valid event → setnx called once.
    const good = makeEvent({ session_id: "p3_ord_good", event_seq: 0 });
    const r2 = await postEvents({ events: [good] });
    expect(r2.status).toBe(202);
    expect(spy.setnxCallCount).toBe(1);
    beforeAllReseed();
  });

  // ---- Follow-up review fixes -------------------------------------------

  test("H3: session_id containing dots/colons accepted (not 503)", async () => {
    const ev = makeEvent({
      session_id: "chat:2026-04-16T12:00:00.000Z",
      event_seq: 0,
    });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: number; deduped: number };
    expect(body.accepted).toBe(1);
  });

  test("H3: session_id containing { or } returns 400 BAD_SESSION_ID, not 503", async () => {
    const ev = makeEvent({ session_id: "bad{session}", event_seq: 0 });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BAD_SESSION_ID");
  });

  test("H1: Tier-A allowlist filter reaches WAL when flag is on", async () => {
    // Install a Tier-A org policy + flag-on deps.
    const wal = createInMemoryWalAppender();
    const row: IngestKeyRow = {
      id: "legacy_test_key",
      org_id: "test",
      engineer_id: "eng_test",
      key_sha256: hashSecret("abc"),
      tier_default: "A",
      revoked_at: null,
    };
    const flags = parseFlags({ ENFORCE_TIER_A_ALLOWLIST: "1" });
    setDeps({
      store: makeStore([row]),
      cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
      rateLimiter: permissiveRateLimiter(),
      orgPolicyStore: makePolicyStore({
        test: { tier_c_managed_cloud_optin: false, tier_default: "A" },
      }),
      dedupStore: new InMemoryDedupStore(),
      wal,
      flags,
    });
    const ev = makeEvent({
      tier: "A",
      session_id: "sess_tier_a",
      event_seq: 0,
      raw_attrs: { foo: "dropme", "device.id": "keep" },
    });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(202);
    const rows = wal.drain();
    expect(rows.length).toBe(1);
    const rawAttrs = rows[0]?.row.raw_attrs as string;
    const parsed = typeof rawAttrs === "string" ? JSON.parse(rawAttrs) : rawAttrs;
    // foo dropped, device.id retained. The canonical row's raw_attrs is a
    // JSON blob (per CH DDL), so parse before asserting.
    expect(parsed.foo).toBeUndefined();
    expect(parsed["device.id"]).toBe("keep");
    beforeAllReseed();
  });

  test("L1: incoherent flags (APPEND=0 CONSUMER=1) throw FLAG_INCOHERENT", () => {
    const flags = parseFlags({ WAL_APPEND_ENABLED: "0", WAL_CONSUMER_ENABLED: "1" });
    expect(() => assertFlagCoherence(flags)).toThrow(FlagIncoherentError);
  });
});

// -------- helpers ----------------------------------------------------------

function beforeAllReseed(): void {
  const row: IngestKeyRow = {
    id: "legacy_test_key",
    org_id: "test",
    engineer_id: "eng_test",
    key_sha256: hashSecret("abc"),
    tier_default: "B",
    revoked_at: null,
  };
  setDeps({
    store: makeStore([row]),
    cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
    rateLimiter: permissiveRateLimiter(),
    orgPolicyStore: makePolicyStore({
      test: { tier_c_managed_cloud_optin: false, tier_default: "B" },
    }),
    dedupStore: new InMemoryDedupStore(),
    wal: createInMemoryWalAppender(),
  });
}

interface SpyWalAppender extends WalAppender {
  appendCallCount: number;
  lastBatch: CanonicalRow[] | null;
  reset(): void;
}

function makeSpyWalAppender(): SpyWalAppender {
  const inner = createInMemoryWalAppender();
  const spy: SpyWalAppender = {
    appendCallCount: 0,
    lastBatch: null,
    async append(rows) {
      spy.appendCallCount++;
      spy.lastBatch = [...rows];
      return inner.append(rows);
    },
    async close() {
      await inner.close();
    },
    reset() {
      spy.appendCallCount = 0;
      spy.lastBatch = null;
    },
  };
  return spy;
}

interface SpyDedupStore extends DedupStore {
  setnxCallCount: number;
  setnxKeys: string[];
}

function makeSpyDedupStore(opts: { policy?: string } = {}): SpyDedupStore {
  const inner =
    opts.policy === undefined
      ? new InMemoryDedupStore()
      : new InMemoryDedupStore({ policy: opts.policy });
  const spy: SpyDedupStore = {
    setnxCallCount: 0,
    setnxKeys: [],
    async setnx(key, ttlMs) {
      spy.setnxCallCount++;
      spy.setnxKeys.push(key);
      return inner.setnx(key, ttlMs);
    },
    async configMaxMemoryPolicy() {
      return inner.configMaxMemoryPolicy();
    },
  };
  return spy;
}

interface FakeBucket {
  tokens: number;
  ts: number;
}

function makeFakeLuaRedis(opts: { nowMs?: () => number } = {}): LuaRedis {
  const nowMs = opts.nowMs ?? (() => Date.now());
  const buckets = new Map<string, FakeBucket>();
  function runBucket(
    keys: (string | number)[],
    args: (string | number)[],
  ): [number, number, number] {
    const key = String(keys[0]);
    const cap = Number(args[0]);
    const rate = Number(args[1]);
    const cost = Number(args[2]);
    const now = nowMs();
    const existing = buckets.get(key);
    let tok = existing?.tokens ?? cap;
    const ts = existing?.ts ?? now;
    tok = Math.min(cap, tok + ((now - ts) * rate) / 1000);
    if (tok < cost) {
      buckets.set(key, { tokens: tok, ts: now });
      return [0, Math.floor(tok), Math.ceil(((cost - tok) * 1000) / rate)];
    }
    tok = tok - cost;
    buckets.set(key, { tokens: tok, ts: now });
    return [1, Math.floor(tok), 0];
  }
  return {
    async scriptLoad() {
      return "sha-test";
    },
    async evalsha(_sha, keys, args) {
      return runBucket(keys, args);
    },
    async eval(_src, keys, args) {
      return runBucket(keys, args);
    },
  };
}
