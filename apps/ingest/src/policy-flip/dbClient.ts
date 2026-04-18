// Lazy Postgres client for the policy-flip Drizzle-backed implementations.
// Mirrors apps/worker/src/db.ts: one postgres-js pool, drizzled with the
// `@bematist/schema/postgres` tables. Kept local to policy-flip/ so the boot
// path in apps/ingest/src/index.ts can opt in without pulling postgres-js into
// other ingest code paths that don't need it.

import * as schema from "@bematist/schema/postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

export interface PolicyFlipDbHandle {
  db: PostgresJsDatabase<typeof schema>;
  pg: Sql;
  close(): Promise<void>;
}

export function createPolicyFlipDbHandle(url?: string): PolicyFlipDbHandle {
  const connectionUrl =
    url ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
  const pg = postgres(connectionUrl, { max: 3 });
  const db = drizzle(pg, { schema });
  return {
    db,
    pg,
    async close() {
      await pg.end({ timeout: 1 });
    },
  };
}
