import { Database } from "bun:sqlite";
import { egressSqlite } from "@bematist/config";
import { loadConfig } from "../src/config";
import { EgressLog } from "../src/egress/egressLog";
import { flushBatch } from "../src/egress/flush";
import { Journal } from "../src/egress/journal";
import { migrate } from "../src/egress/migrations";

const config = loadConfig();
const db = new Database(egressSqlite());
migrate(db);
const j = new Journal(db);
const egress = new EgressLog(config.dataDir);
const _r = await flushBatch(j, egress, {
  endpoint: config.endpoint,
  token: config.token,
  fetchImpl: fetch,
  dryRun: config.dryRun,
  batchSize: config.batchSize,
  ingestOnlyTo: config.ingestOnlyTo,
});
db.close();
