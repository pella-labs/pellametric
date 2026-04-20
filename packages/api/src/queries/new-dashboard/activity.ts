import { assertRole, type Ctx } from "../../auth";
import { useFixtures } from "../../env";
import type {
  ActivityDailyPoint,
  ActivityHeatmapCell,
  ActivityKpis,
  ActivityOverviewInput,
  ActivityOverviewOutput,
  TopModel,
  TopTool,
} from "../../schemas/new-dashboard";
import { buildCommonClauses, round2, seededRand, seedFromString, WINDOW_DAYS } from "./_shared";

export async function activityOverview(
  ctx: Ctx,
  input: ActivityOverviewInput,
): Promise<ActivityOverviewOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);
  if (useFixtures()) return activityOverviewFixture(ctx, input);
  return activityOverviewReal(ctx, input);
}

async function activityOverviewFixture(
  ctx: Ctx,
  input: ActivityOverviewInput,
): Promise<ActivityOverviewOutput> {
  const days = WINDOW_DAYS[input.window];
  const seed = seedFromString(
    `${ctx.tenant_id}|activity|${input.window}|${(input.engineer_ids ?? []).join(",")}`,
  );
  const sessionsBase = 40 + Math.floor(seededRand(seed, 1) * 200);
  const sessions = Math.round(sessionsBase * (days / 30));
  const avgCost = 0.8 + seededRand(seed, 2) * 3.2;
  const spend = round2(sessions * avgCost);

  const daily: ActivityDailyPoint[] = [];
  for (let i = 0; i < days; i++) {
    const s = Math.max(0, Math.round(sessions / days + (seededRand(seed, 10 + i) - 0.5) * 6));
    daily.push({
      day: isoDay(days - i - 1),
      sessions: s,
      spend_usd: round2(s * avgCost),
    });
  }

  const heatmap: ActivityHeatmapCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const peak = dow >= 1 && dow <= 5 && h >= 9 && h <= 18 ? 1.6 : 0.15;
      heatmap.push({
        dow,
        hour: h,
        sessions: Math.round(seededRand(seed, dow * 24 + h) * 8 * peak),
      });
    }
  }

  const top_tools: TopTool[] = [
    { tool_name: "Bash", calls: Math.round(sessions * 12), errors: Math.round(sessions * 0.8) },
    { tool_name: "Read", calls: Math.round(sessions * 10), errors: Math.round(sessions * 0.2) },
    { tool_name: "Edit", calls: Math.round(sessions * 5), errors: Math.round(sessions * 0.3) },
    { tool_name: "Write", calls: Math.round(sessions * 2), errors: Math.round(sessions * 0.1) },
    { tool_name: "Grep", calls: Math.round(sessions * 2), errors: 0 },
  ];

  const top_models: TopModel[] = [
    {
      model: "claude-sonnet-4-6",
      sessions: Math.round(sessions * 0.6),
      spend_usd: round2(spend * 0.55),
    },
    {
      model: "claude-opus-4-7",
      sessions: Math.round(sessions * 0.25),
      spend_usd: round2(spend * 0.35),
    },
    {
      model: "claude-haiku-4-5",
      sessions: Math.round(sessions * 0.15),
      spend_usd: round2(spend * 0.1),
    },
  ];

  const kpis: ActivityKpis = {
    sessions,
    spend_usd: spend,
    input_tokens: sessions * 22000,
    output_tokens: sessions * 4800,
    cache_read_tokens: sessions * 120000,
    active_days: Math.min(days, Math.round(days * 0.7)),
    avg_session_cost: round2(avgCost),
  };

  return {
    kpis,
    daily,
    heatmap,
    top_tools,
    top_models,
    updated_at: new Date().toISOString(),
  };
}

