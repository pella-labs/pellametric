import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { log } from "../logger";
import { Semaphore } from "./semaphore";

export interface RunOptions {
  concurrency: number;
  perPollTimeoutMs: number;
}

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
        const timer = setTimeout(() => ac.abort(), opts.perPollTimeoutMs);
        try {
          const raced = await Promise.race<Event[]>([
            a.poll(ctx, ac.signal),
            new Promise<Event[]>((resolve) => {
              setTimeout(() => resolve([]), opts.perPollTimeoutMs);
            }),
          ]);
          return raced;
        } catch (e) {
          log.warn({ adapter: a.id, err: String(e) }, "adapter poll failed");
          return [];
        } finally {
          clearTimeout(timer);
        }
      } finally {
        sem.release();
      }
    }),
  );
  return results.flat();
}

export { Semaphore } from "./semaphore";
