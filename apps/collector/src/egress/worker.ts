import { log } from "../logger";
import type { Journal } from "./journal";

export interface FlushOptions {
  endpoint: string;
  token: string;
  fetch: typeof fetch;
  dryRun: boolean;
  batchSize?: number;
}

export interface FlushResult {
  submitted: number;
  failed: number;
  fatal: boolean;
  retryAfterSeconds: number | null;
}

const DEFAULT_BATCH = 1000;

export async function flushOnce(j: Journal, opts: FlushOptions): Promise<FlushResult> {
  const pending = j.selectPending(opts.batchSize ?? DEFAULT_BATCH);
  if (pending.length === 0) {
    return { submitted: 0, failed: 0, fatal: false, retryAfterSeconds: null };
  }

  if (opts.dryRun) {
    log.info({ count: pending.length }, "egress dry-run: would POST events");
    return { submitted: 0, failed: 0, fatal: false, retryAfterSeconds: null };
  }

  const body = JSON.stringify({
    events: pending.map((r) => JSON.parse(r.body_json)),
  });

  let res: Response;
  try {
    res = await opts.fetch(`${opts.endpoint}/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.token}`,
      },
      body,
    });
  } catch (e) {
    j.markFailed(
      pending.map((r) => r.client_event_id),
      `network: ${String(e)}`,
    );
    return { submitted: 0, failed: pending.length, fatal: false, retryAfterSeconds: null };
  }

  if (res.status === 202) {
    j.markSubmitted(pending.map((r) => r.client_event_id));
    return { submitted: pending.length, failed: 0, fatal: false, retryAfterSeconds: null };
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
    j.markSubmitted(submittedIds);
    const reason = JSON.stringify(payload.rejected ?? "unknown");
    j.markFailed(failedIds, `207 partial: ${reason}`);
    return {
      submitted: submittedIds.length,
      failed: failedIds.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 400) {
    const text = await res.text().catch(() => "");
    j.markFailed(
      pending.map((r) => r.client_event_id),
      `400: ${text}`,
    );
    log.warn({ status: 400, body: text }, "egress 400 — do not retry this batch");
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 401 || res.status === 403) {
    log.fatal({ status: res.status }, "egress auth fatal — halting worker");
    return { submitted: 0, failed: 0, fatal: true, retryAfterSeconds: null };
  }

  if (res.status === 413) {
    j.markFailed(
      pending.map((r) => r.client_event_id),
      "413 payload too large",
    );
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 429) {
    const ra = Number.parseInt(res.headers.get("Retry-After") ?? "1", 10);
    return {
      submitted: 0,
      failed: 0,
      fatal: false,
      retryAfterSeconds: Number.isFinite(ra) ? ra : 1,
    };
  }

  const text = await res.text().catch(() => "");
  j.markFailed(
    pending.map((r) => r.client_event_id),
    `${res.status}: ${text}`,
  );
  return {
    submitted: 0,
    failed: pending.length,
    fatal: false,
    retryAfterSeconds: null,
  };
}
