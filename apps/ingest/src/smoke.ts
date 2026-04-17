// Sprint-1 follow-up A smoke test — LIVE end-to-end POC.
//
// Requires:
//   docker compose -f docker-compose.dev.yml up   (redis + clickhouse)
//   Real-bearer flow once Jorge's ingest_keys migration is ratified. For now
//   we boot an in-process ingest server with an in-memory IngestKeyStore
//   seeded with a dev key (DEV_AUTH_STUB-style), so we can exercise the real
//   Bun.redis dedup, node-redis Lua rate limiter, Redis Streams WAL and
//   @clickhouse/client insert paths without PG.
//
// Usage:
//   bun run src/smoke.ts            # boots server on :8000, 10 POSTs, polls CH
//
// Exit 0 on success (count reached 10 within ~3s), 1 otherwise. NOT a
// bun test — runnable script only.

import { createHash } from "node:crypto";
import { createClient as createCHClient } from "@clickhouse/client";
import { createNodeRedisLuaClient, createSharedNodeRedisClient } from "./auth/nodeRedisLua";
import { createLuaRateLimiter } from "./auth/rateLimit";
import { type IngestKeyRow, type IngestKeyStore, LRUCache } from "./auth/verifyIngestKey";

// Match verifyIngestKey.ts step (4): hex-encoded SHA-256 of the secret.
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

import { createRealClickHouseWriter } from "./clickhouse/realWriter";
import { createBunRedisDedupStore } from "./dedup/bunRedisDedupStore";
import { setDeps } from "./deps";
import { startServer } from "./server";
import { createRedisStreamsWalAppender } from "./wal/append";
import { createWalConsumer } from "./wal/consumer";
import { createRedisStreamsWal } from "./wal/redisStreamsWal";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const PORT = Number(process.env.INGEST_PORT ?? 8000);

const DEV_ORG = "smokeorg";
const DEV_KEY_ID = "smokekey";
const DEV_SECRET = "smokesecret";
const DEV_ENG = "smokeeng";

function makeDevStore(): IngestKeyStore {
  const row: IngestKeyRow = {
    id: "row-1",
    org_id: DEV_ORG,
    engineer_id: DEV_ENG,
    key_sha256: hashSecret(DEV_SECRET),
    tier_default: "B",
    revoked_at: null,
  };
  return {
    async get(orgId, keyId) {
      if (orgId === DEV_ORG && keyId === DEV_KEY_ID) return row;
      return null;
    },
  };
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: "info",
      msg: "smoke: starting",
      redis: REDIS_URL,
      ch: CH_URL,
      port: PORT,
    }),
  );

  // 1. Wire the real runtime adapters.
  const sharedRedis = await createSharedNodeRedisClient({ url: REDIS_URL });
  const lua = await createNodeRedisLuaClient({ client: sharedRedis });
  const rateLimiter = createLuaRateLimiter(lua);
  const wal = createRedisStreamsWalAppender(createRedisStreamsWal(sharedRedis));
  const dedupStore = createBunRedisDedupStore({ url: REDIS_URL });
  const clickhouseWriter = createRealClickHouseWriter({ url: CH_URL });

  setDeps({
    store: makeDevStore(),
    cache: new LRUCache({ max: 100, ttlMs: 60_000 }),
    dedupStore,
    rateLimiter,
    wal,
    clickhouseWriter,
  });

  // 2. Start WAL consumer so WAL rows flow to ClickHouse.
  const consumer = createWalConsumer({
    redis: createRedisStreamsWal(sharedRedis),
    ch: clickhouseWriter,
  });
  await consumer.start();

  // 3. Start ingest server. Port is read from INGEST_LISTEN_ADDR; we set it
  // before startServer picks it up.
  process.env.INGEST_LISTEN_ADDR = `:${PORT}`;
  const srv = startServer();

  const bearer = `Bearer bm_${DEV_ORG}_${DEV_KEY_ID}_${DEV_SECRET}`;
  const base = `http://localhost:${PORT}`;

  // 4. Fire 10 valid POSTs.
  const sessionId = `smoke-${Date.now()}`;
  const results: number[] = [];
  for (let i = 0; i < 10; i++) {
    const clientEventId = createHash("sha256")
      .update(`${sessionId}:${i}`)
      .digest("hex")
      .slice(0, 32);
    const body = {
      client_event_id: clientEventId,
      schema_version: 1,
      ts: Math.floor(Date.now() / 1000),
      device_id: "smoke-dev",
      source: "claude-code",
      fidelity: "full",
      tier: "B",
      session_id: sessionId,
      event_seq: i,
      dev_metrics: { event_kind: "session_start" },
    };
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: bearer },
      body: JSON.stringify(body),
    });
    results.push(res.status);
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "smoke: posts done", statuses: results }));

  // 5. Poll ClickHouse up to 3 times.
  const verify = createCHClient({ url: CH_URL });
  let count = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    const rs = await verify.query({
      query: "SELECT count() AS c FROM events WHERE session_id = {s:String}",
      query_params: { s: sessionId },
      format: "JSON",
    });
    const json = (await rs.json()) as { data: Array<{ c: string | number }> };
    count = Number(json.data[0]?.c ?? 0);
    if (count >= 10) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "smoke: ch count", count, expected: 10 }));

  // 6. Teardown
  await consumer.stop();
  try {
    srv.stop(true);
  } catch {}
  try {
    await lua.quit();
  } catch {}
  try {
    await sharedRedis.quit();
  } catch {}
  try {
    await verify.close();
  } catch {}

  if (count >= 10) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: "info", msg: "smoke: OK" }));
    process.exit(0);
  } else {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: "error", msg: "smoke: FAILED", count }));
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "error",
      msg: "smoke: threw",
      err: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
