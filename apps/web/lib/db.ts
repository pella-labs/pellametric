import "server-only";
import type { ClickHouseClient, Ctx, PgClient, RedisClient } from "@bematist/api";
import {
  type ClickHouseClient as CHRawClient,
  createClient as createCHClient,
} from "@clickhouse/client";
import postgres from "postgres";
import { createClient as createRedisClient, type RedisClientType } from "redis";

/**
 * Lazy singletons for Postgres, ClickHouse, and Redis. Real network connections
 * are constructed on first access; subsequent calls return the same instances.
 *
 * Singletons are a concession to Next.js's per-request model in dev, where HMR
 * otherwise re-imports modules and reconnects every time. Guard with a global
 * cache keyed on a symbol so the pattern is obvious and survives `next dev`
 * Fast Refresh / module-replacement cycles.
 *
 * Each underlying lib is wrapped to satisfy the small `PgClient` /
 * `ClickHouseClient` / `RedisClient` interfaces declared in `@bematist/api`.
 * Queries in `packages/api/src/queries/*` are typed against those interfaces
 * and stay test-friendly (mockable without a live DB).
 */

type Globals = typeof globalThis & {
  __bematist_db?: {
    pg: PgClient;
    ch: ClickHouseClient;
    redis: RedisClient;
    _pgRaw: ReturnType<typeof postgres>;
    _chRaw: CHRawClient;
    _redisRaw: RedisClientType;
  };
};

const PG_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function makePgClient(): { client: PgClient; raw: ReturnType<typeof postgres> } {
  // `max: 5` mirrors apps/worker/src/db.ts — Next.js spawns one Node worker
  // per route group in prod; we don't need a fat pool per process.
  const sql = postgres(PG_URL, { max: 5 });
  const client: PgClient = {
    async query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
      // postgres-js exposes `unsafe(query, params)` for plain numbered params
      // ($1, $2, ...). The `Ctx["db"].pg.query` shape is positional-params, so
      // this is a 1:1 mapping. Caller is responsible for parameterizing — never
      // string-interpolate untrusted input here.
      // biome-ignore lint/suspicious/noExplicitAny: postgres-js generic widens to RowList<Row[]>
      const rows = (await sql.unsafe(text, (params ?? []) as any[])) as unknown as T[];
      return rows;
    },
  };
  return { client, raw: sql };
}

function makeChClient(): { client: ClickHouseClient; raw: CHRawClient } {
  const raw = createCHClient({ url: CH_URL, database: CH_DATABASE });
  const client: ClickHouseClient = {
    async query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
      // `@clickhouse/client` HTTP transport — single-writer pattern (see
      // CLAUDE.md Architecture Rule #7). Read path uses the same client; if
      // F15 / INT0 soak fails for writes we'd swap the writer to a Go side-car
      // but the read API stays HTTP.
      const result = await raw.query({
        query: sql,
        query_params: params ?? {},
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as T[];
      return rows;
    },
  };
  return { client, raw };
}

function makeRedisClient(): { client: RedisClient; raw: RedisClientType } {
  const raw = createRedisClient({ url: REDIS_URL }) as RedisClientType;
  // node-redis v4 emits 'error' on background reconnect failures; we log to
  // stderr but don't crash so the loop keeps trying (matches the pattern in
  // apps/ingest/src/auth/nodeRedisLua.ts).
  raw.on("error", (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: "error", module: "web/redis", msg }));
  });
  // Connect lazily on first command — `connect()` is idempotent and resolves
  // immediately if already open. Wrapping here avoids a top-level `await` and
  // the surprise of a second-class "you forgot to connect" error in routes.
  let connecting: Promise<void> | null = null;
  async function ensureConnected(): Promise<void> {
    if (raw.isOpen) return;
    if (!connecting) connecting = raw.connect().then(() => undefined);
    await connecting;
  }

  const client: RedisClient = {
    async get(key: string): Promise<string | null> {
      await ensureConnected();
      return (await raw.get(key)) ?? null;
    },
    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      await ensureConnected();
      if (ttlSeconds && ttlSeconds > 0) {
        await raw.set(key, value, { EX: ttlSeconds });
      } else {
        await raw.set(key, value);
      }
    },
    async setNx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
      await ensureConnected();
      // SET key value NX [EX ttl] — atomic. Returns "OK" on success, null on
      // collision. This is the D14 idempotency primitive shape (7-day TTL is
      // applied by callers in `packages/api`); we just expose the boolean.
      const opts: { NX: true; EX?: number } = { NX: true };
      if (ttlSeconds && ttlSeconds > 0) opts.EX = ttlSeconds;
      const reply = await raw.set(key, value, opts);
      return reply === "OK";
    },
  };
  return { client, raw };
}

export function getDbClients(): Ctx["db"] {
  const g = globalThis as Globals;
  if (!g.__bematist_db) {
    const pg = makePgClient();
    const ch = makeChClient();
    const redis = makeRedisClient();
    g.__bematist_db = {
      pg: pg.client,
      ch: ch.client,
      redis: redis.client,
      _pgRaw: pg.raw,
      _chRaw: ch.raw,
      _redisRaw: redis.raw,
    };
  }
  return { pg: g.__bematist_db.pg, ch: g.__bematist_db.ch, redis: g.__bematist_db.redis };
}
