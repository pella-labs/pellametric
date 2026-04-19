// Bematist — PgBoss worker entrypoint.
// PgBoss is for crons only (CLAUDE.md Architecture Rule #4). Per-event work goes
// to ClickHouse MVs or Redis Streams.

import {
  createInMemoryInstallationTokenCache,
  createRedisInstallationTokenCache,
  getInstallationToken as resolveInstallationToken,
} from "@bematist/api/github/installationToken";
import { prompt_clusters } from "@bematist/schema/postgres";
import type { ClickHouseClient } from "@clickhouse/client";
import PgBoss from "pg-boss";
import {
  createKafkaWebhookBus,
  parseBrokersEnv,
} from "../../ingest/src/github-app/kafkaWebhookBus";
import { GITHUB_WEBHOOKS_TOPIC } from "../../ingest/src/github-app/webhookBus";
import { ch } from "./clickhouse";
import { db, pgClient } from "./db";
import { startKafkaGithubConsumer } from "./github/kafkaConsumer";
import { dispatcherTick as historyBackfillTick } from "./github-history-backfill/dispatcher";
import {
  createLocalSemaphore,
  createNoopRecomputeEmitter,
  createRecomputeEmitter,
  createTokenBucket,
} from "./github-initial-sync";
import { dispatcherTick } from "./github-initial-sync/dispatcher";
import { FsAliasArchiver, runAliasRetirement } from "./github-linker/aliasRetirement";
import { createLinkerConsumer } from "./github-linker/consumer";
import { loadInputs as linkerLoadInputs } from "./github-linker/loadInputs";
import { ensurePartitionsFor } from "./github-linker/partitionCreator";
import { runReconcileScaffold } from "./github-linker/reconcileScaffold";
import { PostgresAnomalyNotifier } from "./jobs/anomaly/pg_notifier";
import type { CohortP95, DailyMetricRow } from "./jobs/anomaly/types";
import { runAnomalyDetection } from "./jobs/anomaly_detect";
import { recluster } from "./jobs/cluster/recluster";
import type { PromptRecordForClustering } from "./jobs/cluster/types";
import { handlePartitionDrop } from "./jobs/partition_drop";

const PG_BOSS_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const GDPR_CRON_SCHEDULE = process.env.GDPR_CRON_SCHEDULE ?? "0 * * * *"; // hourly
// Anomaly detection runs hourly per CLAUDE.md §AI Rules — NOT weekly.
const ANOMALY_CRON_SCHEDULE = process.env.ANOMALY_CRON_SCHEDULE ?? "0 * * * *";
// Nightly recluster (#30) runs at 03:30 UTC by default — outside any business
// hours and after the day's events have settled into CH.
const RECLUSTER_CRON_SCHEDULE = process.env.RECLUSTER_CRON_SCHEDULE ?? "30 3 * * *";
const RECLUSTER_EMBEDDING_MODEL = process.env.RECLUSTER_EMBEDDING_MODEL ?? "openai-3-small-512";
const RECLUSTER_MAX_PROMPTS_PER_ORG = Number(process.env.RECLUSTER_MAX_PROMPTS_PER_ORG ?? 5_000);
// Github initial-sync dispatcher — every 30s by default. Per-event work
// (pagination + DB upserts) runs inside `runInitialSync`, gated by the
// 5-slot local semaphore. CLAUDE.md Rule #4 compliant: this cron is the
// scheduler, not the per-event worker.
const GITHUB_SYNC_DISPATCHER_SCHEDULE =
  process.env.GITHUB_SYNC_DISPATCHER_SCHEDULE ?? "*/1 * * * *";
const GITHUB_HISTORY_BACKFILL_SCHEDULE =
  process.env.GITHUB_HISTORY_BACKFILL_SCHEDULE ?? "*/1 * * * *";
