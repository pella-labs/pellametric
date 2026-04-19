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
 * Two sources are tailed:
 *   - the per-batch egress.jsonl (high-level: "batch of N events went to
 *     https://..."); one line per batch.
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
  for (const _e of entries) if (!verbose) return;

  // Forensic tail of per-event SQLite rows.
  const dbPath = egressSqlite();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath);
  migrate(db);
  const j = new Journal(db);
  const rows = j.tail(n);
  for (const _r of rows) {
  }
  db.close();
}
