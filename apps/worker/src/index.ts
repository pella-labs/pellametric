// Bematist — PgBoss worker entrypoint.
// PgBoss is for crons only (CLAUDE.md Architecture Rule #4). Per-event work goes
// to ClickHouse MVs or Redis Streams.

import type { ClickHouseClient } from "@clickhouse/client";
import PgBoss from "pg-boss";
import { ch } from "./clickhouse";
import { db } from "./db";
import { PostgresAnomalyNotifier } from "./jobs/anomaly/pg_notifier";
import type { CohortP95, DailyMetricRow } from "./jobs/anomaly/types";
import { runAnomalyDetection } from "./jobs/anomaly_detect";
import { handlePartitionDrop } from "./jobs/partition_drop";

const PG_BOSS_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const GDPR_CRON_SCHEDULE = process.env.GDPR_CRON_SCHEDULE ?? "0 * * * *"; // hourly
// Anomaly detection runs hourly per CLAUDE.md §AI Rules — NOT weekly.
const ANOMALY_CRON_SCHEDULE = process.env.ANOMALY_CRON_SCHEDULE ?? "0 * * * *";

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

  console.log(
    "[worker] started; gdpr.partition_drop:",
    GDPR_CRON_SCHEDULE,
    "anomaly.hourly:",
    ANOMALY_CRON_SCHEDULE,
  );
  return boss;
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

if (import.meta.main) {
  await startWorker();
}
