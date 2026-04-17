// In-process reconciliation cron scaffolding (Sprint-1 Phase 6).
//
// TODO (Jorge, Sprint-2): move to PgBoss cron per D-S1-18. This in-process
// `setInterval` is the simplest thing that could work for a single-instance
// M1 deploy — it survives ingest restarts by re-running at boot.
//
// Jitter prevents thundering-herd across replicas in a horizontally-scaled
// deployment once we migrate to PgBoss.

export interface StartReconciliationCronInput {
  /** Nominal interval in ms (default 24h). */
  interval?: number;
  /** ±jitter window in ms (default 5min). */
  jitterMs?: number;
  /** Work function; invoked on each tick. Errors logged and swallowed. */
  run: () => Promise<void> | void;
  /** Clock injection for fake-timer tests. */
  clock?: () => number;
  /** Error sink; defaults to console.error. */
  onError?: (err: unknown) => void;
}

export interface ReconciliationCronHandle {
  stop(): void;
}

function randomJitter(jitterMs: number): number {
  if (jitterMs <= 0) return 0;
  // Intentionally non-cryptographic; test doubles can override Math.random.
  return Math.floor((Math.random() * 2 - 1) * jitterMs);
}

/**
 * Schedule `run` every `interval ± jitterMs`. Returns a handle with `stop()`.
 * Not a real cron parser — suitable for Sprint-1 daily tick.
 */
export function startReconciliationCron(
  input: StartReconciliationCronInput,
): ReconciliationCronHandle {
  const interval = input.interval ?? 24 * 60 * 60 * 1000;
  const jitterMs = input.jitterMs ?? 5 * 60 * 1000;
  const onError = input.onError ?? ((err) => console.error("[reconcile-cron]", err));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await input.run();
    } catch (err) {
      onError(err);
    }
    if (stopped) return;
    timer = setTimeout(tick, Math.max(0, interval + randomJitter(jitterMs)));
  };

  timer = setTimeout(tick, Math.max(0, interval + randomJitter(jitterMs)));

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
