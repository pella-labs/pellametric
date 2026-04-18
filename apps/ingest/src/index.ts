import { parsePublicKeysEnv } from "@bematist/config";
import { verifyBearer } from "./auth";
import {
  createNodeRedisLuaClient,
  createSharedNodeRedisClient,
  type NodeRedisClient,
} from "./auth/nodeRedisLua";
import { createLuaRateLimiter } from "./auth/rateLimit";
import { createRealClickHouseWriter } from "./clickhouse/realWriter";
import { createBunRedisDedupStore } from "./dedup/bunRedisDedupStore";
import { getDeps, setDeps } from "./deps";
import { assertFlagCoherence, FlagIncoherentError, parseFlags } from "./flags";
import { logger } from "./logger";
import { startOtlpServer } from "./otlp/server";
import { createPolicyFlipDbHandle } from "./policy-flip/dbClient";
import { DrizzleAlertEmitter } from "./policy-flip/drizzleAlerts";
import { DrizzleAuditWriter } from "./policy-flip/drizzleAudit";
import { DrizzlePolicyFlipStore } from "./policy-flip/drizzleStore";
import type { PolicyFlipDeps } from "./policy-flip/handler";
import { applyCoreRlimit } from "./rlimit";
import { startServer } from "./server";
import { createRedisStreamsWalAppender } from "./wal/append";
import { createWalConsumer } from "./wal/consumer";
import { createRedisStreamsWal } from "./wal/redisStreamsWal";

// Phase 1: disable core dumps before accepting traffic. Crash dump files can
// leak Tier-C prompt text and secrets to disk. The Dockerfile entrypoint
// (`ulimit -c 0`) is the belt; this is the suspenders.
applyCoreRlimit(logger);

// Phase 4: parse flags and enforce coherence before wiring anything.
const flags = parseFlags(process.env as Record<string, string | undefined>);
try {
  assertFlagCoherence(flags);
} catch (e) {
  if (e instanceof FlagIncoherentError) {
    logger.error({ code: e.code, details: e.details }, "flag incoherent");
  } else {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "flag check failed");
  }
  process.exit(2);
}

// Sprint-1 follow-up A: wire real runtime adapters (node-redis for Lua +
// streams, Bun.redis for dedup, @clickhouse/client for writes) when not
// running under bun test. Test boots keep the in-memory test doubles from
// deps.ts — those never touch the network.
let sharedNodeRedis: (NodeRedisClient & { quit(): Promise<void> }) | null = null;
let luaRedisHandle: { quit: () => Promise<void> } | null = null;
let policyFlipDbHandle: { close(): Promise<void> } | null = null;

