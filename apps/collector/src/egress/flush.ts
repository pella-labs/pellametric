// Batched flush — the bridge between the Journal and the ingest server.
//
// For each flush cycle:
//   1. Select a batch of pending rows from the Journal.
//   2. Write a batch descriptor to the append-only egress log (Bill of
//      Rights #1) BEFORE any network I/O — so an operator always has the
//      audit trail, even if the process dies mid-POST.
//   3. POST to `${endpoint}/v1/events` with retry via postWithRetry.
//   4. Interpret the response:
//      - 202 → all submitted
//      - 207 → per-index accept/reject — per-row rejects go to dead_letter
//      - 400 / 413 → permanent batch reject → dead_letter
//      - 401 / 403 → fatal; caller halts (auth is broken); rows stay pending
//      - 429 → cooling with server-supplied Retry-After
//      - 5xx / network error → cooling with per-row exponential backoff
//
// Tested in flush.test.ts.

import { log } from "../logger";
import type { EgressLog } from "./egressLog";
import { postWithRetry } from "./httpClient";
import type { Journal, PendingRow } from "./journal";

export interface FlushOptions {
  endpoint: string;
  token: string;
  fetchImpl: typeof fetch;
  dryRun: boolean;
  batchSize: number;
  ingestOnlyTo: string | null;
  signal?: AbortSignal;
}

export interface FlushResult {
  submitted: number;
  failed: number;
  fatal: boolean;
  retryAfterSeconds: number | null;
  note?: string;
}

/**
 * Per-row exponential backoff with ±10% jitter.
 *   base = 200ms; cap = 30min.
 * Reading: attempt 0 → ~200ms; attempt 5 → ~6.4s; attempt 10 → ~3.4min;
 * attempt 12 → cap (30min). MAX_RETRIES=12 in journal.ts so we never exceed.
 */
export function computeBackoffMs(retryCount: number): number {
  const BASE_MS = 200;
  const CAP_MS = 30 * 60 * 1000;
  const exp = Math.min(CAP_MS, BASE_MS * 2 ** retryCount);
  // ±10% jitter — avoid thundering herd without breaking determinism too much.
  const jitter = exp * 0.1 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
}

/**
 * Mark an entire batch as cooling with per-row backoff keyed on that row's
 * current retry_count. Rows in the same batch may have different retry_counts
 * (a cooling row could be re-selected alongside a fresh pending row); we
 * compute the cooldown per-row so neither gets punished by the other.
 */
function markBatchCooling(journal: Journal, rows: PendingRow[], reason: string): void {
  // Group by retry_count so we make one journal.markFailed call per group.
  const groups = new Map<number, string[]>();
  for (const r of rows) {
    const list = groups.get(r.retry_count) ?? [];
    list.push(r.client_event_id);
    groups.set(r.retry_count, list);
  }
  for (const [retryCount, ids] of groups) {
    journal.markFailed(ids, reason, { retryAfterMs: computeBackoffMs(retryCount) });
  }
}

/**
 * Variant of markBatchCooling that uses a caller-supplied fixed delay (429's
 * Retry-After). retry_count still increments per row.
 */
function markBatchCoolingFixed(
  journal: Journal,
  rows: PendingRow[],
  reason: string,
  retryAfterMs: number,
): void {
  journal.markFailed(
    rows.map((r) => r.client_event_id),
    reason,
    { retryAfterMs },
  );
}

