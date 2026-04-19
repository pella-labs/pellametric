import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { log } from "../logger";
import { Semaphore } from "./semaphore";

export interface RunOptions {
  concurrency: number;
  perPollTimeoutMs: number;
}

/**
 * Run every adapter's poll() concurrently (bounded by `opts.concurrency`)
 * and collect whatever events they emit.
 *
 * On timeout: the abort signal fires. Adapters MUST honor it — the
 * contract is "finish the current file and return what you've emitted
 * so far." We then take whatever the Promise resolves with, even if
 * partial. We do NOT race the poll against a "resolve([])" timeout —
 * that silently discarded events the adapter had already emitted and
 * (worse) let the adapter keep running past the race, updating cursor
 * state for work whose output we'd already thrown away. Walid hit this
 * with 4,971 JSONL files: the first-poll backfill timed out at 30s, we
 * returned [], and subsequent polls skipped those files because the
 * cursor signatures marked them "done."
 *
 * A misbehaving adapter that ignores the signal can still hang this
 * function longer than `perPollTimeoutMs`. That's a known trade-off —
 * we'd rather a slow adapter than lost events.
 */
export async function runOnce(
  adapters: Adapter[],
  ctxFactory: (adapter: Adapter) => AdapterContext,
  opts: RunOptions,
): Promise<Event[]> {
  const sem = new Semaphore(opts.concurrency);
  const results = await Promise.all(
    adapters.map(async (a) => {
      await sem.acquire();
      try {
        const ctx = ctxFactory(a);
        const ac = new AbortController();
        const timer =
          opts.perPollTimeoutMs > 0
            ? setTimeout(() => {
                ac.abort();
                log.debug(
                  { adapter: a.id, ms: opts.perPollTimeoutMs },
                  "adapter poll timeout — signaling abort",
                );
              }, opts.perPollTimeoutMs)
            : null;
        try {
          const events = await a.poll(ctx, ac.signal);
          return events;
        } catch (e) {
          log.warn({ adapter: a.id, err: String(e) }, "adapter poll failed");
          return [];
        } finally {
          if (timer) clearTimeout(timer);
        }
      } finally {
        sem.release();
      }
    }),
  );
  return results.flat();
}

export { Semaphore } from "./semaphore";
