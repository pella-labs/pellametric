// CH-backed per-engineer rollup for /teams. Queries the shared `events`
// table on OG's ClickHouse (populated by every teammate's collector) and
// returns per-engineer aggregates + cohort totals.
//
// Never reads prompt text — CH literally doesn't have any (Tier B at
// ingest strips it). Every field here is a counter or a category.

import "server-only";

import { createClient } from "@clickhouse/client";

const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";

export interface EngineerRollup {
  id: string;
  shortId: string;
  sessions: number;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  firstTryRate: number;
  toolCalls: number;
  toolErrors: number;
  activeDays: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CohortRollup {
  orgId: string;
  engineers: EngineerRollup[];
  totals: {
    engineers: number;
    sessions: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
  };
}

function chClient() {
  return createClient({
    url: CH_URL,
    database: CH_DATABASE,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
}

/**
 * Per-engineer rollup across the requested window, scoped to the viewer's
 * tenant. Returns empty arrays if CH is unreachable or the tenant has no
 * events — caller decides whether to fall back to grammata.
 */
export async function getCohort(
  tenantId: string,
  windowDays = 30,
): Promise<CohortRollup> {
  const ch = chClient();
  try {
    const rs = await ch.query({
      query: `
        SELECT
          engineer_id,
          count() AS events,
          uniqExact(session_id) AS sessions,
          sum(input_tokens) AS input_tokens,
          sum(output_tokens) AS output_tokens,
          round(sum(cost_usd), 4) AS cost,
          sum(toUInt32(tool_status = 'error')) AS tool_errors,
          sum(toUInt32(tool_status != '' AND tool_status != 'pending')) AS tool_calls,
          uniqExact(toDate(ts)) AS active_days,
          min(toString(ts)) AS first_seen,
          max(toString(ts)) AS last_seen
        FROM events
        WHERE org_id = {tenantId:String}
          AND ts > now() - INTERVAL {windowDays:UInt16} DAY
        GROUP BY engineer_id
        ORDER BY cost DESC
      `,
      query_params: { tenantId, windowDays },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{
      engineer_id: string;
      events: number;
      sessions: number;
      input_tokens: number;
      output_tokens: number;
      cost: number;
      tool_errors: number;
      tool_calls: number;
      active_days: number;
      first_seen: string;
      last_seen: string;
    }>;
    await ch.close();

    const engineers: EngineerRollup[] = rows.map((r) => ({
      id: r.engineer_id,
      shortId:
        r.engineer_id.length > 12
          ? `${r.engineer_id.slice(0, 6)}…${r.engineer_id.slice(-4)}`
          : r.engineer_id,
      events: Number(r.events) || 0,
      sessions: Number(r.sessions) || 0,
      inputTokens: Number(r.input_tokens) || 0,
      outputTokens: Number(r.output_tokens) || 0,
      cost: Number(r.cost) || 0,
      toolCalls: Number(r.tool_calls) || 0,
      toolErrors: Number(r.tool_errors) || 0,
      firstTryRate:
        Number(r.tool_calls) > 0
          ? 1 - Number(r.tool_errors) / Number(r.tool_calls)
          : 1,
      activeDays: Number(r.active_days) || 0,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
    }));

    return {
      orgId: tenantId,
      engineers,
      totals: {
        engineers: engineers.length,
        sessions: engineers.reduce((a, e) => a + e.sessions, 0),
        cost: engineers.reduce((a, e) => a + e.cost, 0),
        inputTokens: engineers.reduce((a, e) => a + e.inputTokens, 0),
        outputTokens: engineers.reduce((a, e) => a + e.outputTokens, 0),
      },
    };
  } catch {
    await ch.close().catch(() => undefined);
    return {
      orgId: tenantId,
      engineers: [],
      totals: { engineers: 0, sessions: 0, cost: 0, inputTokens: 0, outputTokens: 0 },
    };
  }
}

/** Per-engineer time series (daily cost) over the window. Used for drill-in. */
export async function getEngineerDaily(
  tenantId: string,
  engineerId: string,
  windowDays = 30,
): Promise<Array<{ date: string; cost: number; sessions: number; tokens: number }>> {
  const ch = chClient();
  try {
    const rs = await ch.query({
      query: `
        SELECT
          toDate(ts) AS day,
          round(sum(cost_usd), 4) AS cost,
          uniqExact(session_id) AS sessions,
          sum(input_tokens + output_tokens) AS tokens
        FROM events
        WHERE org_id = {tenantId:String}
          AND engineer_id = {engineerId:String}
          AND ts > now() - INTERVAL {windowDays:UInt16} DAY
        GROUP BY day
        ORDER BY day
      `,
      query_params: { tenantId, engineerId, windowDays },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{
      day: string;
      cost: number;
      sessions: number;
      tokens: number;
    }>;
    await ch.close();
    return rows.map((r) => ({
      date: r.day,
      cost: Number(r.cost) || 0,
      sessions: Number(r.sessions) || 0,
      tokens: Number(r.tokens) || 0,
    }));
  } catch {
    await ch.close().catch(() => undefined);
    return [];
  }
}

/** Per-engineer top models by cost. */
export async function getEngineerModels(
  tenantId: string,
  engineerId: string,
  windowDays = 30,
): Promise<Array<{ model: string; provider: string; sessions: number; cost: number }>> {
  const ch = chClient();
  try {
    const rs = await ch.query({
      query: `
        SELECT
          gen_ai_response_model AS model,
          any(gen_ai_system) AS provider,
          uniqExact(session_id) AS sessions,
          round(sum(cost_usd), 4) AS cost
        FROM events
        WHERE org_id = {tenantId:String}
          AND engineer_id = {engineerId:String}
          AND ts > now() - INTERVAL {windowDays:UInt16} DAY
          AND gen_ai_response_model != ''
        GROUP BY model
        ORDER BY cost DESC
        LIMIT 10
      `,
      query_params: { tenantId, engineerId, windowDays },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as Array<{
      model: string;
      provider: string;
      sessions: number;
      cost: number;
    }>;
    await ch.close();
    return rows.map((r) => ({
      model: r.model,
      provider: r.provider,
      sessions: Number(r.sessions) || 0,
      cost: Number(r.cost) || 0,
    }));
  } catch {
    await ch.close().catch(() => undefined);
    return [];
  }
}
