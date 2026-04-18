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

await migrate(db, { migrationsFolder });
console.log(`[pg-migrate] drizzle — applied migrations from ${migrationsFolder}`);

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
    console.log(`[pg-migrate] custom — applied ${f}`);
  }
}

await client.end();
