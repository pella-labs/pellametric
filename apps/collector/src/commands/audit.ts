import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { egressSqlite } from "@bematist/config";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";

export async function runAudit(args: string[]): Promise<void> {
  let tail = false;
  let n = 100;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tail") tail = true;
    if (args[i] === "-n" || args[i] === "--limit") {
      n = Number.parseInt(args[i + 1] ?? "100", 10);
    }
  }
  if (!tail) {
    console.error("usage: devmetrics audit --tail [-n N]");
    process.exit(2);
  }
  const dbPath = egressSqlite();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(dbPath);
  migrate(db);
  const j = new Journal(db);
  const rows = j.tail(n);
  for (const r of rows) {
    console.log(
      JSON.stringify({
        client_event_id: r.client_event_id,
        enqueued_at: r.enqueued_at,
        submitted_at: r.submitted_at,
        retry_count: r.retry_count,
        last_error: r.last_error,
        event: JSON.parse(r.body_json),
      }),
    );
  }
  db.close();
}