if (process.env.NODE_ENV !== "test") {
  try {
    // One shared node-redis client; Lua + Streams share the connection.
    const redisUrl = process.env.REDIS_URL;
    sharedNodeRedis = await createSharedNodeRedisClient(redisUrl ? { url: redisUrl } : {});
    const luaRedis = await createNodeRedisLuaClient({ client: sharedNodeRedis });
    luaRedisHandle = luaRedis;
    const rateLimiter = createLuaRateLimiter(luaRedis);

    const wal = createRedisStreamsWalAppender(createRedisStreamsWal(sharedNodeRedis));
    const dedupStore = createBunRedisDedupStore(redisUrl ? { url: redisUrl } : {});

    // Sprint-1 follow-up A: always use the real @clickhouse/client writer on
    // boot now. The lazy wrapper in clickhouse.ts remains for ops-chosen
    // deferred-load scenarios via setDeps() but is no longer the default path.
    const clickhouseWriter = createRealClickHouseWriter();

    setDeps({ dedupStore, rateLimiter, wal, clickhouseWriter });
    logger.info(
      { bun_version: Bun.version, redis_url: process.env.REDIS_URL ?? "default" },
      "runtime adapters wired (bun.redis dedup, node-redis lua+streams, @clickhouse/client)",
    );

    // D20 policy-flip deps — pinned Ed25519 keys from env, Drizzle-backed
    // store/audit/alert writing to the control-plane DB. Left unwired when
    // SIGNED_CONFIG_PUBLIC_KEYS is absent so the HTTP route 500s loudly
    // instead of silently ignoring misconfiguration.
    try {
      const publicKeysRaw = parsePublicKeysEnv(process.env.SIGNED_CONFIG_PUBLIC_KEYS);
      if (publicKeysRaw.length === 0) {
        logger.warn(
          { code: "POLICY_FLIP_NO_KEYS" },
          "SIGNED_CONFIG_PUBLIC_KEYS absent; /v1/admin/policy-flip will 500 until configured",
        );
      } else {
        const handle = createPolicyFlipDbHandle();
        policyFlipDbHandle = handle;
        const policyFlip: PolicyFlipDeps = {
          store: new DrizzlePolicyFlipStore({ db: handle.db }),
          audit: new DrizzleAuditWriter({ db: handle.db }),
          alerts: new DrizzleAlertEmitter({ db: handle.db }),
          publicKeysRaw,
          now: () => new Date(),
        };
        setDeps({ policyFlip });
        logger.info(
          { pinned_keys: publicKeysRaw.length },
          "policy-flip deps wired (drizzle store/audit/alerts + pg_notify)",
        );
      }
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          code: "POLICY_FLIP_WIRING_FAILED",
        },
        "policy-flip wiring failed; /v1/admin/policy-flip will 500 until fixed",
      );
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), code: "ADAPTER_WIRING_FAILED" },
      "runtime adapter wiring failed; falling back to in-memory defaults",
    );
  }
}

const ingestServer = startServer();

// Phase 5: start OTLP receiver on :4318 when flag is on. Skipped in tests so
// bun test doesn't bind a port. SIGTERM hook below stops both servers.
let otlpHandle: ReturnType<typeof startOtlpServer> | null = null;
if (flags.OTLP_RECEIVER_ENABLED && process.env.NODE_ENV !== "test") {
  const deps = getDeps();
  otlpHandle = startOtlpServer({
    port: 4318,
    deps: {
      flags,
      wal: deps.wal,
      dedupStore: deps.dedupStore,
      orgPolicyStore: deps.orgPolicyStore,
      rateLimiter: deps.rateLimiter,
    },
    verify: (header) => verifyBearer(header, deps.store, deps.cache),
  });
}

// Phase 4: start WAL consumer if enabled and the shared redis client is up.
// Skipped in tests so bun test doesn't spawn a background loop that leaks
// across suite boundaries.
let walConsumerHandle: ReturnType<typeof createWalConsumer> | null = null;
if (flags.WAL_CONSUMER_ENABLED && process.env.NODE_ENV !== "test" && sharedNodeRedis) {
  const consumer = createWalConsumer({
    redis: createRedisStreamsWal(sharedNodeRedis),
    ch: getDeps().clickhouseWriter,
  });
  walConsumerHandle = consumer;
  // walConsumerLag is surfaced on /readyz — bind the accessor now.
  setDeps({ walConsumerLag: () => consumer.lag() });
  void consumer.start();
  logger.info({ flag: "WAL_CONSUMER_ENABLED" }, "wal consumer started");
}

if (process.env.NODE_ENV !== "test") {
  const shutdown = async (sig: string) => {
    logger.info({ sig }, "shutdown signal received, draining");
    try {
      ingestServer.stop(true);
    } catch {
      // ignore
    }
    if (otlpHandle) {
      try {
        await otlpHandle.stop();
      } catch {}
    }
    if (walConsumerHandle) {
      try {
        await walConsumerHandle.stop();
      } catch {}
    }
    if (luaRedisHandle) {
      try {
        await luaRedisHandle.quit();
      } catch {}
    }
    if (sharedNodeRedis) {
      try {
        await sharedNodeRedis.quit();
      } catch {}
    }
    if (policyFlipDbHandle) {
      try {
        await policyFlipDbHandle.close();
      } catch {}
    }
  };
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
