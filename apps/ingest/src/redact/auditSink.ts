// ClickHouse-backed audit sink for redaction_audit (contract 08 §Invariant #4,
// contract 09 §Side tables, migration 0010_redaction_audit.sql).
//
// The hotpath emits RedactionAuditRow instances (tenant_id-shaped); this sink
// maps `tenant_id` → CH `org_id` (same rename the WAL appender does) and
// formats DateTime64(3,'UTC') as 'YYYY-MM-DD HH:MM:SS.fff'. Writes go through
// @clickhouse/client JSONEachRow; no direct insert from the request handler.
//
// The sink is non-blocking-friendly: emit() awaits the CH insert but the
// ingest hot path calls it best-effort; failure logs + drops rather than
// failing the request (redaction already overwrote the event fields in
// memory, so the event row is safe either way).

import { logger as defaultLogger } from "../logger";
import type { RedactionAuditRow, RedactionAuditSink } from "./hotpath";

const REDACTION_AUDIT_TABLE = "redaction_audit";

interface AuditSinkLogger {
  // biome-ignore lint/suspicious/noExplicitAny: pino-shaped logger accepts any structured payload
  warn: (...a: any[]) => void;
  // biome-ignore lint/suspicious/noExplicitAny: pino-shaped logger accepts any structured payload
  error: (...a: any[]) => void;
}

/** Minimal writer the sink needs. Kept narrow so tests can back it with a fake. */
export interface AuditTableWriter {
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>;
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mi = d.getUTCMinutes().toString().padStart(2, "0");
  const ss = d.getUTCSeconds().toString().padStart(2, "0");
  const fff = d.getUTCMilliseconds().toString().padStart(3, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${fff}`;
}

function toWireRow(r: RedactionAuditRow): Record<string, unknown> {
  return {
    org_id: r.tenant_id,
    client_event_id: r.client_event_id,
    session_id: r.session_id,
    marker_seq: r.marker_seq,
    field: r.field,
    type: r.type,
    detector: r.detector,
    rule: r.rule,
    hash: r.hash,
    tier: r.tier,
    redacted_at: formatTs(r.redacted_at_ms),
  };
}

export interface ClickHouseAuditSinkOptions {
  writer: AuditTableWriter;
  logger?: AuditSinkLogger;
  table?: string;
}

/**
 * Sink backed by a ClickHouse writer. Failures are logged and swallowed: the
 * event's in-memory fields are already redacted by the time emit() runs, so
 * dropping an audit batch is strictly a recoverable observability gap.
 */
export function createClickHouseAuditSink(opts: ClickHouseAuditSinkOptions): RedactionAuditSink {
  const log = opts.logger ?? defaultLogger;
  const table = opts.table ?? REDACTION_AUDIT_TABLE;
  return {
    async emit(rows) {
      if (rows.length === 0) return;
      try {
        await opts.writer.insert(table, rows.map(toWireRow));
      } catch (err) {
        log.error(
          {
            err: err instanceof Error ? err.message : String(err),
            rows: rows.length,
            table,
          },
          "redaction_audit insert failed; dropping batch",
        );
      }
    },
  };
}

/** In-memory table writer for tests; records (table, rows) pairs. */
export interface InMemoryAuditTableWriter extends AuditTableWriter {
  readonly calls: ReadonlyArray<{ table: string; rows: Record<string, unknown>[] }>;
  setBehavior(b: "ok" | "throw"): void;
  reset(): void;
}

export function createInMemoryAuditTableWriter(): InMemoryAuditTableWriter {
  const calls: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
  let behavior: "ok" | "throw" = "ok";
  return {
    get calls() {
      return calls;
    },
    async insert(table, rows) {
      if (behavior === "throw") {
        throw new Error("audit:ch:throw");
      }
      calls.push({ table, rows: [...rows] });
    },
    setBehavior(b) {
      behavior = b;
    },
    reset() {
      calls.length = 0;
    },
  };
}

/** No-op sink — default in Deps for unit tests and dev runs without CH. */
export const noopAuditSink: RedactionAuditSink = {
  emit() {
    /* no-op */
  },
};