// G1-linker crons — all PgBoss, per CLAUDE.md Architecture Rule #4.
//
// `github.linker.partition_creator` runs at 01:00 UTC on the 25th of every
// month (≈ T-7d before the 1st). Default value overrideable via env.
const LINKER_PARTITION_CREATOR_SCHEDULE =
  process.env.LINKER_PARTITION_CREATOR_SCHEDULE ?? "0 1 25 * *";
// `github.linker.alias_retirement` runs once daily at 02:00 UTC.
const LINKER_ALIAS_RETIREMENT_SCHEDULE =
  process.env.LINKER_ALIAS_RETIREMENT_SCHEDULE ?? "0 2 * * *";
// `github.linker.reconcile_scaffold` runs hourly.
const LINKER_RECONCILE_SCAFFOLD_SCHEDULE =
  process.env.LINKER_RECONCILE_SCAFFOLD_SCHEDULE ?? "15 * * * *";
// Redis-streams consumer tick cadence (seconds). The internal XREADGROUP
// BLOCK is 5s; the dispatcher wakes the tick every `LINKER_TICK_INTERVAL_MS`
// ms — at scale this becomes a long-running loop (below).
const LINKER_TICK_INTERVAL_MS = Number(process.env.LINKER_TICK_INTERVAL_MS ?? 5_000);
const LINKER_ALIAS_ARCHIVE_DIR =
  process.env.BEMATIST_ALIAS_ARCHIVE_DIR ?? "/tmp/bematist/alias-archive";
// Local worker-node semaphore per PRD §11.2 = 5 concurrent initial syncs.
const githubInitialSyncSemaphore = createLocalSemaphore(5);

