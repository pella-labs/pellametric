import type { Adapter, AdapterContext, EventEmitter } from "@bematist/sdk";
import { log } from "../logger";
import { Semaphore } from "./semaphore";

export interface RunOptions {
  concurrency: number;
  perPollTimeoutMs: number;
  /**
   * Hard-kill timeout — STRICTLY LONGER than `perPollTimeoutMs`. When it
   * fires, the orchestrator stops awaiting the adapter's promise and moves
   * on. This protects the main loop from adapters that ignore the abort
   * signal. Events the adapter emitted before hard-kill are ALREADY
   * durable in the journal (streaming contract), so abandoning the
   * promise doesn't lose any work that hadn't been lost already. If not
   * provided, defaults to `max(perPollTimeoutMs * 2, perPollTimeoutMs + 30s)`.
   */
  hardKillMs?: number;
  /**
   * How long an adapter is quarantined after 3 consecutive hard-kills. While
   * quarantined, its poll is skipped entirely — so one wedged adapter can't
   * starve the others via the concurrency semaphore either. Defaults to 5m.
   */
  adapterQuarantineMs?: number;
}

const HARD_KILL_STRIKE_LIMIT = 3;
const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;

interface AdapterHealthState {
  /** Consecutive hard-kill strikes. Resets on first successful poll. */
  strikes: number;
  /** Unix-ms timestamp when quarantine expires, or 0 if not quarantined. */
  quarantinedUntil: number;
}

/**
 * Module-scoped health state — keyed by adapter id. Persisting across
 * `runOnce` invocations is the whole point (we're counting *consecutive*
 * hard-kills across polls, not within one poll). Strikes reset on daemon
 * restart, which is intentional: on restart we give every adapter a clean
 * slate and let real quarantines re-emerge if the underlying bug persists.
 */
const adapterHealth = new Map<string, AdapterHealthState>();

function getHealth(id: string): AdapterHealthState {
  let s = adapterHealth.get(id);
  if (!s) {
    s = { strikes: 0, quarantinedUntil: 0 };
    adapterHealth.set(id, s);
  }
  return s;
}

/** Exposed for tests. */
export function _resetAdapterHealth(): void {
  adapterHealth.clear();
}

function computeHardKillMs(opts: RunOptions): number {
  if (opts.hardKillMs && opts.hardKillMs > 0) return opts.hardKillMs;
  // Brief: "2x per-poll timeout OR per-poll + 30s, whichever is larger."
  const twoX = opts.perPollTimeoutMs * 2;
  const plus30s = opts.perPollTimeoutMs + 30_000;
  return Math.max(twoX, plus30s);
}

/**
 * Run every adapter's poll() concurrently (bounded by `opts.concurrency`).
 *
 * Adapters stream events via the `emit` callback as they produce them
 * (typically per-file for file-tailing adapters), so the journal sees
 * events per-file rather than one giant batch at poll end. A slow-walking
 * adapter no longer blocks the flush loop — flush runs independently on
 * its own interval in loop.ts and drains whatever's already been emitted.
 *
 * Two layers of defense against misbehaving adapters:
 *
 *   1. **Soft abort at `perPollTimeoutMs`.** Fires an AbortSignal; adapters
 *      MUST honor it — the contract is "stop emitting and return promptly."
 *      Anything the adapter emitted before abort is already durable in the
 *      journal, so a timed-out poll no longer loses work the way the old
 *      `Promise<Event[]>`-returning version did (Walid's 4,971-file
 *      backfill — it timed out at 30s, returned [], and subsequent polls
 *      skipped those files because cursor signatures marked them "done").
 *
 *   2. **Hard-kill at `hardKillMs`.** `Promise.race` against a watchdog
 *      timer. If an adapter never resolves (stuck NFS stat, stuck SQLite
 *      lock wait, stuck fetch), the race resolves and we log at WARN that
 *      the adapter ignored abort. After 3 consecutive hard-kills the
 *      adapter is quarantined for `adapterQuarantineMs` — skipped
 *      entirely so it can't starve the concurrency semaphore. Strikes
 *      reset on first successful poll after quarantine.
 *
 * Uses `Promise.allSettled` so one throwing adapter doesn't take down the
 * rest of the batch. Rejected results are logged; other adapters' events
 * still flow to the journal.
 *
 * Note: a hard-killed adapter's promise is orphaned — it may keep running
 * in the background until it eventually resolves or the process exits.
 * That's intentional: we care about liveness of the main loop, not about
 * the adapter's internal state. Any cursor writes the orphan completes
 * after hard-kill are written via the shared SqliteCursorStore and remain
 * valid; we just don't wait for them. Any additional emit() calls the
 * orphan makes post-hard-kill also still land in the journal — the
 * callback is a plain closure over `journal.enqueue`, not gated on the
 * orchestrator's liveness.
 */