export async function flushBatch(
  journal: Journal,
  egress: EgressLog,
  opts: FlushOptions,
): Promise<FlushResult> {
  const pending = journal.selectPending(opts.batchSize);
  if (pending.length === 0) {
    return { submitted: 0, failed: 0, fatal: false, retryAfterSeconds: null };
  }

  const events = pending.map((r) => JSON.parse(r.body_json));
  const body = JSON.stringify({ events });
  const ids = pending.map((r) => r.client_event_id);
  const logEntryBase = {
    ts: new Date().toISOString(),
    endpoint: `${opts.endpoint}/v1/events`,
    eventCount: pending.length,
    clientEventIds: ids,
    bodyBytes: body.length,
  };

  // Bill of Rights #1 — audit trail is written BEFORE POST.
  egress.write({
    ...logEntryBase,
    dryRun: opts.dryRun,
    ...(opts.dryRun ? { note: "dry-run: no network egress" } : {}),
  });

  if (opts.dryRun) {
    return {
      submitted: 0,
      failed: 0,
      fatal: false,
      retryAfterSeconds: null,
      note: "dry-run",
    };
  }

  const url = `${opts.endpoint}/v1/events`;
  const httpOpts: import("./httpClient").HttpClientOptions = {
    fetchImpl: opts.fetchImpl,
    ingestOnlyTo: opts.ingestOnlyTo,
  };
  if (opts.signal) httpOpts.signal = opts.signal;
  const result = await postWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.token}`,
      },
      body,
    },
    httpOpts,
  );

  // Retries exhausted + network error → cooling with per-row backoff.
  if (result.error) {
    markBatchCooling(journal, pending, `network: ${result.error.message}`);
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: result.retryAfterSeconds,
      note: `network: ${result.error.message}`,
    };
  }

  const res = result.response;
  if (!res) {
    markBatchCooling(journal, pending, "no response");
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 202) {
    journal.markSubmitted(ids);
    return {
      submitted: pending.length,
      failed: 0,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 207) {
    const payload = (await res.json().catch(() => ({}))) as {
      rejected?: Array<{ index: number; reason: string }>;
    };
    const rejectedIdx = new Set((payload.rejected ?? []).map((r) => r.index));
    const submittedIds: string[] = [];
    const failedIds: string[] = [];
    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      if (!row) continue;
      (rejectedIdx.has(i) ? failedIds : submittedIds).push(row.client_event_id);
    }
    journal.markSubmitted(submittedIds);
    // Per-row server rejects are permanent — the same payload will be rejected
    // by any replay. Move them straight to dead_letter so they never block
    // newer rows behind them.
    journal.markFailed(failedIds, `207 partial: ${JSON.stringify(payload.rejected ?? "unknown")}`, {
      permanent: true,
    });
    return {
      submitted: submittedIds.length,
      failed: failedIds.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 400 || res.status === 413) {
    const text = await res.text().catch(() => "");
    // Schema violation (400) and payload-too-large (413) are both caller-side
    // problems — retrying the SAME bytes won't help. Dead-letter immediately
    // so the poison pill stops blocking the queue behind it.
    journal.markFailed(ids, `${res.status}: ${text}`, { permanent: true });
    log.warn(
      { status: res.status, body: text, count: pending.length },
      "egress permanent 4xx — dead-lettering batch",
    );
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: null,
      note: `${res.status}`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    // Auth failure — rows are VALID. Halt the worker; leave rows pending so
    // they flush once the operator fixes BEMATIST_TOKEN. No markFailed call.
    log.fatal({ status: res.status }, "egress auth fatal — halting. check BEMATIST_TOKEN.");
    return {
      submitted: 0,
      failed: 0,
      fatal: true,
      retryAfterSeconds: null,
      note: `auth ${res.status}`,
    };
  }

  if (res.status === 429) {
    // Rate-limited. Honor server's Retry-After (or 30s default) — cool the
    // batch until then, retry_count++ per row so repeated 429s eventually cap.
    const retryAfterMs = (result.retryAfterSeconds ?? 30) * 1000;
    markBatchCoolingFixed(journal, pending, "rate-limited", retryAfterMs);
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: result.retryAfterSeconds,
      note: "rate-limited",
    };
  }

  // 5xx after retries exhausted in postWithRetry — cool per-row.
  const text = await res.text().catch(() => "");
  markBatchCooling(journal, pending, `${res.status}: ${text}`);
  return {
    submitted: 0,
    failed: pending.length,
    fatal: false,
    retryAfterSeconds: result.retryAfterSeconds,
    note: `${res.status}`,
  };
}
