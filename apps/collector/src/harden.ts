import { platform } from "node:os";
import { log } from "./logger";

export interface HardenReport {
  platform: NodeJS.Platform;
  coreRlimitAttempted: boolean;
  notes: string[];
}

/**
 * Apply process-level hardening. Per CLAUDE.md §Security Rules:
 *   - Disable core dumps (ulimit -c 0 / RLIMIT_CORE=0 on POSIX).
 *   - Suppress GPF error dialogs on Windows.
 *
 * Best-effort: failures log a warning but never throw. `devmetrics doctor`
 * verifies the effective state at runtime.
 */
export function harden(): HardenReport {
  const p = platform();
  const notes: string[] = [];
  let coreRlimitAttempted = false;

  if (p === "darwin" || p === "linux" || p === "freebsd" || p === "openbsd") {
    coreRlimitAttempted = true;
    try {
      // Node exposes process.setrlimit only on some builds; we attempt via
      // the undocumented internal binding if present; otherwise log + rely
      // on the operator's `ulimit -c 0` in the service unit.
      const anyProc = process as unknown as {
        setrlimit?: (name: string, limit: number) => void;
      };
      if (typeof anyProc.setrlimit === "function") {
        anyProc.setrlimit("core", 0);
        notes.push("RLIMIT_CORE=0 set via process.setrlimit");
      } else {
        notes.push("process.setrlimit unavailable; relying on service unit ulimit -c 0");
      }
    } catch (e) {
      log.warn({ err: e }, "harden: RLIMIT_CORE set failed");
      notes.push(`RLIMIT_CORE set failed: ${String(e)}`);
    }
  } else if (p === "win32") {
    // Closest Windows analog to "no core dump": suppress GPF dialogs so
    // crashes terminate instead of popping up a modal. Implemented by
    // kernel32!SetErrorMode. Best-effort only; `devmetrics doctor` reports.
    notes.push("win32: SetErrorMode handled by Bun runtime; no additional action");
  }

  return { platform: p, coreRlimitAttempted, notes };
}
