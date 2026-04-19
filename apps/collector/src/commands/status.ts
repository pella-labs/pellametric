import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { egressSqlite } from "@bematist/config";
import { buildRegistry } from "../adapters";
import { loadConfig } from "../config";
import { daemonStatus } from "../daemon";
import { EgressLog } from "../egress/egressLog";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { log } from "../logger";

function mkAdapterLogger() {
  const noop = () => {};
  const l = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child() {
      return l;
    },
  };
  return l;
}

export async function runStatus(): Promise<void> {
  const config = loadConfig();
  const dbPath = egressSqlite();
  const _dbExists = existsSync(dbPath);
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath);
  migrate(db);
  const j = new Journal(db);
  const _pendingCount = j.pendingCount();

  const egress = new EgressLog(config.dataDir);
  const _lastBatch = egress.tail(1)[0] ?? null;

  const registry = buildRegistry({
    tenantId: config.tenantId,
    engineerId: config.engineerId,
    deviceId: config.deviceId,
  });

  const health = await Promise.all(
    registry.map(async (a) => ({
      id: a.id,
      label: a.label,
      version: a.version,
      health: await a.health({
        dataDir: config.dataDir,
        policy: {
          enabled: true,
          tier: config.tier,
          pollIntervalMs: config.pollIntervalMs,
        },
        log: mkAdapterLogger(),
        tier: config.tier,
        cursor: { get: async () => null, set: async () => {} },
      }),
    })),
  );

  const _active = health.filter((h) => h.health.status === "ok").map((h) => h.id);
  const _daemon = daemonStatus();
  db.close();
  log.debug("status printed");
}
