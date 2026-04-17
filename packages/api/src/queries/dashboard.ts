import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import { applyDisplayGate } from "../gates";
import type { DashboardSummaryInput, DashboardSummaryOutput } from "../schemas/dashboard";

/**
 * Top-of-dashboard summary — cost, accepted edits, sessions, AI Leverage Score.
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads `dev_daily_rollup` / `team_weekly_rollup` MVs.
 *   - Otherwise (default) synthesizes a plausible deterministic series so the
 *     UI renders end-to-end against the real output shape. Byte-identical to
 *     the Sprint-1 fixture behavior.
 *
 * When Jorge's MVs land, M2 gate flips by setting `USE_FIXTURES=0`.
 */
export async function getSummary(
  ctx: Ctx,
  input: DashboardSummaryInput,
): Promise<DashboardSummaryOutput> {
  assertRole(ctx, ["admin", "manager", "viewer"]);
  if (useFixtures()) return getSummaryFixture(ctx, input);
  return getSummaryReal(ctx, input);
}

async function getSummaryFixture(
  ctx: Ctx,
  input: DashboardSummaryInput,
): Promise<DashboardSummaryOutput> {
  const days = WINDOW_DAYS[input.window];
  const series = buildFixtureSeries(ctx.tenant_id, days);
  const total = series.reduce((s, p) => s + p.y, 0);

  // Gate the AI Leverage Score. For fixture mode we assume healthy cohort.
  const gate = applyDisplayGate({
    sessions_count: Math.round(days * 3.2),
    active_days: Math.round(days * 0.7),
    outcome_events: Math.round(days * 0.8),
    cohort_size: input.team_id ? 12 : 20,
    team_scope: Boolean(input.team_id),
  });

  const ai_leverage_score = gate.show
    ? { show: true as const, value: 72 }
    : {
        show: false as const,
        suppression_reason: gate.suppression_reason,
        failed_gates: gate.failed_gates,
      };

  return {
    window: input.window,
    total_cost_usd: round2(total),
    any_cost_estimated: false,
    accepted_edits: Math.round(days * 4.1),
    merged_prs: Math.round(days * 0.35),
    sessions: Math.round(days * 3.2),
    cost_series: series,
    ai_leverage_score,
  };
}

/**
 * Real-branch ClickHouse read.
 *
 * EXPLAIN: Uses `dev_daily_rollup` MV for per-day cost series (projection
 * `p_org_ts`), `team_weekly_rollup` for team-scoped scoring. Tier-A forbidden
 * columns (prompt_text, tool_input, tool_output, messages, toolArgs,
 * toolOutputs, fileContents, diffs, filePaths, ticketIds, emails, realNames)
 * are NEVER selected — aggregates only.
 *
 * Partitioning filter `org_id = {tenant_id}` is mandatory; RLS backup on PG
 * side, but CH has no RLS — the parameterized filter is the boundary.
 */
async function getSummaryReal(
  ctx: Ctx,
  input: DashboardSummaryInput,
): Promise<DashboardSummaryOutput> {
  const days = WINDOW_DAYS[input.window];

  const seriesRows = await ctx.db.ch.query<{
    day: string;
    cost_usd: number;
    any_cost_estimated: number;
  }>(
    `SELECT
       toDate(day) AS day,
       sum(cost_usd) AS cost_usd,
       max(cost_estimated) AS any_cost_estimated
     FROM dev_daily_rollup
     WHERE org_id = {tenant_id:String}
       AND day >= today() - {days:UInt16}
       ${input.team_id ? "AND team_id = {team_id:String}" : ""}
     GROUP BY day
     ORDER BY day ASC`,
    {
      tenant_id: ctx.tenant_id,
      days,
      ...(input.team_id ? { team_id: input.team_id } : {}),
    },
  );

  const aggRows = await ctx.db.ch.query<{
    accepted_edits: number;
    merged_prs: number;
    sessions: number;
    active_days: number;
    outcome_events: number;
    cohort_size: number;
  }>(
    `SELECT
       sum(accepted_edits) AS accepted_edits,
       sum(merged_prs) AS merged_prs,
       sum(sessions) AS sessions,
       uniqExact(day) AS active_days,
       sum(outcome_events) AS outcome_events,
       uniqExact(engineer_id) AS cohort_size
     FROM dev_daily_rollup
     WHERE org_id = {tenant_id:String}
       AND day >= today() - {days:UInt16}
       ${input.team_id ? "AND team_id = {team_id:String}" : ""}`,
    {
      tenant_id: ctx.tenant_id,
      days,
      ...(input.team_id ? { team_id: input.team_id } : {}),
    },
  );

  const agg = aggRows[0] ?? {
    accepted_edits: 0,
    merged_prs: 0,
    sessions: 0,
    active_days: 0,
    outcome_events: 0,
    cohort_size: 0,
  };

  const series = seriesRows.map((r) => ({
    x: r.day,
    y: round2(Number(r.cost_usd)),
  }));
  const total = series.reduce((s, p) => s + p.y, 0);
  const anyEstimated = seriesRows.some((r) => Number(r.any_cost_estimated) > 0);

  const gate = applyDisplayGate({
    sessions_count: Number(agg.sessions),
    active_days: Number(agg.active_days),
    outcome_events: Number(agg.outcome_events),
    cohort_size: Number(agg.cohort_size),
    team_scope: Boolean(input.team_id),
  });

  let ai_leverage_score: DashboardSummaryOutput["ai_leverage_score"];
  if (gate.show) {
    const scoreRows = await ctx.db.ch.query<{ ai_leverage_v1: number }>(
      `SELECT avg(ai_leverage_v1) AS ai_leverage_v1
         FROM team_weekly_rollup
         WHERE org_id = {tenant_id:String}
           AND week_start >= today() - {days:UInt16}
           ${input.team_id ? "AND team_id = {team_id:String}" : ""}`,
      {
        tenant_id: ctx.tenant_id,
        days,
        ...(input.team_id ? { team_id: input.team_id } : {}),
      },
    );
    const rawScore = Math.round(Number(scoreRows[0]?.ai_leverage_v1 ?? 0));
    ai_leverage_score = {
      show: true,
      value: clamp(rawScore, 0, 100),
    };
  } else {
    ai_leverage_score = {
      show: false,
      suppression_reason: gate.suppression_reason,
      failed_gates: gate.failed_gates,
    };
  }

  return {
    window: input.window,
    total_cost_usd: round2(total),
    any_cost_estimated: anyEstimated,
    accepted_edits: Number(agg.accepted_edits),
    merged_prs: Number(agg.merged_prs),
    sessions: Number(agg.sessions),
    cost_series: series,
    ai_leverage_score,
  };
}

const WINDOW_DAYS: Record<DashboardSummaryInput["window"], number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function buildFixtureSeries(seedKey: string, days: number) {
  const seed = hash(seedKey);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.UTC(2026, 3, 1 + i));
    const noise = lcg(seed + i);
    // Roughly $20–$85/day with gentle oscillation.
    const y = 20 + noise * 30 + Math.sin(i / 1.8) * 15;
    return { x: day.toISOString().slice(0, 10), y: round2(Math.max(4, y)) };
  });
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function lcg(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
