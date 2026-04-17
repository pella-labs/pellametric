import { Database } from "bun:sqlite";
import { egressSqlite } from "@bematist/config";
import { Journal } from "../src/egress/journal";
import { migrate } from "../src/egress/migrations";
import { flushOnce } from "../src/egress/worker";

const db = new Database(egressSqlite());
migrate(db);
const j = new Journal(db);
const r = await flushOnce(j, {
  endpoint: process.env.DEVMETRICS_INGEST_HOST ?? "http://localhost:8000",
  token: process.env.DEVMETRICS_TOKEN ?? "dm_solo_dev",
  fetch,
  dryRun: false,
});
console.log(JSON.stringify(r, null, 2));
db.close();
