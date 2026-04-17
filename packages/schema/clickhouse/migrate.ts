import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CH_DATABASE, ch, chRoot } from "./client";

const rootClient = chRoot();
await rootClient.command({ query: `CREATE DATABASE IF NOT EXISTS ${CH_DATABASE}` });
await rootClient.close();

const client = ch();

const migrationsDir = join(import.meta.dir, "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  // ClickHouse @clickhouse/client executes one statement per command call.
  // Strip leading --line comments so a leading file header doesn't mask the statement.
  const statements = sql
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await client.command({ query: stmt });
  }
  console.log(`[ch-migrate] applied ${file}`);
}

await client.close();
console.log(`[ch-migrate] done — ${files.length} file(s) applied to ${CH_DATABASE}`);