async function activityOverviewReal(
  ctx: Ctx,
  input: ActivityOverviewInput,
): Promise<ActivityOverviewOutput> {
  const days = WINDOW_DAYS[input.window];
  const { clauses, params } = buildCommonClauses(ctx.tenant_id, days, input);

  const kpiRows = await ctx.db.ch.query<{
    sessions: number | string;
    spend_usd: number | string;
    input_tokens: number | string;
    output_tokens: number | string;
    cache_read_tokens: number | string;
    active_days: number | string;
  }>(
    `SELECT
       uniqExact(session_id) AS sessions,
       round(sum(cost_usd), 6) AS spend_usd,
       sum(input_tokens) AS input_tokens,
       sum(output_tokens) AS output_tokens,
       sum(cache_read_input_tokens) AS cache_read_tokens,
       uniqExact(toDate(ts, 'UTC')) AS active_days
     FROM events
     WHERE ${clauses.join(" AND ")}`,
    params,
  );
  const k = kpiRows[0] ?? {
    sessions: 0,
    spend_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    active_days: 0,
  };
  const sessions = Number(k.sessions);
  const spend = Number(k.spend_usd);

  const dailyRows = await ctx.db.ch.query<{
    day: string;
    sessions: number | string;
    spend_usd: number | string;
  }>(
    `SELECT
       toString(toDate(ts, 'UTC')) AS day,
       uniqExact(session_id) AS sessions,
       round(sum(cost_usd), 6) AS spend_usd
     FROM events
     WHERE ${clauses.join(" AND ")}
     GROUP BY day
     ORDER BY day ASC`,
    params,
  );

  const heatmapRows = await ctx.db.ch.query<{
    dow: number | string;
    hour: number | string;
    sessions: number | string;
  }>(
    `SELECT
       (toDayOfWeek(ts, 0, 'UTC') % 7) AS dow,
       toHour(ts, 'UTC') AS hour,
       uniqExact(session_id) AS sessions
     FROM events
     WHERE ${clauses.join(" AND ")}
     GROUP BY dow, hour`,
    params,
  );

  const toolRows = await ctx.db.ch.query<{
    tool_name: string;
    calls: number | string;
    errors: number | string;
  }>(
    `SELECT
       tool_name,
       count() AS calls,
       countIf(tool_status = 'error') AS errors
     FROM events
     WHERE ${clauses.join(" AND ")}
       AND event_kind IN ('tool_call', 'tool_result')
       AND tool_name != ''
     GROUP BY tool_name
     ORDER BY calls DESC
     LIMIT 15`,
    params,
  );

  const modelRows = await ctx.db.ch.query<{
    model: string;
    sessions: number | string;
    spend_usd: number | string;
  }>(
    `SELECT
       coalesce(nullIf(gen_ai_response_model, ''), nullIf(gen_ai_request_model, '')) AS model,
       uniqExact(session_id) AS sessions,
       round(sum(cost_usd), 6) AS spend_usd
     FROM events
     WHERE ${clauses.join(" AND ")}
       AND (gen_ai_response_model != '' OR gen_ai_request_model != '')
     GROUP BY model
     ORDER BY spend_usd DESC
     LIMIT 10`,
    params,
  );

  return {
    kpis: {
      sessions,
      spend_usd: round2(spend),
      input_tokens: Number(k.input_tokens),
      output_tokens: Number(k.output_tokens),
      cache_read_tokens: Number(k.cache_read_tokens),
      active_days: Number(k.active_days),
      avg_session_cost: sessions > 0 ? round2(spend / sessions) : 0,
    },
    daily: dailyRows.map((r) => ({
      day: r.day,
      sessions: Number(r.sessions),
      spend_usd: round2(Number(r.spend_usd)),
    })),
    heatmap: heatmapRows.map((r) => ({
      dow: Number(r.dow) % 7,
      hour: Number(r.hour),
      sessions: Number(r.sessions),
    })),
    top_tools: toolRows.map((r) => ({
      tool_name: r.tool_name,
      calls: Number(r.calls),
      errors: Number(r.errors),
    })),
    top_models: modelRows
      .filter((r) => r.model)
      .map((r) => ({
        model: r.model,
        sessions: Number(r.sessions),
        spend_usd: round2(Number(r.spend_usd)),
      })),
    updated_at: new Date().toISOString(),
  };
}

function isoDay(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
