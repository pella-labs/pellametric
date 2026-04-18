import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@bematist/sdk";

/**
 * Egress-journal-style `skipped` counter.
 *
 * Per M2 brief A3: pre-v1.2 sharded JSON sessions are skipped with one
 * `[warn] opencode: pre-v1.2 session skipped` log line per session AND a
 * one-line entry in the journal's skipped counter.
 *
 * Implementation: the skipped counter is held per-adapter-instance (not the
 * shared egress SQLite — contract 03 forbids adapters from mutating shared
 * collector state). The count is surfaced through `health()` caveats and via
 * `getCount()` for tests. `bematist status` pulls it from the adapter's
 * health object.
 */
export class SkippedCounter {
  private count = 0;
  private readonly seen = new Set<string>();

  /**
   * Record that we skipped `sessionId` at `reason`. Idempotent per sessionId:
   * a second call with the same id logs + increments once (first time only).
   */
  record(sessionId: string, reason: string, log: Logger): boolean {
    if (this.seen.has(sessionId)) return false;
    this.seen.add(sessionId);
    this.count += 1;
    log.warn("opencode: pre-v1.2 session skipped", { sessionId, reason });
    return true;
  }

  getCount(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
    this.seen.clear();
  }
}

/**
 * Enumerate pre-v1.2 sessions by listing the legacy storage/session/ dir.
 * Each direct subdirectory is one session; the dir name is the session id.
 */
export function listLegacySessionIds(legacyDir: string): string[] {
  try {
    return readdirSync(legacyDir)
      .filter((name) => {
        try {
          return statSync(join(legacyDir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}
