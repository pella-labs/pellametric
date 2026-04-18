import { type Event, EventSchema, FORBIDDEN_FIELDS } from "@bematist/schema";
import { type AuthContext, verifyBearer } from "./auth";
import { checkDedup } from "./dedup/checkDedup";
import { getDeps } from "./deps";
import { logger } from "./logger";
import { handlePolicyFlipRequest } from "./policy-flip/route";
import { redactEventInPlace } from "./redact/hotpath";
import { applyTierAAllowlist, enforceTier } from "./tier/enforceTier";
import { canonicalize } from "./wal/append";
import { handleWebhook } from "./webhooks/router";
import type { WebhookSource } from "./webhooks/verify";

// Phase-6 test seam: enforceTier MUST NOT be invoked on /v1/webhooks/* paths
// (D-S1-32). Tests read `_testHooks.enforceTierCallCount` after posting to
// a webhook path to assert zero. The counter is bumped ONLY inside handleEvents.
export const _testHooks = {
  enforceTierCallCount: 0,
  reset() {
    _testHooks.enforceTierCallCount = 0;
  },
};

const MAX_EVENTS_PER_REQUEST = 1000;
const READYZ_PING_TIMEOUT_MS = 2000;

// Phase-2 invariant: FORBIDDEN_FIELDS is single-source; /readyz asserts the
// length matches the contract-08 count of 12.
const EXPECTED_FORBIDDEN_FIELDS_LEN = 12;

function parseListenAddr(raw: string | undefined): { hostname: string; port: number } {
  const fallback = { hostname: "0.0.0.0", port: 8000 };
  if (!raw) return fallback;
  // Supports ":8000", "host:8000", or bare port.
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith(":")) {
    const port = Number.parseInt(trimmed.slice(1), 10);
    return Number.isFinite(port) ? { hostname: "0.0.0.0", port } : fallback;
  }
  if (trimmed.includes(":")) {
    const idx = trimmed.lastIndexOf(":");
    const host = trimmed.slice(0, idx);
    const port = Number.parseInt(trimmed.slice(idx + 1), 10);
    return Number.isFinite(port) ? { hostname: host || "0.0.0.0", port } : fallback;
  }
  const port = Number.parseInt(trimmed, 10);
  return Number.isFinite(port) ? { hostname: "0.0.0.0", port } : fallback;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Minimal TCP probe: opens a socket, closes it. Dep-free; CLAUDE.md forbids adding deps
// without justification. Upgraded to real client pings in Sprint 1+.
async function pingTcp(urlStr: string | undefined, defaultPort: number): Promise<boolean> {
  if (!urlStr) return false;
  let host: string;
  let port: number;
  try {
    const u = new URL(urlStr);
    host = u.hostname;
    port = u.port ? Number.parseInt(u.port, 10) : defaultPort;
  } catch {
    return false;
  }
  try {
    await withTimeout(
      Bun.connect({
        hostname: host,
        port,
        socket: {
          open(sock) {
            sock.end();
          },
          data() {},
          close() {},
          error() {},
        },
      }),
      READYZ_PING_TIMEOUT_MS,
    );
    return true;
  } catch {
    return false;
  }
}

// Phase 4: delegate to deps.clickhouseWriter.ping() so tests can inject an
// in-memory writer with togglable ping-result. When CLICKHOUSE_URL is unset
// in dev, treat as configured-OK (same shape as prior TCP ping on empty URL,
// but flipped: dev convenience — ops environments always set the URL and
// the injected writer's real ping fires).
async function clickhousePing(): Promise<boolean> {
  const { clickhouseWriter } = getDeps();
  if (!process.env.CLICKHOUSE_URL) {
    // Unconfigured: treat as OK in dev, matching the dev-compose convention.
    return true;
  }
  try {
    return await withTimeout(clickhouseWriter.ping(), READYZ_PING_TIMEOUT_MS);
  } catch {
    return false;
  }
}

export interface RedisMaxMemoryPolicyCheck {
  ok: boolean;
  /** Human-readable reason on failure. Values: "redis-eviction-policy" | "redis-unreachable". */
  reason?: "redis-eviction-policy" | "redis-unreachable";
  /** Observed `maxmemory-policy` value when reachable. */
  policy?: string;
}

