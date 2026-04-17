import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { egressSqlite } from "@bematist/config";
import { buildRegistry } from "../adapters";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { log } from "../logger";

export async function runStatus(): Promise<void> {
  const dbPath = egressSqlite();
  const dbExists = existsSync(dbPath);
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(dbPath);
  migrate(db);
  const j = new Journal(db);
  const pendingCount = j.pendingCount();

  const registry = buildRegistry({
    tenantId: process.env.DEVMETRICS_ORG ?? "solo",
    engineerId: process.env.DEVMETRICS_ENGINEER ?? "me",
    deviceId: process.env.DEVMETRICS_DEVICE ?? "localhost",
  });

  const health = await Promise.all(
    registry.map(async (a) => ({
      id: a.id,
      label: a.label,
      health: await a.health({
        dataDir: dbPath,
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
        cursor: { get: async () => null, set: async () => {} },
      }),
    })),
  );

  console.log(
    JSON.stringify(
      {
        egressDb: { path: dbPath, exists: dbExists, pending: pendingCount },
        adapters: health,
      },
      null,
      2,
    ),
  );
  db.close();
  log.debug("status printed");
}
