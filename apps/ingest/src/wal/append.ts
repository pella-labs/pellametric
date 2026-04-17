// Redis Streams Write-Ahead Log (WAL) appender (Sprint-1 Phase-4, PRD §Phase 4,
// D-S1-7, D-S1-24).
//
// Canonicalizes a zod-validated + tier-enforced + dedup-firstSight Event into a
// flat row matching the ClickHouse `events` DDL, then appends each row to the
// Redis Stream `events_wal` via `XADD`. The WAL consumer (`consumer.ts`) reads
// from this stream and performs the actual ClickHouse insert — the ingest
// server never touches CH directly. This is the ingest-internal durability
// seam: if ClickHouse is slow or offline, the WAL absorbs the backpressure and
// the consumer retries.
//
// Test doubles: `createInMemoryWalAppender` records rows in-process; no network
// required. Production uses `createRedisStreamsWalAppender(redis)` where
// `redis` is a thin wrapper implementing `WalRedis` over the real Redis
// Streams protocol.
//
// Field budget (per XADD):
//   tenant_id, engineer_id, client_event_id, schema_version, canonical_json
//
// Invariants:
//   - `canonicalize` is deterministic: same Event → byte-identical canonical_json.
//   - `canonical_json` is bounded at 256 KiB; oversize rows are rejected at
//     append time with `Error("wal:row-too-large")`. (A single coding-agent
//     prompt envelope should be well under this; guards against corrupt input.)
//   - Empty batch → `Error("wal:empty-batch")` — callers must filter.

import type { Event } from "@bematist/schema";

// ---- Canonical row shape --------------------------------------------------

/**
 * Flat row matching `packages/schema/clickhouse/0001_events.sql` columns.
 * Every CH column has a key here; missing optional Event fields get safe
 * defaults (`0` for numeric, `""` for strings, `null` for nullable columns,
 * `[]` for arrays). Tests assert the full column set.
 *
 * Note: Event.tenant_id maps to CH `org_id` (DDL uses org_id; wire uses
 * tenant_id). That rename happens here.
 */
export type CanonicalRow = {
  tenant_id: string;
  engineer_id: string;
  device_id: string;
  client_event_id: string;
  schema_version: number;
  canonical_json: string;
  /** Un-stringified row for in-process assertions & in-memory CH writer. */
  row: Record<string, unknown>;
};

// ---- Deterministic JSON stringify ----------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// ---- canonicalize ---------------------------------------------------------

/** Auth context passed to canonicalize — server-derived, never trusted from wire. */
export interface CanonicalizeAuth {
  tenantId: string;
  engineerId: string;
}

/**
 * Build the flat CH-aligned row for a validated Event. The order of keys in
 * the returned `row` object follows the DDL column order; `stableStringify`
 * then sorts lexicographically for deterministic canonical_json bytes.
 *
 * `tenant_id` (wire) → `org_id` (CH DDL) rename happens here.
 */
export function canonicalize(event: Event, auth: CanonicalizeAuth): CanonicalRow {
  const dm = event.dev_metrics ?? { event_kind: "session_start" };
  const gen = event.gen_ai ?? {};
  const usage = gen.usage ?? {};
  const req = gen.request ?? {};
  const resp = gen.response ?? {};
  const pr = event.prompt_record;

  // Outcome-attribution fields live under raw_attrs today (D16). Promote to
  // typed columns after 2 stable releases — until then, leave nulls here.
  const raw = event.raw_attrs ?? {};
  const prNumber = typeof raw.pr_number === "number" ? (raw.pr_number as number) : null;
  const commitSha = typeof raw.commit_sha === "string" ? (raw.commit_sha as string) : null;
  const branch = typeof raw.branch === "string" ? (raw.branch as string) : null;

  const row: Record<string, unknown> = {
    // Identity & dedup
    client_event_id: event.client_event_id,
    schema_version: event.schema_version,
    ts: event.ts,

    // Tenant / actor — SERVER-DERIVED (not trusted from wire payload).
    org_id: auth.tenantId,
    engineer_id: auth.engineerId,
    device_id: event.device_id,

    // Source
    source: event.source,
    source_version: event.source_version ?? "",
    fidelity: event.fidelity,
    cost_estimated: event.cost_estimated ? 1 : 0,

    // Tier
    tier: event.tier,

    // Session / sequencing
    session_id: event.session_id,
    event_seq: event.event_seq,
    parent_session_id: event.parent_session_id ?? null,

    // OTel gen_ai.*
    gen_ai_system: gen.system ?? "",
    gen_ai_request_model: req.model ?? "",
    gen_ai_response_model: resp.model ?? "",
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,

    // dev_metrics.*
    event_kind: dm.event_kind,
    cost_usd: dm.cost_usd ?? 0,
    pricing_version: dm.pricing_version ?? "",
    duration_ms: dm.duration_ms ?? 0,
    tool_name: dm.tool_name ?? "",
    tool_status: dm.tool_status ?? "",
    hunk_sha256: dm.hunk_sha256 ?? null,
    file_path_hash: dm.file_path_hash ?? null,
    edit_decision: dm.edit_decision ?? "",
    revert_within_24h: dm.revert_within_24h === undefined ? null : dm.revert_within_24h ? 1 : 0,
    first_try_failure: dm.first_try_failure === undefined ? null : dm.first_try_failure ? 1 : 0,

    // Tier-C content (may be null/absent on Tier A/B — server redaction
    // pipeline runs before this canonicalize call and overwrites as needed).
    prompt_text: event.prompt_text ?? null,
    tool_input: event.tool_input === undefined ? null : JSON.stringify(event.tool_input),
    tool_output: event.tool_output === undefined ? null : JSON.stringify(event.tool_output),

    // Clio output for Tier B+
    prompt_abstract: pr?.abstract ?? null,
    prompt_embedding: pr?.embedding ?? [],
    prompt_index: pr?.prompt_index ?? 0,

    // Redaction
    redaction_count: event.redaction_count ?? 0,

    // Outcome attribution joins (from raw_attrs until promoted)
    pr_number: prNumber,
    commit_sha: commitSha,
    branch,

    // Catch-all (D16) — JSON blob as CH DDL says `String`.
    raw_attrs: event.raw_attrs === undefined ? "" : JSON.stringify(event.raw_attrs),
  };

  const canonical_json = stableStringify(row);

  return {
    tenant_id: auth.tenantId,
    engineer_id: auth.engineerId,
    device_id: event.device_id,
    client_event_id: event.client_event_id,
    schema_version: event.schema_version,
    canonical_json,
    row,
  };
}

