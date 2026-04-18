// Append-only egress journal — Bill of Rights #1.
//
// "Every byte that leaves this machine is logged locally first."
//
// This is distinct from the SQLite `Journal` (which tracks per-event enqueued
// / pending / submitted state). This log is JSONL-append-only and exists so
// `bematist audit --tail` can honestly show the operator EVERY batch that was
// sent (or would be sent, in dry-run) — one line per batch, written BEFORE the
// POST, never rewritten.
//
// Format, one JSON object per line, newline-delimited:
//   {
//     "ts": "2026-04-18T14:00:00.000Z",
//     "endpoint": "https://ingest.example/v1/events",
//     "eventCount": 10,
//     "clientEventIds": ["...", "..."],
//     "dryRun": false,
//     "bodyBytes": 4321
//   }
//
// The payload itself is NOT logged here (it contains session text under Tier C
// mode) — the Journal's SQLite table holds the full body_json if the operator
// needs to inspect it. This log answers "what was sent" and "when", not "what
// exactly was the content".

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface EgressLogEntry {
  /** ISO-8601 UTC timestamp of log write (before POST). */
  ts: string;
  /** Ingest URL the batch went to. */
  endpoint: string;
  /** Number of events in the batch. */
  eventCount: number;
  /** UUIDs for the events in this batch — cheap to audit against the Journal. */
  clientEventIds: string[];
  /** True if BEMATIST_DRY_RUN was set — no POST actually issued. */
  dryRun: boolean;
  /** Body size in bytes (for ops telemetry / bandwidth accounting). */
  bodyBytes: number;
  /** Optional — reason this batch didn't ship (skipped / rate-limited / refused). */
  note?: string;
}

export class EgressLog {
  private readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "egress.jsonl");
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** File path for debug / doctor output. */
  get filePath(): string {
    return this.path;
  }

  /** Write one entry. Appends synchronously so a crash mid-send still has the audit trail. */
  write(entry: EgressLogEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /**
   * Return the last `n` entries, newest-first. For `audit --tail`.
   * Reads the whole file — small by design (one line per batch, ~200b each;
   * rotation can come later if someone actually ships 10M batches).
   */
  tail(n: number): EgressLogEntry[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const out: EgressLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as EgressLogEntry);
      } catch {
        // malformed line — skip, stay honest in audit
      }
    }
    return out;
  }

  /** Entry count (for `status` reports). */
  count(): number {
    if (!existsSync(this.path)) return 0;
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim()).length;
  }
}