async function checkRedisMaxMemoryPolicy(): Promise<RedisMaxMemoryPolicyCheck> {
  const { dedupStore } = getDeps();
  try {
    const policy = await dedupStore.configMaxMemoryPolicy();
    if (policy !== "noeviction") {
      return { ok: false, reason: "redis-eviction-policy", policy };
    }
    return { ok: true, policy };
  } catch {
    return { ok: false, reason: "redis-unreachable" };
  }
}

export interface WalConsumerLagCheck {
  ok: boolean;
  lag: number;
  reason?: "consumer-disabled" | "lag-unavailable";
}

async function checkWalConsumerLag(): Promise<WalConsumerLagCheck> {
  const { walConsumerLag } = getDeps();
  if (!walConsumerLag) {
    return { ok: true, lag: 0, reason: "consumer-disabled" };
  }
  try {
    const lag = await walConsumerLag();
    return { ok: lag < 10_000, lag };
  } catch {
    return { ok: false, lag: 0, reason: "lag-unavailable" };
  }
}

async function readinessChecks(): Promise<{
  postgres: boolean;
  clickhouse: boolean;
  redis: boolean;
  fields_loaded: boolean;
  redis_maxmemory_policy: RedisMaxMemoryPolicyCheck;
  clickhouse_ping: boolean;
  wal_consumer_lag: WalConsumerLagCheck;
}> {
  const [postgres, clickhouse, redis, redis_maxmemory_policy, wal_consumer_lag] = await Promise.all(
    [
      pingTcp(process.env.DATABASE_URL, 5432),
      clickhousePing(),
      pingTcp(process.env.REDIS_URL, 6379),
      checkRedisMaxMemoryPolicy(),
      checkWalConsumerLag(),
    ],
  );
  const fields_loaded = FORBIDDEN_FIELDS.length === EXPECTED_FORBIDDEN_FIELDS_LEN;
  return {
    postgres,
    clickhouse,
    redis,
    fields_loaded,
    redis_maxmemory_policy,
    // Phase-4: surface a dedicated `clickhouse_ping` field — the `clickhouse`
    // bool above remains for backwards-compat of existing `/readyz` consumers.
    clickhouse_ping: clickhouse,
    wal_consumer_lag,
  };
}

