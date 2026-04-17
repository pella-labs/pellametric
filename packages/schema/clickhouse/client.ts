import { createClient } from "@clickhouse/client";

export const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
export const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";

/** Client bound to the application database. */
export function ch() {
  return createClient({ url: CH_URL, database: CH_DATABASE });
}

/** Client NOT bound to a database; for CREATE DATABASE / DROP DATABASE. */
export function chRoot() {
  return createClient({ url: CH_URL });
}
