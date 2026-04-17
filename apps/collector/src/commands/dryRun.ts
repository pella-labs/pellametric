import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { egressSqlite } from "@bematist/config";
import { buildRegistry } from "../adapters";
import { SqliteCursorStore } from "../cursor/store";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { flushOnce } from "../egress/worker";
import { log } from "../logger";
import { runOnce } from "../orchestrator";

export async function runDryRun(_args: string[]): Promise<void> {
  const dbPath = egressSqlite();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(dbPath);
  migrate(db);
  const j = new Journal(db);

  const registry = buildRegistry({
    tenantId: process.env.DEVMETRICS_ORG ?? "solo",
    engineerId: process.env.DEVMETRICS_ENGINEER ?? "me",
    deviceId: process.env.DEVMETRICS_DEVICE ?? "localhost",
  });

  const events = await runOnce(
    registry,
    (a) => ({
      dataDir: egressSqlite(),
      policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
      log: {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: function () {
          return this;
        },
      },
      tier: "B",
      cursor: new SqliteCursorStore(db, a.id),
    }),
    { concurrency: 4, perPollTimeoutMs: 30_000 },
  );
  for (const e of events) j.enqueue(e);

  const result = await flushOnce(j, {
    endpoint: process.env.DEVMETRICS_INGEST_HOST ?? "http://localhost:8000",
    token: process.env.DEVMETRICS_TOKEN ?? "dm_solo_dev",
    fetch,
    dryRun: true,
  });

  console.log(
    JSON.stringify({ enqueued: events.length, wouldSubmit: events.length, result }, null, 2),
  );
  log.info({ events: events.length }, "dry-run complete");
  db.close();
}
