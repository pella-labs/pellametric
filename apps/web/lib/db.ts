import "server-only";
import type { ClickHouseClient, Ctx, PgClient, RedisClient } from "@bematist/api";

/**
 * Lazy singletons for Postgres, ClickHouse, and Redis. Real connections are
 * not established in dev mode — fixture-backed queries in `@bematist/api`
 * never touch these clients. Once Jorge's MVs and Walid's ingest auth land,
 * swap the bodies for real `@clickhouse/client`, `postgres`, and `ioredis`
 * construction.
 *
 * Singletons are a concession to Next.js's per-request model in dev, where
 * HMR otherwise re-imports modules and reconnects every time. Guard with a
 * global cache keyed on a symbol so the pattern is obvious.
 */

type Globals = typeof globalThis & {
  __bematist_db?: { pg: PgClient; ch: ClickHouseClient; redis: RedisClient };
};

function notWired(name: string): never {
  throw new Error(
    `${name} client is not yet wired — queries in M1 are fixture-backed and should not hit real DBs`,
  );
}

function makeStubClients(): Ctx["db"] {
  const pg: PgClient = {
    async query() {
      notWired("Postgres");
    },
  };
  const ch: ClickHouseClient = {
    async query() {
      notWired("ClickHouse");
    },
  };
  const redis: RedisClient = {
    async get() {
      notWired("Redis");
    },
    async set() {
      notWired("Redis");
    },
    async setNx() {
      notWired("Redis");
    },
  };
  return { pg, ch, redis };
}

export function getDbClients(): Ctx["db"] {
  const g = globalThis as Globals;
  if (!g.__bematist_db) {
    g.__bematist_db = makeStubClients();
  }
  return g.__bematist_db;
}
