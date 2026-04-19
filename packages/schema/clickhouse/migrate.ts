import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CH_DATABASE, ch, chRoot } from "./client";

const rootClient = chRoot();
await rootClient.command({ query: `CREATE DATABASE IF NOT EXISTS ${CH_DATABASE}` });
await rootClient.close();

const client = ch();

// Substitutions for CH migration DDL. Dictionary sources need a PG hostname
// that resolves from inside the CH container — `bematist-postgres` in docker
// compose, `localhost` in GitHub Actions service-containers, etc.
const substitutions: Record<string, string> = {
  PG_DICT_HOST: process.env.CH_PG_DICT_HOST ?? "bematist-postgres",
  PG_DICT_PORT: process.env.CH_PG_DICT_PORT ?? "5432",
  PG_DICT_DB: process.env.CH_PG_DICT_DB ?? "bematist",
  PG_DICT_USER: process.env.CH_PG_DICT_USER ?? "postgres",
  PG_DICT_PASSWORD: process.env.CH_PG_DICT_PASSWORD ?? "postgres",
};

function substitute(sql: string): string {
  return sql.replace(/\$\{(\w+)\}/g, (_, key) => substitutions[key] ?? `\${${key}}`);
}

const migrationsDir = join(import.meta.dir, "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const sql = substitute(readFileSync(join(migrationsDir, file), "utf8"));
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
}

await client.close();
