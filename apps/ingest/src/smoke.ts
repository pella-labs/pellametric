// Sprint-1 follow-up A smoke test — LIVE end-to-end POC.
//
// Requires:
//   docker compose -f docker-compose.dev.yml up   (redis + clickhouse)
//   bun run db:migrate:ch                          (creates events + 5 MVs)
//
// Boots an in-process ingest server with an in-memory IngestKeyStore +
// in-memory OrgPolicyStore (no PG dependency at smoke time), then exercises
// the real Bun.redis dedup, node-redis Lua rate limiter, Redis Streams WAL,
// and the real ClickHouse writer. Verifies that the seeded events land in
// CH and that dev_daily_rollup's AggregatingMergeTree state functions
// surface the cost.
//
// Usage:
//   bun run src/smoke.ts            # boots server on $INGEST_PORT or :8765,
//                                   # POSTs 10 events as a single batch,
//                                   # polls CH until count==10, exits 0/1.
//
// Exit 0 on success, 1 otherwise. NOT a bun test — runnable script only,
// reachable via `cd apps/ingest && bun run smoke`. The Bun-test E2E suite
// lives at apps/web/integration-tests/use-fixtures-0.test.ts and asserts
// everything this script demonstrates plus the USE_FIXTURES=0 routing.

import { createHash, randomUUID } from "node:crypto";
import { createClient as createCHClient } from "@clickhouse/client";
import { createNodeRedisLuaClient, createSharedNodeRedisClient } from "./auth/nodeRedisLua";
import { createLuaRateLimiter } from "./auth/rateLimit";
import { type IngestKeyRow, type IngestKeyStore, LRUCache } from "./auth/verifyIngestKey";
import type { ClickHouseWriter } from "./clickhouse";
import { createBunRedisDedupStore } from "./dedup/bunRedisDedupStore";
import { setDeps } from "./deps";
import { startServer } from "./server";
import { InMemoryOrgPolicyStore } from "./tier/enforceTier";
import { createRedisStreamsWalAppender } from "./wal/append";
import { createWalConsumer } from "./wal/consumer";
import { createRedisStreamsWal } from "./wal/redisStreamsWal";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";
const PORT = Number(process.env.INGEST_PORT ?? 8765);

// Bearer regex (apps/ingest/src/auth/verifyIngestKey.ts) accepts only
// alphanumerics in orgId / keyId — no hyphens. Keep all dev IDs simple.
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
  // 1. Wire the real runtime adapters.
  const sharedRedis = await createSharedNodeRedisClient({ url: REDIS_URL });
  const lua = await createNodeRedisLuaClient({ client: sharedRedis });
  const rateLimiter = createLuaRateLimiter(lua);
  const wal = createRedisStreamsWalAppender(createRedisStreamsWal(sharedRedis));
  const dedupStore = createBunRedisDedupStore({ url: REDIS_URL });

  // ClickHouse writer with `date_time_input_format=best_effort` so DateTime64
  // accepts EventSchema's ISO8601 ts (`2026-04-18T01:23:45.678Z`). Without
  // this, the WAL consumer's INSERT raises CANNOT_PARSE_INPUT_ASSERTION_FAILED
  // because canonicalize() forwards the wire ts verbatim. See
  // apps/web/integration-tests/use-fixtures-0.test.ts §Surprises.
  const ch = createCHClient({
    url: CH_URL,
    database: CH_DATABASE,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  const clickhouseWriter: ClickHouseWriter = {
    async insert(rows) {
      await ch.insert({ table: "events", values: rows, format: "JSONEachRow" });
      return { ok: true };
    },
    async ping() {
      const r = await fetch(`${CH_URL}/ping`).catch(() => null);
      return Boolean(r?.ok);
    },
  };

  const policyStore = new InMemoryOrgPolicyStore();
  policyStore.seed(DEV_ORG, {
    tier_c_managed_cloud_optin: false,
    tier_default: "B",
  });

  setDeps({
    store: makeDevStore(),
    cache: new LRUCache({ max: 100, ttlMs: 60_000 }),
    dedupStore,
    rateLimiter,
    wal,
    clickhouseWriter,
    orgPolicyStore: policyStore,
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

  // 4. Fire one batch of 10 valid events.
  const sessionId = `smoke${Date.now()}`;
  const baseTs = Date.now();
  const events = Array.from({ length: 10 }, (_, i) => ({
    client_event_id: randomUUID(),
    schema_version: 1,
    ts: new Date(baseTs - (10 - i) * 1000).toISOString(),
    tenant_id: DEV_ORG,
    engineer_id: DEV_ENG,
    device_id: "smoke-dev",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier: "B",
    session_id: sessionId,
    event_seq: i,
    gen_ai: { system: "anthropic", usage: { input_tokens: 100 * (i + 1), output_tokens: 50 } },
    dev_metrics: { event_kind: "llm_response", cost_usd: 0.001 * (i + 1) },
  }));

  const _res = await fetch(`${base}/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ events }),
  });

  // 5. Poll ClickHouse up to ~5s.
  let count = 0;
  let costUsd = 0;
  for (let attempt = 0; attempt < 25; attempt++) {
    const rs = await ch.query({
      query:
        "SELECT count() AS c, toFloat64(sum(cost_usd)) AS cost FROM events WHERE session_id = {s:String}",
      query_params: { s: sessionId },
      format: "JSON",
    });
    const json = (await rs.json()) as { data: Array<{ c: string | number; cost: number }> };
    count = Number(json.data[0]?.c ?? 0);
    costUsd = Number(json.data[0]?.cost ?? 0);
    if (count >= 10) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // 6. Probe dev_daily_rollup (AggregatingMergeTree → sumMerge state read).
  let rollupCost = 0;
  if (count >= 10) {
    const rs = await ch.query({
      query: `SELECT toFloat64(sumMerge(cost_usd_state)) AS cost
              FROM dev_daily_rollup
              WHERE org_id = {org:String} AND engineer_id = {eng:String}`,
      query_params: { org: DEV_ORG, eng: DEV_ENG },
      format: "JSON",
    });
    const json = (await rs.json()) as { data: Array<{ cost: number }> };
    rollupCost = Number(json.data[0]?.cost ?? 0);
  }

  // 7. Teardown
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
    await ch.close();
  } catch {}

  if (count >= 10 && rollupCost > 0) {
    process.exit(0);
  }
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "error",
      msg: "smoke: FAILED",
      count,
      cost_usd_events: costUsd,
      cost_usd_rollup: rollupCost,
    }),
  );
  process.exit(1);
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
