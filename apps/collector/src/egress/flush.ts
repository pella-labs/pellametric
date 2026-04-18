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
//      - 207 → per-index accept/reject
//      - 400 / 413 → non-retry failure on this batch; mark failed, move on
//      - 401 / 403 → fatal; caller halts (auth is broken)
//      - 429 / 5xx → retried within postWithRetry; if still failing, rows
//        stay pending and we surface retryAfterSeconds to the caller.
//      - network error → rows stay pending
//
// Tested in flush.test.ts.

import { log } from "../logger";
import type { EgressLog } from "./egressLog";
import { postWithRetry } from "./httpClient";
import type { Journal } from "./journal";

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

  // Retries exhausted + network error → rows stay pending, retry next cycle.
  if (result.error) {
    journal.markFailed(ids, `network: ${result.error.message}`);
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
    journal.markFailed(ids, "no response");
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
    journal.markFailed(failedIds, `207 partial: ${JSON.stringify(payload.rejected ?? "unknown")}`);
    return {
      submitted: submittedIds.length,
      failed: failedIds.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 400 || res.status === 413) {
    const text = await res.text().catch(() => "");
    journal.markFailed(ids, `${res.status}: ${text}`);
    log.warn(
      { status: res.status, body: text },
      "egress non-retry 4xx — dropping batch from active retry",
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
    // postWithRetry already spent its retries; rows remain pending.
    return {
      submitted: 0,
      failed: 0,
      fatal: false,
      retryAfterSeconds: result.retryAfterSeconds,
      note: "rate-limited",
    };
  }

  // 5xx after retries — leave pending, surface the status as a note.
  const text = await res.text().catch(() => "");
  journal.markFailed(ids, `${res.status}: ${text}`);
  return {
    submitted: 0,
    failed: pending.length,
    fatal: false,
    retryAfterSeconds: result.retryAfterSeconds,
    note: `${res.status}`,
  };
}
