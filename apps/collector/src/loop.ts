// Main daemon loop.
//
// Responsibilities:
//   1. Build adapter registry, init each adapter. Skip-if-absent is handled
//      inside each adapter's discovery layer; init still runs, but poll() is
//      a no-op when the underlying source (e.g. ~/.claude/projects/) doesn't
//      exist. See apps/collector/src/adapters/*/discovery.ts.
//   2. Every pollIntervalMs: call runOnce() across every adapter. Adapters
//      stream events via the `emit` callback, which enqueues into the
//      SQLite Journal per-event. No in-memory Event[] batching at the loop
//      layer — that was the 20-minute-silent-window pathology from the
//      pre-2026-04-19 loop (Walid's 4,975-file backfill).
//   3. Every flushIntervalMs: select a batch from Journal, write the batch
//      descriptor to the append-only egress log (Bill of Rights #1), POST
//      the events to the ingest via postWithRetry, update Journal rows.
//   4. Every journalPruneIntervalMs (+ once ~5s after boot): Journal.prune()
//      drops submitted rows past `journalSubmittedRetentionDays` and dead-
//      letter rows past `journalDeadLetterRetentionDays`, keeping the
//      SQLite file bounded on long-running daemons. The egress.jsonl still
//      carries the full audit trail.
//   5. On SIGINT/SIGTERM: stop the loop, wait for in-flight poll + flush to
//      finish, persist cursor state, close DB.
//
// Tested in loop.test.ts.
//
// ───────────────────────────────────────────────────────────────────────────
// Streaming refactor (2026-04-19): previously this loop ran poll / flush /
// prune inside one serialized while-loop decremented by TICK_MS. A long
// first-poll backfill (~4,975 JSONL files) blocked flush for ~20 minutes —
// cursors advanced per-file but events were held in one in-memory array
// until poll returned. Poll / flush / prune now run as independent
// Promise.all tasks sharing the abort signal. Adapters emit events via a
// callback wired to `journal.enqueue`, so events land in SQLite per-file
// and flush drains whatever's already queued.
// ───────────────────────────────────────────────────────────────────────────

import type { Database } from "bun:sqlite";
import type { Event } from "@bematist/schema";
import type { Adapter } from "@bematist/sdk";
import { buildRegistry } from "./adapters";
import type { CollectorConfig } from "./config";
import { SqliteCursorStore } from "./cursor/store";
import type { EgressLog } from "./egress/egressLog";
import { flushBatch } from "./egress/flush";
import type { Journal } from "./egress/journal";
import { log } from "./logger";
import { runOnce } from "./orchestrator";

