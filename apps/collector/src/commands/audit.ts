import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { egressSqlite } from "@bematist/config";
import { loadConfig } from "../config";
import { EgressLog } from "../egress/egressLog";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";

/**
 * `bematist audit --tail` — streams the append-only egress journal.
 * Satisfies CLAUDE.md Bill of Rights #1: every operator must be able to see
 * every byte that left this machine in the last session.
 *
 * Three sources are surfaced:
 *   - the per-batch egress.jsonl (high-level: "batch of N events went to
 *     https://..."); one line per batch.
 *   - a dead-letter section (up to 10 most recent dead-letter rows) so the
 *     operator can see rows that were permanently rejected rather than sent.
 *   - optionally --verbose: SQLite journal rows (per-event body + submission
 *     status) for deeper forensic tailing.
 */
export async function runAudit(args: string[]): Promise<void> {
  let tail = false;
  let verbose = false;
  let n = 100;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tail") tail = true;
    if (args[i] === "--verbose" || args[i] === "-v") verbose = true;
    if (args[i] === "-n" || args[i] === "--limit") {
      n = Number.parseInt(args[i + 1] ?? "100", 10);
    }
  }
  if (!tail) {
    console.error("usage: bematist audit --tail [-n N] [--verbose]");
    process.exit(2);
  }

  const config = loadConfig();
  const egress = new EgressLog(config.dataDir);
  const entries = egress.tail(n);
  for (const e of entries) console.log(JSON.stringify(e));

  // Dead-letter summary — always shown so poison-pill accumulation is visible
  // even when the operator didn't pass --verbose. We open the SQLite journal
  // only if it exists (the collector creates it lazily on first enqueue).
  const dbPath = egressSqlite();
  if (existsSync(dbPath)) {
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    const db = new Database(dbPath);
    try {
      migrate(db);
      const j = new Journal(db);
      const deadCount = j.deadLetterCount();
      if (deadCount > 0) {
        console.log(
          JSON.stringify({
            _section: "dead_letter",
            count: deadCount,
          }),
        );
        const deadRows = j.tailDeadLetter(Math.min(10, deadCount));
        for (const r of deadRows) {
          console.log(
            JSON.stringify({
              _section: "dead_letter",
              client_event_id: r.client_event_id,
              enqueued_at: r.enqueued_at,
              retry_count: r.retry_count,
              last_error: r.last_error,
            }),
          );
        }
      }

      if (verbose) {
        // Forensic tail of per-event SQLite rows.
        const rows = j.tail(n);
        for (const r of rows) {
          console.log(
            JSON.stringify({
              _verbose: true,
              client_event_id: r.client_event_id,
              enqueued_at: r.enqueued_at,
              submitted_at: r.submitted_at,
              state: r.state,
              next_attempt_at: r.next_attempt_at,
              retry_count: r.retry_count,
              last_error: r.last_error,
              event: JSON.parse(r.body_json),
            }),
          );
        }
      }
    } finally {
      db.close();
    }
  }
}
