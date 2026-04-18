import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { egressSqlite } from "@bematist/config";
import { loadConfig } from "../config";
import { EgressLog } from "../egress/egressLog";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { log } from "../logger";
import { startLoop } from "../loop";

export async function runServe(): Promise<void> {
  const config = loadConfig();
  if (!config.token && !config.dryRun) {
    console.error("bematist: BEMATIST_TOKEN is required (or set BEMATIST_DRY_RUN=1 to log-only)");
    process.exit(2);
  }

  const dbPath = egressSqlite();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath);
  migrate(db);
  const journal = new Journal(db);
  const egressLog = new EgressLog(config.dataDir);

  const handle = startLoop({ db, journal, egressLog, config });

  log.info(
    {
      endpoint: config.endpoint,
      adapters: handle.adapters.map((a) => a.id),
      dryRun: config.dryRun,
      dataDir: config.dataDir,
    },
    "bematist serve: starting",
  );

  const stop = async () => {
    log.info("bematist serve: shutdown signal received");
    await handle.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await handle.done;
  db.close();
}