export interface LoopDeps {
  db: Database;
  journal: Journal;
  egressLog: EgressLog;
  config: CollectorConfig;
  /** Optional injected fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Optional injected registry for tests; defaults to buildRegistry. */
  registry?: Adapter[];
  /** Optional sleep injection — tests skip real timers. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface LoopHandle {
  /** Trigger graceful shutdown; resolves once the loop has stopped. */
  stop(): Promise<void>;
  /** Promise that resolves when the loop has fully stopped (for tests / top-level await). */
  done: Promise<void>;
  /** Current active-adapter list. */
  adapters: Adapter[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Abort-aware sleep. Slices the wait into 100ms ticks so the loop exits
 * within one tick of `isAborted()` flipping true — even when the nominal
 * interval is in the minutes (journalPruneIntervalMs default is 24h).
 */
async function interruptibleSleep(
  totalMs: number,
  sleepImpl: (ms: number) => Promise<void>,
  isAborted: () => boolean,
): Promise<void> {
  const TICK_MS = 100;
  let remaining = totalMs;
  while (remaining > 0) {
    if (isAborted()) return;
    const chunk = Math.min(TICK_MS, remaining);
    await sleepImpl(chunk);
    remaining -= chunk;
  }
}

// Kick the first prune tick ~5s after startup so we don't race the
// migration + first-poll-backfill burst, but short-lived daemons still get
// one GC pass.
const STARTUP_PRUNE_DELAY_MS = 5_000;

function mkAdapterLogger() {
  const noop = () => {};
  const l = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child() {
      return l;
    },
  };
  return l;
}

function mkAdapterContext(config: CollectorConfig, db: Database, a: Adapter) {
  return {
    dataDir: config.dataDir,
    policy: {
      enabled: true,
      tier: config.tier,
      pollIntervalMs: config.pollIntervalMs,
    },
    log: mkAdapterLogger(),
    tier: config.tier,
    cursor: new SqliteCursorStore(db, a.id),
  };
}

/**
 * Start the daemon loop. Returns a handle; the loop runs until `handle.stop()`
 * is called or the abort signal fires.
 */
export function startLoop(deps: LoopDeps): LoopHandle {
  const { db, journal, egressLog, config } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleepImpl = deps.sleepImpl ?? defaultSleep;

  const registry =
    deps.registry ??
    buildRegistry({
      tenantId: config.tenantId,
      engineerId: config.engineerId,
      deviceId: config.deviceId,
    });

  const ac = new AbortController();
  let stopped = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  // Shared halt signal — set when a fatal flush result tells us to give up.
  let fatalHalt = false;

  /**
   * Streaming emit — wired to the journal. Every adapter event lands in
   * SQLite per-emit, so the flush loop (running independently) can drain
   * whatever's already durable without waiting for poll to finish.
   *
   * The closure is intentionally NOT gated on `ac.signal.aborted` — if an
   * orphaned (hard-killed) adapter emits post-abort, we still want that
   * event in the journal. The idempotency gate (deterministicId +
   * server-side Redis SETNX) collapses any replays on the next poll.
   */
  const emit = (event: Event) => {
    try {
      journal.enqueue(event);
    } catch (e) {
      log.warn({ err: String(e) }, "journal.enqueue failed (event dropped)");
    }
  };

  const pollLoop = async () => {
    while (!ac.signal.aborted && !fatalHalt) {
      try {
        await runOnce(
          registry,
          (a) => mkAdapterContext(config, db, a),
          {
            concurrency: config.adapterConcurrency,
            perPollTimeoutMs: config.perPollTimeoutMs,
            hardKillMs: config.hardKillMs,
            adapterQuarantineMs: config.adapterQuarantineMs,
          },
          emit,
        );
      } catch (e) {
        log.warn({ err: String(e) }, "orchestrator poll cycle failed");
      }
      if (ac.signal.aborted || fatalHalt) break;
      await interruptibleSleep(
        config.pollIntervalMs,
        sleepImpl,
        () => ac.signal.aborted || fatalHalt,
      );
    }
  };

  const flushLoop = async () => {
    while (!ac.signal.aborted && !fatalHalt) {
      let delayMs = config.flushIntervalMs;
      try {
        const result = await flushBatch(journal, egressLog, {
          endpoint: config.endpoint,
          token: config.token,
          fetchImpl,
          dryRun: config.dryRun,
          batchSize: config.batchSize,
          ingestOnlyTo: config.ingestOnlyTo,
          signal: ac.signal,
        });
        if (result.fatal) {
          log.fatal({ reason: result.note }, "egress fatal — halting loop");
          fatalHalt = true;
          ac.abort();
          break;
        }
        if (result.retryAfterSeconds) {
          delayMs = Math.max(config.flushIntervalMs, result.retryAfterSeconds * 1000);
        }
      } catch (e) {
        log.warn({ err: String(e) }, "flush cycle failed");
      }
      if (ac.signal.aborted || fatalHalt) break;
      await interruptibleSleep(delayMs, sleepImpl, () => ac.signal.aborted || fatalHalt);
    }
  };

  const pruneLoop = async () => {
    // Delay the first prune so we don't race startup. Slice the startup
    // wait into small ticks so graceful shutdown doesn't block the whole
    // 5s on its way out.
    await interruptibleSleep(STARTUP_PRUNE_DELAY_MS, sleepImpl, () => ac.signal.aborted || fatalHalt);
    while (!ac.signal.aborted && !fatalHalt) {
      try {
        const t0 = Date.now();
        const { submittedDeleted, deadLetterDeleted } = journal.prune({
          submittedRetentionDays: config.journalSubmittedRetentionDays,
          deadLetterRetentionDays: config.journalDeadLetterRetentionDays,
        });
        log.info(
          {
            pruned_submitted: submittedDeleted,
            pruned_dead_letter: deadLetterDeleted,
            duration_ms: Date.now() - t0,
          },
          "journal prune tick",
        );
      } catch (e) {
        log.warn({ err: String(e) }, "journal prune failed");
      }
      if (ac.signal.aborted || fatalHalt) break;
      await interruptibleSleep(
        config.journalPruneIntervalMs,
        sleepImpl,
        () => ac.signal.aborted || fatalHalt,
      );
    }
  };

  const run = async () => {
    // Init adapters. Adapter-level failures are non-fatal: log + skip.
    for (const a of registry) {
      try {
        await a.init(mkAdapterContext(config, db, a));
      } catch (e) {
        log.warn({ adapter: a.id, err: String(e) }, "adapter init failed");
      }
    }

    // Run poll / flush / prune as independent async loops — neither blocks
    // the others. Poll emits per-file, flush drains in parallel, prune
    // keeps the journal SQLite file bounded on long-running daemons.
    await Promise.all([pollLoop(), flushLoop(), pruneLoop()]);

    // Shutdown: one last flush pass so we don't leave in-flight-but-unpushed rows.
    if (!fatalHalt) {
      try {
        await flushBatch(journal, egressLog, {
          endpoint: config.endpoint,
          token: config.token,
          fetchImpl,
          dryRun: config.dryRun,
          batchSize: config.batchSize,
          ingestOnlyTo: config.ingestOnlyTo,
        });
      } catch (e) {
        log.warn({ err: String(e) }, "shutdown flush failed");
      }
    }

    for (const a of registry) {
      try {
        await a.shutdown?.(mkAdapterContext(config, db, a));
      } catch {}
    }
    resolveDone();
  };

  // Kick the loop; don't await here — return the handle.
  run().catch((e) => {
    log.error({ err: String(e) }, "loop crashed");
    resolveDone();
  });

  return {
    adapters: registry,
    done,
    async stop() {
      if (stopped) return done;
      stopped = true;
      ac.abort();
      return done;
    },
  };
}
