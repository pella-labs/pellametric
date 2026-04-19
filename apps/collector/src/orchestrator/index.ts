import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { log } from "../logger";
import { Semaphore } from "./semaphore";

export interface RunOptions {
  concurrency: number;
  perPollTimeoutMs: number;
  /**
   * Hard-kill timeout — STRICTLY LONGER than `perPollTimeoutMs`. When it
   * fires, the orchestrator stops awaiting the adapter's promise and moves
   * on. This protects the main loop from adapters that ignore the abort
   * signal (Codex/Cursor/OpenCode/VSCode-generic all currently do). If not
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
 * Run every adapter's poll() concurrently (bounded by `opts.concurrency`)
 * and collect whatever events they emit.
 *
 * Two layers of defense against misbehaving adapters:
 *
 *   1. **Soft abort at `perPollTimeoutMs`.** Fires an AbortSignal; adapters
 *      MUST honor it — the contract is "finish the current file and return
 *      what you've emitted so far." Claude Code honors this today; other
 *      adapters currently ignore it (bug #6).
 *
 *   2. **Hard-kill at `hardKillMs`.** `Promise.race` against a watchdog
 *      timer. If an adapter never resolves (stuck NFS stat, stuck SQLite
 *      lock wait, stuck fetch), the race resolves with `[]` and we log at
 *      WARN that the adapter ignored abort. After 3 consecutive hard-kills
 *      the adapter is quarantined for `adapterQuarantineMs` — skipped
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
 * valid; we just don't wait for them.
 */
export async function runOnce(
  adapters: Adapter[],
  ctxFactory: (adapter: Adapter) => AdapterContext,
  opts: RunOptions,
): Promise<Event[]> {
  const sem = new Semaphore(opts.concurrency);
  const hardKillMs = computeHardKillMs(opts);
  const quarantineMs = opts.adapterQuarantineMs ?? DEFAULT_QUARANTINE_MS;
  const now = Date.now();

  const settled = await Promise.allSettled(
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
        return [] as Event[];
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

        // Hard-kill race — resolves with [] (not throws) so we can
        // distinguish "adapter ignored abort" from "adapter threw".
        let hardKillTimer: ReturnType<typeof setTimeout> | null = null;
        let hardKilled = false;
        const hardKillPromise = new Promise<Event[]>((resolve) => {
          hardKillTimer = setTimeout(() => {
            hardKilled = true;
            log.warn(
              { adapter: a.id, ms: hardKillMs },
              "adapter hard-killed after ignoring abort signal",
            );
            resolve([]);
          }, hardKillMs);
        });

        try {
          const events = await Promise.race([a.poll(ctx, ac.signal), hardKillPromise]);

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
            // Successful poll (even with zero events) — clear strikes.
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
          return events;
        } catch (e) {
          // Throwing counts as a "not-hang" — the adapter is misbehaving
          // in a different way. Don't accrue hard-kill strikes for
          // exceptions; let the logger surface them. allSettled will
          // capture the rejection at the top level; but we catch here so
          // the result is a normal resolved [] for this adapter and one
          // throwing adapter doesn't mark the whole run as failed.
          log.warn({ adapter: a.id, err: String(e) }, "adapter poll failed");
          return [] as Event[];
        } finally {
          if (softTimer) clearTimeout(softTimer);
          if (hardKillTimer) clearTimeout(hardKillTimer);
        }
      } finally {
        sem.release();
      }
    }),
  );

  const events: Event[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      events.push(...r.value);
    } else {
      // Should be unreachable — the per-adapter async fn catches its own
      // errors and returns []. Logged defensively in case a future edit
      // lets an exception escape (e.g. a semaphore release bug).
      log.warn({ err: String(r.reason) }, "orchestrator adapter task rejected");
    }
  }
  return events;
}

export { Semaphore } from "./semaphore";
