import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { egressSqlite } from "@bematist/config";
import type { Event } from "@bematist/schema";
import { buildRegistry } from "../adapters";
import { loadConfig } from "../config";
import { SqliteCursorStore } from "../cursor/store";
import { EgressLog } from "../egress/egressLog";
import { flushBatch } from "../egress/flush";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { log } from "../logger";
import { runOnce } from "../orchestrator";

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

/**
 * Dry-run: poll all adapters once, enqueue events, write to the egress log,
 * print a preview, and exit. No network egress. Satisfies CLAUDE.md Bill of
 * Rights #1 ("default on first run") — operators see exactly what would be
 * sent before anything leaves the machine.
 */
export async function runDryRun(_args: string[]): Promise<void> {
  const config = loadConfig({ dryRun: true });
  const dbPath = egressSqlite();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath);
  migrate(db);
  const journal = new Journal(db);
  const egress = new EgressLog(config.dataDir);

  const registry = buildRegistry({
    tenantId: config.tenantId,
    engineerId: config.engineerId,
    deviceId: config.deviceId,
  });

  const mkCtx = (a: (typeof registry)[number]) => ({
    dataDir: config.dataDir,
    policy: {
      enabled: true,
      tier: config.tier,
      pollIntervalMs: config.pollIntervalMs,
    },
    log: mkAdapterLogger(),
    tier: config.tier,
    cursor: new SqliteCursorStore(db, a.id),
  });

  for (const a of registry) {
    try {
      await a.init(mkCtx(a));
    } catch (e) {
      log.warn({ adapter: a.id, err: String(e) }, "adapter init failed");
    }
  }

  // Streaming: adapters emit per-event directly into the journal; we also
  // collect the events locally so we can surface a preview + count to
  // stdout before exiting.
  const events: Event[] = [];
  await runOnce(
    registry,
    mkCtx,
    {
      concurrency: config.adapterConcurrency,
      perPollTimeoutMs: config.perPollTimeoutMs,
    },
    (event) => {
      events.push(event);
      journal.enqueue(event);
    },
  );

  const flush = await flushBatch(journal, egress, {
    endpoint: config.endpoint,
    token: config.token,
    fetchImpl: fetch,
    dryRun: true,
    batchSize: config.batchSize,
    ingestOnlyTo: config.ingestOnlyTo,
  });

  // Preview first 10 events.
  const preview = events.slice(0, 10).map((e) => ({
    client_event_id: e.client_event_id,
    source: e.source,
    session_id: e.session_id,
    event_kind: e.dev_metrics?.event_kind,
    ts: e.ts,
  }));

  console.log(
    JSON.stringify(
      {
        dryRun: true,
        endpoint: `${config.endpoint}/v1/events`,
        adapters: registry.map((a) => a.id),
        enqueued: events.length,
        wouldSubmit: events.length,
        preview,
        flush,
      },
      null,
      2,
    ),
  );
  log.info({ events: events.length }, "dry-run complete");
  db.close();
}
