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

const POLL_INTERVAL_MS = 5000;
const FLUSH_INTERVAL_MS = 1000;

export async function runServe(): Promise<void> {
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

  for (const a of registry) {
    await a.init({
      dataDir: egressSqlite(),
      policy: { enabled: true, tier: "B", pollIntervalMs: POLL_INTERVAL_MS },
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
    });
  }

  let running = true;
  const shutdown = () => {
    log.info("devmetrics serve: graceful shutdown");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const endpoint = process.env.DEVMETRICS_INGEST_HOST ?? "http://localhost:8000";
  const token = process.env.DEVMETRICS_TOKEN ?? "dm_solo_dev";

  log.info({ endpoint, adapters: registry.map((a) => a.id) }, "devmetrics serve: starting");

  while (running) {
    try {
      const events = await runOnce(
        registry,
        (a) => ({
          dataDir: egressSqlite(),
          policy: { enabled: true, tier: "B", pollIntervalMs: POLL_INTERVAL_MS },
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

      const flush = await flushOnce(j, { endpoint, token, fetch, dryRun: false });
      if (flush.fatal) {
        log.fatal("egress fatal — halting");
        running = false;
        break;
      }
      const sleep = flush.retryAfterSeconds ?? 0;
      await new Promise((r) => setTimeout(r, Math.max(FLUSH_INTERVAL_MS, sleep * 1000)));
    } catch (e) {
      log.warn({ err: String(e) }, "serve loop error");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  db.close();
}
