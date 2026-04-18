// Phase 1 RLIMIT_CORE handling. Crash-dump files can leak Tier-C prompt text
// and secrets to disk; ulimit -c 0 is also required on Dockerfile entrypoint
// (Sebastian/Foundation). This file is the in-process belt.
//
// M7 fix: on Node and Bun, `process.setrlimit` / `process.getrlimit` are
// NOT exposed (no equivalent to Go's `syscall.Setrlimit`). The previous
// "rlimit.core applied" banner was theater — nothing actually happened.
// Now we log honestly at WARN: `code:RLIMIT_SKIPPED` with a pointer to
// the Dockerfile enforcement point. The Dockerfile `ulimit -c 0` (or the
// systemd LimitCORE= directive, or the k8s pod-spec) is load-bearing
// alone for the "no crash dumps" invariant.

type RlimitProc = NodeJS.Process & {
  setrlimit?: (resource: string, limits: { soft: number; hard: number }) => void;
  getrlimit?: (resource: string) => { soft: number; hard: number };
};

export interface CoreRlimitResult {
  /** The soft limit after (or before, if we could not set it). */
  rlimit_core: number;
  /** Whether the platform exposed a setrlimit API we could call. */
  applied: boolean;
  /** Error message if setrlimit threw. */
  error?: string;
}

export interface RlimitLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn?: (obj: Record<string, unknown>, msg?: string) => void;
  error?: (obj: Record<string, unknown>, msg?: string) => void;
}

export function applyCoreRlimit(logger: RlimitLogger): CoreRlimitResult {
  const proc = process as RlimitProc;
  let rlimitCore = 0;
  let applied = false;
  let error: string | undefined;

  try {
    if (typeof proc.setrlimit === "function") {
      proc.setrlimit("core", { soft: 0, hard: 0 });
      applied = true;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  try {
    if (typeof proc.getrlimit === "function") {
      const r = proc.getrlimit("core");
      rlimitCore = r.soft ?? 0;
    }
  } catch {
    // ignore; keep rlimit_core at 0 default
  }

  const result: CoreRlimitResult =
    error !== undefined
      ? { rlimit_core: rlimitCore, applied, error }
      : { rlimit_core: rlimitCore, applied };

  // M7 fix: log honestly. If the runtime does not expose setrlimit we SKIP
  // (not applied), not "applied". Phase 1 test #13 asserts the `rlimit_core`
  // key is present — still true. Operators need to trust this banner.
  if (result.applied) {
    logger.info({ rlimit_core: result.rlimit_core, applied: true }, "rlimit.core applied");
  } else {
    const warn = logger.warn ? logger.warn.bind(logger) : logger.info.bind(logger);
    warn(
      {
        code: "RLIMIT_SKIPPED",
        rlimit_core: result.rlimit_core,
        applied: false,
        reason: "process.setrlimit is not exposed in Bun/Node",
        docker_ulimit_required: true,
        ...(result.error ? { error: result.error } : {}),
      },
      "rlimit.core skipped — Dockerfile ulimit -c 0 required",
    );
  }

  if (result.rlimit_core > 0 && logger.error) {
    logger.error(
      { rlimit_core: result.rlimit_core },
      "rlimit.core > 0 — crash dumps enabled; Dockerfile ulimit -c 0 required",
    );
  }

  return result;
}
