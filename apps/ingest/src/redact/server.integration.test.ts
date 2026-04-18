// M3 follow-up #2 — integration test: server-side redaction wires into the
// ingest hot path.
//
// Asserts the end-to-end flow: a Tier-A event with a seeded secret in
// `raw_attrs` (and a Tier-C event with a secret in `prompt_text`), posted to
// `/v1/events`, results in
//   1. `<REDACTED:type:hash>` markers in the canonical WAL row's fields.
//   2. one `redaction_audit` row per marker, routed to the injected sink and
//      mapped to the CH wire shape (org_id, redacted_at `YYYY-MM-DD HH:MM:SS.fff`).
//
// This is the missing defense-in-depth that item 2 closes: prior to this PR,
// `packages/redact`'s 98.8%-recall engine existed but was not called from
// `apps/ingest/src/server.ts` at all.

import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Event } from "@bematist/schema";
import { permissiveRateLimiter } from "../auth/rateLimit";
import type { IngestKeyRow, IngestKeyStore } from "../auth/verifyIngestKey";
import { LRUCache } from "../auth/verifyIngestKey";
import { InMemoryDedupStore } from "../dedup/checkDedup";
import { resetDeps, setDeps } from "../deps";
import { parseFlags } from "../flags";
import { handle } from "../server";
import { InMemoryOrgPolicyStore } from "../tier/enforceTier";
import { type CanonicalRow, createInMemoryWalAppender } from "../wal/append";
import { createClickHouseAuditSink, createInMemoryAuditTableWriter } from "./auditSink";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

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

interface SetupOptions {
  tierDefault?: "A" | "B" | "C";
}

function setupIngest(opts: SetupOptions = {}): {
  wal: ReturnType<typeof createInMemoryWalAppender>;
  writer: ReturnType<typeof createInMemoryAuditTableWriter>;
} {
  const tier = opts.tierDefault ?? "A";
  const row: IngestKeyRow = {
    id: "test_key",
    org_id: "test",
    engineer_id: "eng_test",
    key_sha256: hashSecret("abc"),
    tier_default: tier,
    revoked_at: null,
  };
  const policy = new InMemoryOrgPolicyStore();
  policy.seed("test", {
    tier_c_managed_cloud_optin: tier === "C",
    tier_default: tier,
  });
  const wal = createInMemoryWalAppender();
  const writer = createInMemoryAuditTableWriter();
  const sink = createClickHouseAuditSink({ writer });
  setDeps({
    store: makeStore([row]),
    cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
    rateLimiter: permissiveRateLimiter(),
    orgPolicyStore: policy,
    dedupStore: new InMemoryDedupStore(),
    wal,
    redactAuditSink: sink,
    flags: parseFlags({ WAL_APPEND_ENABLED: "1" }),
  });
  return { wal, writer };
}

function postEvents(body: unknown, auth = "Bearer bm_test_abc"): Promise<Response> {
  return handle(
    new Request("http://localhost/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
    }),
  );
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    client_event_id: crypto.randomUUID(),
    schema_version: 1,
    ts: "2026-04-17T12:00:00.000Z",
    tenant_id: "test",
    engineer_id: "eng_test",
    device_id: "device_1",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier: "A",
    session_id: `sess_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    event_seq: 0,
    dev_metrics: { event_kind: "llm_request" },
    ...overrides,
  };
}

describe("M3 item 2 — server-side redaction wired into ingest hot path", () => {
  beforeEach(() => {
    resetDeps();
  });

  test("Tier-A event with secret in raw_attrs → WAL row redacted + audit row persisted", async () => {
    const { wal, writer } = setupIngest({ tierDefault: "A" });
    // raw_attrs.source is on the Tier-A allowlist; a secret value on an
    // allowed key is the interesting defense-in-depth case — the allowlist
    // lets the key through, but server-side redaction overwrites the value.
    const ev = makeEvent({
      tier: "A",
      raw_attrs: { source: "AKIAIOSFODNN7EXAMPLE" },
    });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(202);

    const rows = wal.drain();
    expect(rows.length).toBe(1);
    const canonical = rows[0] as CanonicalRow;
    const rawAttrs = JSON.parse(canonical.row.raw_attrs as string) as Record<string, unknown>;
    expect(typeof rawAttrs.source).toBe("string");
    expect(rawAttrs.source as string).toMatch(/<REDACTED:secret:[0-9a-f]{16}>/);
    expect(canonical.canonical_json).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(canonical.row.redaction_count).toBeGreaterThanOrEqual(1);

    expect(writer.calls.length).toBe(1);
    const call = writer.calls[0];
    if (call === undefined) throw new Error("audit call missing");
    expect(call.table).toBe("redaction_audit");
    expect(call.rows.length).toBe(canonical.row.redaction_count as number);
    const auditRow = call.rows[0];
    if (auditRow === undefined) throw new Error("audit row missing");
    expect(auditRow.org_id).toBe("test");
    expect(auditRow.client_event_id).toBe(ev.client_event_id);
    expect(auditRow.session_id).toBe(ev.session_id);
    expect(auditRow.type).toBe("secret");
    expect(auditRow.field).toBe("raw_attrs");
    expect(auditRow.tier).toBe("A");
    expect(typeof auditRow.hash).toBe("string");
    expect((auditRow.hash as string).length).toBe(16);
    expect(typeof auditRow.redacted_at).toBe("string");
    // CH DateTime64(3,'UTC') wire format: 'YYYY-MM-DD HH:MM:SS.fff'.
    expect(auditRow.redacted_at as string).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(JSON.stringify(call.rows)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("Tier-C event with secret in prompt_text → marker in canonical row + audit row", async () => {
    const { wal, writer } = setupIngest({ tierDefault: "C" });
    const ev = makeEvent({
      tier: "C",
      prompt_text: "please rotate AKIAIOSFODNN7EXAMPLE before friday",
    });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(202);

    const rows = wal.drain();
    expect(rows.length).toBe(1);
    const canonical = rows[0] as CanonicalRow;
    expect(canonical.row.prompt_text as string).toMatch(/<REDACTED:secret:[0-9a-f]{16}>/);
    expect(canonical.canonical_json).not.toContain("AKIAIOSFODNN7EXAMPLE");

    expect(writer.calls.length).toBe(1);
    const call = writer.calls[0];
    if (call === undefined) throw new Error("audit call missing");
    const auditRow = call.rows[0];
    if (auditRow === undefined) throw new Error("audit row missing");
    expect(auditRow.tier).toBe("C");
    expect(auditRow.field).toBe("prompt_text");
  });

  test("clean event → no redaction, no audit row, WAL row unchanged", async () => {
    const { wal, writer } = setupIngest({ tierDefault: "C" });
    const ev = makeEvent({
      tier: "C",
      prompt_text: "refactor the cache layer",
    });
    const res = await postEvents({ events: [ev] });
    expect(res.status).toBe(202);

    const rows = wal.drain();
    expect(rows.length).toBe(1);
    const canonical = rows[0] as CanonicalRow;
    expect(canonical.row.prompt_text).toBe("refactor the cache layer");
    expect(canonical.row.redaction_count).toBe(0);
    expect(writer.calls.length).toBe(0);
  });
});