export async function startWorker() {
  const boss = new PgBoss(PG_BOSS_URL);
  await boss.start();

  await boss.work("gdpr.partition_drop", async () => {
    const processed = await handlePartitionDrop({ db, ch: ch() });
    return { processed };
  });
  await boss.schedule("gdpr.partition_drop", GDPR_CRON_SCHEDULE);

  await boss.work("anomaly.hourly", async () => {
    const emitted = await runHourlyAnomalyJob({ ch: ch() });
    return { emitted };
  });
  await boss.schedule("anomaly.hourly", ANOMALY_CRON_SCHEDULE);

  await boss.work("cluster.recluster_nightly", async () => {
    return await runReclusterAllOrgs({ ch: ch() });
  });
  await boss.schedule("cluster.recluster_nightly", RECLUSTER_CRON_SCHEDULE);

  await boss.work("github.initial_sync_dispatcher", async () => {
    const report = await runGithubInitialSyncDispatcher();
    return report;
  });
  await boss.schedule("github.initial_sync_dispatcher", GITHUB_SYNC_DISPATCHER_SCHEDULE);

  await boss.work("github.history_backfill_dispatcher", async () => {
    const report = await runGithubHistoryBackfillDispatcher();
    return report;
  });
  await boss.schedule("github.history_backfill_dispatcher", GITHUB_HISTORY_BACKFILL_SCHEDULE);

  // G1-linker crons — partition creator (monthly), alias retirement (daily),
  // reconciliation scaffold (hourly). Per CLAUDE.md Architecture Rule #4:
  // PgBoss for crons only. Per-event linker work runs through the Redis
  // Streams consumer loop below, NOT through PgBoss.
  await boss.work("github.linker.partition_creator", async () => {
    return await ensurePartitionsFor(pgClient);
  });
  await boss.schedule("github.linker.partition_creator", LINKER_PARTITION_CREATOR_SCHEDULE);

  await boss.work("github.linker.alias_retirement", async () => {
    const archiver = new FsAliasArchiver(LINKER_ALIAS_ARCHIVE_DIR);
    return await runAliasRetirement(pgClient, archiver);
  });
  await boss.schedule("github.linker.alias_retirement", LINKER_ALIAS_RETIREMENT_SCHEDULE);

  await boss.work("github.linker.reconcile_scaffold", async () => {
    return await runReconcileScaffold(pgClient);
  });
  await boss.schedule("github.linker.reconcile_scaffold", LINKER_RECONCILE_SCAFFOLD_SCHEDULE);

  // G2 — Kafka consumer for `github.webhooks`. Opt-in via
  // KAFKA_TRANSPORT=kafkajs; stays off in solo/embedded mode (no Redpanda
  // broker). Consumer runs in the same process as the linker loop.
  startKafkaGithubConsumerLoop().catch((err) => {
    console.error(
      JSON.stringify({
        level: "error",
        app: "worker-github-kafka",
        msg: "consumer-crashed",
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  // Redis Streams consumer loop for `session_repo_recompute:<tenant_id>`.
  // Fire-and-forget — the loop self-paces via XREADGROUP BLOCK + a short
  // interval. Surfaces errors via console.error; a production deploy
  // supplies Sentry/pino via the log hook.
  startLinkerConsumerLoop().catch((err) => {
    console.error(
      JSON.stringify({
        level: "error",
        app: "github-linker",
        msg: "consumer-loop-crashed",
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  return boss;
}

/**
 * Start the kafkajs consumer for `github.webhooks` when
 * `KAFKA_TRANSPORT=kafkajs`. No-op when the operator left the default
 * (solo mode / tests). Uses the same `consumeMessage` pipeline as the
 * in-memory path.
 */
async function startKafkaGithubConsumerLoop(): Promise<void> {
  const transport = (process.env.KAFKA_TRANSPORT ?? "kafkajs").toLowerCase();
  if (transport !== "kafkajs") {
    return;
  }
  const brokersRaw = process.env.KAFKA_BROKERS ?? process.env.REDPANDA_BROKERS ?? "";
  const brokers = brokersRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const finalBrokers = brokers.length > 0 ? brokers : ["localhost:9092"];

  // B4 — real Redis recompute producer. Previously wired to the in-memory
  // test double, which meant webhook UPSERTs never produced stream entries
  // for the linker consumer to pick up, so `session_repo_links` +
  // `session_repo_eligibility` never materialised. The consumer in this
  // same process reads via its own node-redis client — using a shared
  // client here gets published entries straight onto the stream the
  // consumer is already watching.
  const { createRedisRecomputeStream, createInMemoryRecomputeStream } = await import(
    "../../ingest/src/github-app/recomputeStream"
  );
  const recompute = await (async () => {
    if (process.env.LINKER_CONSUMER_ENABLED === "0" || process.env.NODE_ENV === "test") {
      return createInMemoryRecomputeStream();
    }
    const mod = await import("redis");
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    // biome-ignore lint/suspicious/noExplicitAny: node-redis types
    const redis = (mod as any).createClient({ url });
    redis.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "error",
          app: "worker-github",
          msg: "recompute-producer-redis-error",
          err: msg,
        }),
      );
    });
    await redis.connect();
    return createRedisRecomputeStream(redis);
  })();

  await startKafkaGithubConsumer(
    {
      brokers: finalBrokers,
      topic: process.env.GITHUB_WEBHOOKS_TOPIC ?? "github.webhooks",
      groupId: process.env.BEMATIST_WORKER_GROUP_ID ?? "bematist-github-worker",
    },
    {
      sql: pgClient,
      recompute,
    },
  );
}

/**
 * Start the Redis-Streams consumer loop for the linker. Production wires
 * the `loadInputs` callback against ClickHouse session enrichment + the
 * Postgres state tables; G1 stubs this to null-inputs (no-op) until the
 * session-index query lands in G3 with the reconciliation runner.
 */
async function startLinkerConsumerLoop(): Promise<void> {
  if (process.env.LINKER_CONSUMER_ENABLED === "0") {
    return;
  }
  const mod = await import("redis");
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  // biome-ignore lint/suspicious/noExplicitAny: node-redis types
  const redis = (mod as any).createClient({ url });
  redis.on("error", (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ level: "error", app: "github-linker", msg: "redis-error", err: msg }),
    );
  });
  await redis.connect();

  const chClient = ch();
  const consumer = createLinkerConsumer({
    redis,
    sql: pgClient,
    loadInputs: (tenantId, sessionId) =>
      linkerLoadInputs({ sql: pgClient, ch: chClient }, tenantId, sessionId),
  });

  // Long-running tick loop.
  const loop = async () => {
    while (!consumer.isStopped()) {
      try {
        await consumer.tick();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          JSON.stringify({ level: "error", app: "github-linker", msg: "tick-failed", err: msg }),
        );
      }
      await new Promise((r) => setTimeout(r, LINKER_TICK_INTERVAL_MS));
    }
  };
  loop();
}

/**
 * Hourly anomaly job — pulls the most recent hour's spike per engineer plus a
 * 30-day daily history from `dev_daily_rollup`, derives a per-org cohort P95,
 * and fans out to the detector. The PostgresAnomalyNotifier persists hits
 * into `alerts` and `pg_notify`s the SSE channel so the dashboard's
 * `/sse/anomalies` route gets a server-push (no polling).
 *
 * Detector math is owned by `apps/worker/src/jobs/anomaly/detector.ts` (#27).
 * This loader is pure wiring.
 */
export async function runHourlyAnomalyJob(deps: { ch: ClickHouseClient }): Promise<number> {
  const { ch: client } = deps;
  const hour = new Date();
  hour.setUTCMinutes(0, 0, 0);
  const hourIso = hour.toISOString();

  const history = await loadHistory(client);
  const spikes = await loadHourSpikes(client, hour);
  const cohorts = await loadCohorts(client);

  const perEngineer = spikes.map((s) => ({
    engineer_id: s.engineer_id,
    org_id: s.org_id,
    history: history.filter((h) => h.engineer_id === s.engineer_id && h.org_id === s.org_id),
    spike: {
      cost_usd: s.cost_usd,
      input_tokens: s.input_tokens,
      tool_error_count: s.tool_error_count,
      session_count: s.session_count,
    },
    cohort: cohorts.get(s.org_id) ?? {
      cost_usd: 0,
      input_tokens: 0,
      tool_error_rate: 0,
      size: 0,
    },
  }));

  return runAnomalyDetection({
    hour_bucket: hourIso,
    perEngineer,
    notifier: new PostgresAnomalyNotifier({ db }),
  });
}

async function loadHistory(client: ClickHouseClient): Promise<DailyMetricRow[]> {
  const res = await client.query({
    query: `
      SELECT
        org_id,
        engineer_id,
        toString(day) AS day,
        sumMerge(cost_usd_state) AS cost_usd,
        sumMerge(input_tokens_state) AS input_tokens,
        0 AS tool_error_count,
        uniqMerge(sessions_state) AS session_count
      FROM dev_daily_rollup
      WHERE day >= today() - 30 AND day < today()
      GROUP BY org_id, engineer_id, day
    `,
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as Array<{
    org_id: string;
    engineer_id: string;
    day: string;
    cost_usd: number;
    input_tokens: number;
    tool_error_count: number;
    session_count: number;
  }>;
  return rows.map((r) => ({
    org_id: r.org_id,
    engineer_id: r.engineer_id,
    source: "claude-code",
    day: r.day,
    cost_usd: Number(r.cost_usd),
    input_tokens: Number(r.input_tokens),
    tool_error_count: Number(r.tool_error_count),
    session_count: Number(r.session_count),
  }));
}

interface HourSpike {
  org_id: string;
  engineer_id: string;
  cost_usd: number;
  input_tokens: number;
  tool_error_count: number;
  session_count: number;
}

async function loadHourSpikes(client: ClickHouseClient, hour: Date): Promise<HourSpike[]> {
  const start = hour.toISOString().replace("T", " ").replace("Z", "");
  const res = await client.query({
    query: `
      SELECT
        org_id,
        engineer_id,
        sum(cost_usd) AS cost_usd,
        sum(input_tokens) AS input_tokens,
        countIf(tool_status = 'error') AS tool_error_count,
        uniq(session_id) AS session_count
      FROM events
      WHERE ts >= toDateTime({hour:String}) AND ts < toDateTime({hour:String}) + INTERVAL 1 HOUR
      GROUP BY org_id, engineer_id
    `,
    query_params: { hour: start },
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as HourSpike[];
  return rows.map((r) => ({
    ...r,
    cost_usd: Number(r.cost_usd),
    input_tokens: Number(r.input_tokens),
    tool_error_count: Number(r.tool_error_count),
    session_count: Number(r.session_count),
  }));
}

async function loadCohorts(client: ClickHouseClient): Promise<Map<string, CohortP95>> {
  const res = await client.query({
    query: `
      SELECT
        org_id,
        quantile(0.95)(daily_cost) AS cost_p95,
        quantile(0.95)(daily_tokens) AS tokens_p95,
        quantile(0.95)(daily_err_rate) AS err_p95,
        uniq(engineer_id) AS size
      FROM (
        SELECT
          org_id,
          engineer_id,
          sumMerge(cost_usd_state) AS daily_cost,
          sumMerge(input_tokens_state) AS daily_tokens,
          0 AS daily_err_rate
        FROM dev_daily_rollup
        WHERE day >= today() - 30 AND day < today()
        GROUP BY org_id, engineer_id, day
      )
      GROUP BY org_id
    `,
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as Array<{
    org_id: string;
    cost_p95: number;
    tokens_p95: number;
    err_p95: number;
    size: number;
  }>;
  const map = new Map<string, CohortP95>();
  for (const r of rows) {
    map.set(r.org_id, {
      cost_usd: Number(r.cost_p95),
      input_tokens: Number(r.tokens_p95),
      tool_error_rate: Number(r.err_p95),
      size: Number(r.size),
    });
  }
  return map;
}

/**
 * Run #30's recluster across every org with embeddings in the last 30d.
 * Writes centroids to PG `prompt_clusters` + assignments to CH
 * `cluster_assignment_mv`. Per-org budget is bounded by
 * `RECLUSTER_MAX_PROMPTS_PER_ORG` to keep mini-batch k-means cheap.
 *
 * Tier-A allowlist: only embeddings + session_id + prompt_index leave CH.
 * No prompt_text, no prompt_abstract, no raw_attrs.
 */
export async function runReclusterAllOrgs(deps: { ch: ClickHouseClient }): Promise<{
  orgs: number;
  prompts: number;
  centroids: number;
}> {
  const { ch: client } = deps;
  const orgRowsRes = await client.query({
    query: `SELECT DISTINCT org_id FROM events
            WHERE ts >= now() - INTERVAL 30 DAY
              AND length(prompt_embedding) > 0`,
    format: "JSONEachRow",
  });
  const orgRows = (await orgRowsRes.json()) as Array<{ org_id: string }>;

  let totalPrompts = 0;
  let totalCentroids = 0;

  for (const { org_id } of orgRows) {
    const promptRowsRes = await client.query({
      query: `SELECT session_id, prompt_index, prompt_embedding, ts
              FROM events
              WHERE org_id = {org:String}
                AND ts >= now() - INTERVAL 30 DAY
                AND length(prompt_embedding) > 0
              ORDER BY ts DESC
              LIMIT {lim:UInt32}`,
      query_params: { org: org_id, lim: RECLUSTER_MAX_PROMPTS_PER_ORG },
      format: "JSONEachRow",
    });
    const promptRows = (await promptRowsRes.json()) as Array<{
      session_id: string;
      prompt_index: number;
      prompt_embedding: number[];
      ts: string;
    }>;
    if (promptRows.length === 0) continue;

    const embeddings = promptRows.map((r) => r.prompt_embedding);
    const records: PromptRecordForClustering[] = promptRows.map((r) => ({
      session_id: r.session_id,
      prompt_index: r.prompt_index,
      org_id,
      abstract: "",
    }));

    const result = recluster({ embeddings, records });
    totalPrompts += result.submitted;
    totalCentroids += result.centroids.length;

    if (result.centroids.length === 0) continue;

    await db.insert(prompt_clusters).values(
      result.centroids.map((c) => ({
        org_id,
        centroid: c.centroid,
        dim: c.dim,
        model: RECLUSTER_EMBEDDING_MODEL,
        label: null,
      })),
    );

    const nowIso = new Date().toISOString().replace("T", " ").replace(/\..+$/, "");
    await client.insert({
      table: "cluster_assignment_mv",
      values: result.assignments.map((a) => ({
        org_id,
        session_id: a.session_id,
        prompt_index: a.prompt_index,
        cluster_id: a.cluster_id,
        ts: nowIso,
      })),
      format: "JSONEachRow",
    });
  }

  return { orgs: orgRows.length, prompts: totalPrompts, centroids: totalCentroids };
}

/**
 * PgBoss cron body for `github.initial_sync_dispatcher`. Reads queued rows
 * from `github_sync_progress` and runs each under the shared 5-slot
 * semaphore. Production wiring — unit tests use a direct `dispatcherTick`
 * call with fakes per `apps/worker/src/github-initial-sync/initialSync.test.ts`.
 *
 * Token-bucket state lives in Redis (production) but the token bucket we
 * construct here owns its own lazy Redis connection — for now, we
 * short-circuit to a process-local in-memory store until the worker has
 * a shared Redis client (Sprint 2). The token bucket is additive
 * back-pressure; Phase 0 / G1 tests pass without a real Redis because the
 * GitHub rate-limit headers are the authoritative signal.
 */
async function runGithubInitialSyncDispatcher(): Promise<
  import("./github-initial-sync/dispatcher").DispatcherTickReport
> {
  const mem = new Map<string, string>();
  const tokenBucket = createTokenBucket({
    store: {
      async get(key) {
        return mem.get(key) ?? null;
      },
      async set(key, value) {
        mem.set(key, value);
      },
    },
    refillPerSecond: 1,
    burst: 10,
  });

  // B2 — real Redis recompute emitter + shared installation-token cache.
  // When REDIS_URL is unreachable OR we're in a LINKER_CONSUMER_ENABLED=0
  // test path, fall back to a noop emitter + in-memory token cache so the
  // PgBoss cron still makes incremental progress; producers that would have
  // pushed to Redis instead short-circuit cleanly.
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY_PEM;
  const redisDisabled =
    process.env.LINKER_CONSUMER_ENABLED === "0" || process.env.NODE_ENV === "test";

  let emitRecompute: ReturnType<typeof createNoopRecomputeEmitter> = createNoopRecomputeEmitter();
  let tokenCacheRedisConnected = false;
  let redisClient: unknown = null;
  if (!redisDisabled) {
    try {
      const mod = await import("redis");
      const url = process.env.REDIS_URL ?? "redis://localhost:6379";
      // biome-ignore lint/suspicious/noExplicitAny: node-redis v4 types are large
      const client = (mod as any).createClient({ url });
      client.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          JSON.stringify({
            level: "error",
            app: "worker-github-dispatcher",
            msg: "redis-error",
            err: msg,
          }),
        );
      });
      await client.connect();
      redisClient = client;
      tokenCacheRedisConnected = true;
      emitRecompute = createRecomputeEmitter({
        async xadd(stream, fields) {
          return (await client.xAdd(stream, "*", fields)) as string;
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          level: "warn",
          app: "worker-github-dispatcher",
          msg: "redis-unavailable-falling-back",
          err: msg,
        }),
      );
    }
  }

  const tokenCache = tokenCacheRedisConnected
    ? createRedisInstallationTokenCache({
        // biome-ignore lint/suspicious/noExplicitAny: node-redis v4 client
        get: (k: string) => (redisClient as any).get(k),
        // biome-ignore lint/suspicious/noExplicitAny: node-redis v4 client
        set: (k: string, v: string, opts?: { PX?: number; EX?: number }) =>
          // biome-ignore lint/suspicious/noExplicitAny: node-redis v4 client
          (redisClient as any).set(k, v, opts),
        // biome-ignore lint/suspicious/noExplicitAny: node-redis v4 client
        del: (k: string) => (redisClient as any).del(k),
      })
    : createInMemoryInstallationTokenCache();

  const getInstallationToken = async (installationId: bigint): Promise<string> => {
    if (!appId || !privateKeyPem) {
      throw new Error(
        "github-initial-sync: GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY_PEM not configured — " +
          `cannot mint installation token for ${installationId.toString()}`,
      );
    }
    return resolveInstallationToken({
      installationId: installationId.toString(),
      appId,
      privateKeyPem,
      cache: tokenCache,
    });
  };

  return await dispatcherTick({
    sql: pgClient,
    semaphore: githubInitialSyncSemaphore,
    tokenBucket,
    getInstallationToken,
    emitRecompute,
  });
}

/**
 * PgBoss cron body for `github.history_backfill_dispatcher`. Reuses the
 * same installation-token resolver + token-bucket semaphore pattern as the
 * initial-sync dispatcher. Publishes synthesized webhook payloads onto the
 * real Kafka `github.webhooks` topic so the existing consumer is the
 * single write path (no parallel DB writer to maintain).
 */
async function runGithubHistoryBackfillDispatcher(): Promise<
  import("./github-history-backfill/dispatcher").HistoryDispatcherTickReport
> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY_PEM;
  if (!appId || !privateKeyPem) {
    console.error(
      JSON.stringify({
        level: "warn",
        app: "worker-github-history-backfill",
        msg: "skipping tick — GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY_PEM not set",
      }),
    );
    return { autoEnqueued: 0, picked: 0, completed: 0, failed: 0 };
  }

  const brokers = parseBrokersEnv(process.env);
  if (brokers.length === 0) {
    console.error(
      JSON.stringify({
        level: "warn",
        app: "worker-github-history-backfill",
        msg: "skipping tick — KAFKA_BROKERS not set",
      }),
    );
    return { autoEnqueued: 0, picked: 0, completed: 0, failed: 0 };
  }

  const mem = new Map<string, string>();
  const tokenBucket = createTokenBucket({
    store: {
      async get(key) {
        return mem.get(key) ?? null;
      },
      async set(key, value) {
        mem.set(key, value);
      },
    },
    refillPerSecond: 1,
    burst: 10,
  });

  const tokenCache = createInMemoryInstallationTokenCache();
  const getInstallationToken = async (installationId: bigint): Promise<string> => {
    return resolveInstallationToken({
      installationId: installationId.toString(),
      appId,
      privateKeyPem,
      cache: tokenCache,
    });
  };

  const bus = createKafkaWebhookBus({ brokers, clientId: "bematist-history-backfill" });
  try {
    await bus.ensureTopic(GITHUB_WEBHOOKS_TOPIC, 4);
    return await historyBackfillTick({
      sql: pgClient,
      semaphore: githubInitialSyncSemaphore,
      tokenBucket,
      getInstallationToken,
      publish: (topic, msg) => bus.publish(topic, msg),
      log: (entry) => console.log(JSON.stringify({ ...entry, app: "worker-history-backfill" })),
    });
  } finally {
    await bus.close();
  }
}

if (import.meta.main) {
  await startWorker();
}