export async function runOnce(
  adapters: Adapter[],
  ctxFactory: (adapter: Adapter) => AdapterContext,
  opts: RunOptions,
  emit: EventEmitter,
): Promise<void> {
  const sem = new Semaphore(opts.concurrency);
  const hardKillMs = computeHardKillMs(opts);
  const quarantineMs = opts.adapterQuarantineMs ?? DEFAULT_QUARANTINE_MS;
  const now = Date.now();

  await Promise.allSettled(
    adapters.map(async (a) => {
      const health = getHealth(a.id);

      // Quarantine check — skip entirely, don't even acquire the semaphore
      // so one bad adapter can't starve concurrency. On expiry, let it
      // poll again; strikes stay on the books until the first success.
      if (health.quarantinedUntil > now) {
        log.debug(
          {
            adapter: a.id,
            quarantineExpiresInMs: health.quarantinedUntil - now,
          },
          "adapter quarantined — skipping poll",
        );
        return;
      }

      await sem.acquire();
      try {
        const ctx = ctxFactory(a);
        const ac = new AbortController();
        const softTimer =
          opts.perPollTimeoutMs > 0
            ? setTimeout(() => {
                ac.abort();
                log.debug(
                  { adapter: a.id, ms: opts.perPollTimeoutMs },
                  "adapter poll soft timeout — signaling abort",
                );
              }, opts.perPollTimeoutMs)
            : null;

        // Hard-kill race — resolves (not throws) so we can distinguish
        // "adapter ignored abort" from "adapter threw."
        let hardKillTimer: ReturnType<typeof setTimeout> | null = null;
        let hardKilled = false;
        const hardKillPromise = new Promise<void>((resolve) => {
          hardKillTimer = setTimeout(() => {
            hardKilled = true;
            log.warn(
              { adapter: a.id, ms: hardKillMs },
              "adapter hard-killed after ignoring abort signal",
            );
            resolve();
          }, hardKillMs);
        });

        try {
          await Promise.race([a.poll(ctx, ac.signal, emit), hardKillPromise]);

          if (hardKilled) {
            health.strikes += 1;
            if (health.strikes >= HARD_KILL_STRIKE_LIMIT) {
              health.quarantinedUntil = Date.now() + quarantineMs;
              log.warn(
                {
                  adapter: a.id,
                  strikes: health.strikes,
                  quarantineMs,
                  expiresAt: new Date(health.quarantinedUntil).toISOString(),
                },
                "adapter quarantined after consecutive hard-kills",
              );
              // Reset strikes so post-quarantine first hard-kill starts at 1
              // again rather than immediately re-quarantining.
              health.strikes = 0;
            }
          } else {
            // Successful poll (even with zero emits) — clear strikes.
            // This is the "reset on first successful poll after quarantine"
            // behavior from the brief.
            if (health.strikes > 0) {
              log.debug(
                { adapter: a.id, previousStrikes: health.strikes },
                "adapter recovered — clearing hard-kill strikes",
              );
              health.strikes = 0;
            }
          }
        } catch (e) {
          // Throwing counts as a "not-hang" — the adapter is misbehaving
          // in a different way. Don't accrue hard-kill strikes for
          // exceptions; let the logger surface them.
          log.warn({ adapter: a.id, err: String(e) }, "adapter poll failed");
        } finally {
          if (softTimer) clearTimeout(softTimer);
          if (hardKillTimer) clearTimeout(hardKillTimer);
        }
      } finally {
        sem.release();
      }
    }),
  );
}

export { Semaphore } from "./semaphore";
