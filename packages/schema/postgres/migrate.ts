import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";

// max=1 required by the migrator — it opens one connection for the advisory lock.
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const migrationsFolder = join(import.meta.dir, "migrations");
const customFolder = join(import.meta.dir, "custom");
const rollbackFolder = join(import.meta.dir, "rollback");

// ---- Rollback path ------------------------------------------------------
// Invoke: `bun run db:migrate:pg -- --rollback <migration-name>`
// Applies the matching .down.sql from packages/schema/postgres/rollback/.
// The rollback file name convention: <migration-name>.down.sql
// (e.g. 0006_github_integration_g1.down.sql reverses
//        custom/0006_github_integration_g1.sql).
const rollbackIdx = process.argv.indexOf("--rollback");
if (rollbackIdx !== -1) {
  const target = process.argv[rollbackIdx + 1];
  if (!target) {
    console.error(
      "[pg-migrate] --rollback requires a migration name (e.g. 0006_github_integration_g1)",
    );
    process.exit(1);
  }
  const rollbackFile = join(rollbackFolder, `${target}.down.sql`);
  if (!existsSync(rollbackFile)) {
    console.error(`[pg-migrate] rollback file not found: ${rollbackFile}`);
    process.exit(1);
  }
  const sql = readFileSync(rollbackFile, "utf8");
  await client.unsafe(sql);
  await client.end();
  process.exit(0);
}

// ---- Forward path -------------------------------------------------------
await migrate(db, { migrationsFolder });

// Custom idempotent SQL (triggers, RLS policies, functions) that drizzle
// doesn't know how to author. Each file must use CREATE OR REPLACE / DROP IF
// EXISTS so re-runs are safe. Applied in sorted-filename order.
if (existsSync(customFolder)) {
  const files = readdirSync(customFolder)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(customFolder, f), "utf8");
    await client.unsafe(sql);
  }
}

await client.end();