async function handleEvents(req: Request, auth: AuthContext, requestId: string): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(
      { error: "invalid json", code: "BAD_JSON", request_id: requestId },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || !Array.isArray((body as { events?: unknown }).events)) {
    return json(
      { error: "missing events array", code: "BAD_SHAPE", request_id: requestId },
      { status: 400 },
    );
  }

  const events = (body as { events: unknown[] }).events;
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return json(
      { error: `max ${MAX_EVENTS_PER_REQUEST} events per request`, request_id: requestId },
      { status: 413 },
    );
  }

  // Phase-2 tier enforcement runs PRE-ZOD. Policy fetched once per batch
  // (not per-event) from the 60s-cached OrgPolicyStore.
  const { orgPolicyStore } = getDeps();
  const policy = await orgPolicyStore.get(auth.tenantId);
  if (policy === null) {
    logger.warn(
      { tenant_id: auth.tenantId, request_id: requestId, code: "ORG_POLICY_MISSING" },
      "org policy missing",
    );
    return json(
      {
        error: "org policy not configured",
        code: "ORG_POLICY_MISSING",
        request_id: requestId,
      },
      { status: 500 },
    );
  }

  // Run enforceTier on every event; any 400 (FORBIDDEN_FIELD) or 403
  // (TIER_C_NOT_OPTED_IN) fails the entire batch — privacy violations are
  // not partial-acceptable (contract 02 §Response codes).
  for (let i = 0; i < events.length; i++) {
    _testHooks.enforceTierCallCount++;
    const res = await enforceTier(events[i], auth, policy);
    if (res.reject) {
      const bodyJson: Record<string, unknown> = {
        error: res.code,
        code: res.code,
        request_id: requestId,
        index: i,
      };
      if (res.code === "FORBIDDEN_FIELD" && res.field !== undefined) {
        bodyJson.field = res.field;
      }
      logger.warn(
        {
          tenant_id: auth.tenantId,
          request_id: requestId,
          code: res.code,
          index: i,
          ...(res.code === "FORBIDDEN_FIELD" && res.field !== undefined
            ? { field: res.field }
            : {}),
        },
        "tier enforcement reject",
      );
      return json(bodyJson, { status: res.status });
    }
  }

  const rejected: Array<{ index: number; reason: string }> = [];
  // Parsed events by index; indices absent from this map are zod-rejected.
  const parsedByIndex = new Map<number, ReturnType<typeof EventSchema.parse>>();
  for (let i = 0; i < events.length; i++) {
    const result = EventSchema.safeParse(events[i]);
    if (!result.success) {
      rejected.push({ index: i, reason: result.error.issues.map((x) => x.message).join("; ") });
    } else {
      parsedByIndex.set(i, result.data);
    }
  }

  if (rejected.length > 0 && rejected.length === events.length) {
    // All invalid — simplest signal is 400 per contract (BLOCKER semantics).
    return json({ error: "all events invalid", rejected, request_id: requestId }, { status: 400 });
  }

  // All zod-valid (or partial with some valid). Apply Tier-A allowlist
  // POST-zod if feature flag is on. Sprint-1 default: flag off → no-op path.
  //
  // H1 fix: apply on the parsed event (parsedByIndex entry), NOT on the raw
  // wire body. Downstream canonicalize reads parsedByIndex — mutating the raw
  // body previously had no effect on the WAL row, silently bypassing the
  // allowlist once the flag flipped.
  const enforceTierA = getDeps().flags.ENFORCE_TIER_A_ALLOWLIST;
  if (enforceTierA) {
    let totalDropped = 0;
    for (const [i, parsed] of parsedByIndex) {
      const ev = parsed as unknown as {
        tier: "A" | "B" | "C";
        raw_attrs?: Record<string, unknown>;
        [k: string]: unknown;
      };
      const r = applyTierAAllowlist(ev, policy, true);
      // Replace the cached parsed entry so canonicalize() sees the filtered
      // raw_attrs.
      parsedByIndex.set(i, r.event as unknown as ReturnType<typeof EventSchema.parse>);
      totalDropped += r.dropped_count;
    }
    if (totalDropped > 0) {
      logger.info(
        {
          tenant_id: auth.tenantId,
          request_id: requestId,
          dropped_keys: totalDropped,
        },
        "tier_a_allowlist dropped keys",
      );
    }
  }

  // Phase-3: Redis SETNX dedup. Runs ONLY on events that passed enforceTier
  // AND zod. Duplicates count toward `deduped`, not `rejected` — repeated
  // client_event_id is idempotent-accept per contract 02 §Response codes
  // ("repeated client_event_id returns 202 with deduped count incremented;
  // never an error"). Redis unavailable → 503 for the whole batch.
  const { dedupStore, wal, flags } = getDeps();
  let deduped = 0;
  let firstSightCount = 0;
  // Phase-4: collect first-sight parsed events for WAL append after all
  // dedup checks succeed. We append once, post-dedup, so partial failures
  // during dedup don't leave a half-WALed batch.
  const firstSightEvents: Array<ReturnType<typeof EventSchema.parse>> = [];
  for (const [, parsed] of parsedByIndex) {
    try {
      const { firstSight } = await checkDedup(dedupStore, {
        tenantId: auth.tenantId,
        sessionId: parsed.session_id,
        eventSeq: parsed.event_seq,
      });
      if (firstSight) {
        firstSightCount++;
        firstSightEvents.push(parsed);
      } else {
        deduped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // H3 fix: distinguish client-visible input defects (bad session_id /
      // tenant_id / event_seq) from Redis outage. `dedupKey()` throws
      // `dedup:bad-input`; everything else is infrastructure.
      if (msg === "dedup:bad-input") {
        logger.warn(
          {
            tenant_id: auth.tenantId,
            request_id: requestId,
            session_id: parsed.session_id,
            event_seq: parsed.event_seq,
          },
          "bad dedup input",
        );
        return json(
          {
            error: "invalid session_id or event_seq for dedup key",
            code: "BAD_SESSION_ID",
            request_id: requestId,
          },
          { status: 400 },
        );
      }
      logger.error(
        { tenant_id: auth.tenantId, request_id: requestId, err: msg },
        "dedup store unavailable",
      );
      return json(
        {
          error: "dedup store unavailable",
          code: "REDIS_UNAVAILABLE",
          request_id: requestId,
        },
        { status: 503 },
      );
    }
  }

  // M3 follow-up #2: server-side redaction (contract 08). Runs synchronously on
  // every first-sight event BEFORE canonicalize + WAL append. Three things
  // happen here per event:
  //   1. `<REDACTED:type:hash>` markers substituted into `prompt_text`,
  //      `tool_input`, `tool_output`, `raw_attrs` string values.
  //   2. `redaction_count` bumped by the number of markers emitted.
  //   3. One `redaction_audit` row per marker handed to the injected sink.
  // `raw_attrs_allowlist_extra` flows from the already-fetched org policy.
  // The sink is called best-effort; failures log but do not reject the batch
  // because the event itself is already safe at this point.
  const redactedFirstSight: Event[] = [];
  if (firstSightEvents.length > 0) {
    const { redactStage, redactAuditSink } = getDeps();
    const allowlistExtra = policy.raw_attrs_allowlist_extra ?? [];
    const opts =
      allowlistExtra.length > 0
        ? {
            stage: redactStage,
            auditSink: redactAuditSink,
            raw_attrs_allowlist_extra: allowlistExtra,
          }
        : { stage: redactStage, auditSink: redactAuditSink };
    for (const ev of firstSightEvents) {
      const r = await redactEventInPlace(ev, opts);
      redactedFirstSight.push(r.event);
    }
  }

  // Phase-4: append first-sight events to the WAL. This is the ingest-internal
  // durability seam — the WAL consumer drains the stream and writes to CH.
  // If WAL is unavailable, fail the batch with 503 WAL_UNAVAILABLE (clients
  // retry with the same client_event_id, dedup handles the replay).
  // L1 fix: honor WAL_APPEND_ENABLED exactly. Previously the OR with
  // WAL_CONSUMER_ENABLED silently forced append on. The consumer flag
  // governs draining, not appending; an incoherent combination
  // (APPEND=0 + CONSUMER=1) is now rejected at boot by assertFlagCoherence.
  const walEnabled = flags.WAL_APPEND_ENABLED;
  if (walEnabled && redactedFirstSight.length > 0) {
    try {
      const canonical = redactedFirstSight.map((ev) =>
        canonicalize(ev, { tenantId: auth.tenantId, engineerId: auth.engineerId }),
      );
      await wal.append(canonical);
    } catch (err) {
      logger.error(
        {
          tenant_id: auth.tenantId,
          request_id: requestId,
          err: err instanceof Error ? err.message : String(err),
        },
        "wal append failed",
      );
      return json(
        {
          error: "wal unavailable",
          code: "WAL_UNAVAILABLE",
          request_id: requestId,
        },
        { status: 503 },
      );
    }
  }

  if (rejected.length > 0) {
    // Partial — 207 Multi-Status per contract 02 §Response codes. Surface
    // `deduped` so clients can reconcile (zero if no dups among the valid).
    logger.info(
      {
        accepted: firstSightCount,
        deduped,
        rejected: rejected.length,
        tenant_id: auth.tenantId,
        request_id: requestId,
      },
      "events partial accept",
    );
    return json(
      { accepted: firstSightCount, deduped, rejected, request_id: requestId },
      { status: 207 },
    );
  }

  logger.info(
    {
      accepted: firstSightCount,
      deduped,
      tenant_id: auth.tenantId,
      request_id: requestId,
    },
    "events accepted",
  );
  return json({ accepted: firstSightCount, deduped, request_id: requestId }, { status: 202 });
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requestId = crypto.randomUUID();

  if (req.method === "GET" && url.pathname === "/healthz") {
    return json({ status: "ok" });
  }

  if (req.method === "GET" && url.pathname === "/readyz") {
    const deps = await readinessChecks();
    const ok =
      deps.postgres &&
      deps.clickhouse &&
      deps.redis &&
      deps.fields_loaded &&
      deps.redis_maxmemory_policy.ok &&
      deps.wal_consumer_lag.ok;
    // Phase-3/4: surface composite checks so ops can see per-check state.
    const checks = {
      postgres: deps.postgres,
      clickhouse: deps.clickhouse,
      redis: deps.redis,
      fields_loaded: deps.fields_loaded,
      redis_maxmemory_policy: deps.redis_maxmemory_policy,
      clickhouse_ping: deps.clickhouse_ping,
      wal_consumer_lag: deps.wal_consumer_lag,
    };
    if (!ok) {
      const failing = Object.entries({
        postgres: deps.postgres,
        clickhouse: deps.clickhouse,
        redis: deps.redis,
        fields_loaded: deps.fields_loaded,
        redis_maxmemory_policy: deps.redis_maxmemory_policy.ok,
        wal_consumer_lag: deps.wal_consumer_lag.ok,
      })
        .filter(([, v]) => !v)
        .map(([k]) => k);
      logger.warn({ deps, failing }, "readyz dep check failed");
      return json({ status: "not-ready", deps, checks }, { status: 503 });
    }
    return json({ status: "ready", deps, checks });
  }

  // Phase 6 webhook routes — flag-gated; raw body captured inside the router
  // before any JSON parse so HMAC verification sees exact on-the-wire bytes.
  if (url.pathname.startsWith("/v1/webhooks/")) {
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, { status: 405 });
    }
    const source = url.pathname.slice("/v1/webhooks/".length) as WebhookSource;
    if (source !== "github" && source !== "gitlab" && source !== "bitbucket") {
      return json({ error: "unknown webhook source", code: "UNKNOWN_SOURCE" }, { status: 404 });
    }
    return handleWebhook(req, source, getDeps());
  }

  if (url.pathname === "/v1/admin/policy-flip") {
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, { status: 405 });
    }
    const { store, cache, policyFlip } = getDeps();
    const auth = await verifyBearer(req.headers.get("authorization"), store, cache);
    if (!auth) {
      return new Response(null, { status: 401 });
    }
    return handlePolicyFlipRequest(req, auth, requestId, { policyFlip });
  }

  if (url.pathname === "/v1/events") {
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, { status: 405 });
    }
    const { store, cache, rateLimiter } = getDeps();
    const auth = await verifyBearer(req.headers.get("authorization"), store, cache);
    if (!auth) {
      return new Response(null, { status: 401 });
    }
    // Rate-limit per (orgId, deviceId). deviceId pulled from optional header.
    const deviceId = req.headers.get("x-device-id") ?? "default";
    const rl = await rateLimiter.consume(auth.tenantId, deviceId, 1);
    if (!rl.allowed) {
      const retryAfter = Math.max(1, Math.ceil(rl.retryAfterMs / 1000)).toString();
      return new Response(
        JSON.stringify({
          error: "rate limit exceeded",
          code: "RATE_LIMITED",
          retry_after_ms: rl.retryAfterMs,
          request_id: requestId,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": retryAfter,
          },
        },
      );
    }
    const res = await handleEvents(req, auth, requestId);
    // Best-effort rate-limit remaining header on 2xx.
    if (Number.isFinite(rl.remaining)) {
      res.headers.set("x-ratelimit-remaining", String(rl.remaining));
    }
    return res;
  }

  return json({ error: "not found" }, { status: 404 });
}

export function startServer(): ReturnType<typeof Bun.serve> {
  const { hostname, port } = parseListenAddr(process.env.INGEST_LISTEN_ADDR);
  const server = Bun.serve({
    hostname,
    port,
    fetch: handle,
  });
  logger.info({ url: server.url.toString() }, "ingest listening");
  return server;
}