// ---- WalAppender interface -----------------------------------------------

export interface WalAppender {
  /**
   * Append a batch of canonicalized rows to the WAL. Returns the stream ids
   * assigned by the backing store (one per row, in order). Throws on empty
   * batch or oversize row.
   */
  append(rows: CanonicalRow[]): Promise<string[]>;
  close(): Promise<void>;
}

const MAX_CANONICAL_JSON_BYTES = 256 * 1024;

function validateBatch(rows: CanonicalRow[]): void {
  if (rows.length === 0) {
    throw new Error("wal:empty-batch");
  }
  for (const r of rows) {
    // Byte-length check via TextEncoder so multibyte chars are counted correctly.
    const byteLen = new TextEncoder().encode(r.canonical_json).length;
    if (byteLen > MAX_CANONICAL_JSON_BYTES) {
      throw new Error("wal:row-too-large");
    }
  }
}

// ---- In-memory appender (dev + test) -------------------------------------

export interface InMemoryWalAppender extends WalAppender {
  drain(): CanonicalRow[];
  ids(): string[];
}

/**
 * In-process WAL. Records appended rows and assigns monotonic ids
 * `w-0`, `w-1`, .... `drain()` returns and CLEARS the buffer; `ids()` returns
 * all ids ever issued (not cleared).
 */
export function createInMemoryWalAppender(): InMemoryWalAppender {
  let buffer: CanonicalRow[] = [];
  const allIds: string[] = [];
  let counter = 0;
  return {
    async append(rows: CanonicalRow[]): Promise<string[]> {
      validateBatch(rows);
      const ids: string[] = [];
      for (const r of rows) {
        const id = `w-${counter++}`;
        ids.push(id);
        allIds.push(id);
        buffer.push(r);
      }
      return ids;
    },
    async close(): Promise<void> {
      // nothing to flush
    },
    drain(): CanonicalRow[] {
      const out = buffer;
      buffer = [];
      return out;
    },
    ids(): string[] {
      return [...allIds];
    },
  };
}

// ---- Redis Streams appender ----------------------------------------------

/**
 * Minimal Redis Streams surface the WAL needs. Kept narrow so tests can
 * back it with a simple fake. Real impl is a thin wrapper over
 * `@redis/client` (lazy-loaded at boot, not at module load).
 */
export interface WalRedis {
  xadd(stream: string, fields: Record<string, string>): Promise<string>;
  xreadgroup(
    group: string,
    consumer: string,
    stream: string,
    fromId: string,
    opts: { count: number; blockMs: number },
  ): Promise<Array<{ id: string; fields: Record<string, string> }>>;
  xack(stream: string, group: string, ids: string[]): Promise<number>;
  xclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    ids: string[],
  ): Promise<Array<{ id: string; fields: Record<string, string> }>>;
  xgroupCreate(
    stream: string,
    group: string,
    startId: string,
    opts: { mkstream: boolean },
  ): Promise<void>;
  xlen(stream: string): Promise<number>;
  xinfoGroupsPending(stream: string, group: string): Promise<number>;
}

/**
 * Redis-Streams-backed WalAppender. Issues one XADD per row with fields:
 *   tenant_id, engineer_id, client_event_id, schema_version, canonical_json
 *
 * Ordering: XADD within a single stream is globally ordered by Redis; batches
 * preserve caller order because we serialize the appends.
 */
export function createRedisStreamsWalAppender(redis: WalRedis, stream = "events_wal"): WalAppender {
  return {
    async append(rows: CanonicalRow[]): Promise<string[]> {
      validateBatch(rows);
      const ids: string[] = [];
      for (const r of rows) {
        const id = await redis.xadd(stream, {
          tenant_id: r.tenant_id,
          engineer_id: r.engineer_id,
          client_event_id: r.client_event_id,
          schema_version: String(r.schema_version),
          canonical_json: r.canonical_json,
        });
        ids.push(id);
      }
      return ids;
    },
    async close(): Promise<void> {
      // No connection ownership here — the caller owns `redis`.
    },
  };
}
