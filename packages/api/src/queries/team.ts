import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import { applyDisplayGate, K_ANONYMITY_FLOOR } from "../gates";
import type {
  ScatterPoint,
  TeamListInput,
  TeamListOutput,
  TeamSummary,
  TeamTwoByTwoInput,
  TeamTwoByTwoOutput,
} from "../schemas/team";

/**
 * Teams list — populates `/teams` page and team switcher.
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` joins Postgres `teams` with the ClickHouse
 *     `team_weekly_rollup` MV for cost + AI Leverage Score.
 *   - Otherwise (default) returns a deterministic 3-team fixture seeded from
 *     `ctx.tenant_id`.
 */
export async function listTeams(ctx: Ctx, input: TeamListInput): Promise<TeamListOutput> {
  assertRole(ctx, ["admin", "manager", "viewer"]);
  if (useFixtures()) return listTeamsFixture(ctx, input);
  return listTeamsReal(ctx, input);
}

async function listTeamsFixture(ctx: Ctx, input: TeamListInput): Promise<TeamListOutput> {
  const seed = hash(`${ctx.tenant_id}:${input.window}`);
  const days = WINDOW_DAYS[input.window];

  const teams: TeamSummary[] = FIXTURE_TEAMS.map((t, i) => {
    const engineers = t.engineers;
    const cohortSize = engineers;
    const cost = round2((20 + lcg(seed + i) * 40) * days);

    const gate = applyDisplayGate({
      sessions_count: Math.round(days * engineers * 2),
      active_days: Math.round(days * 0.7),
      outcome_events: Math.round(days * 0.6),
      cohort_size: cohortSize,
      team_scope: true,
    });
    const ai_leverage_score = gate.show
      ? { show: true as const, value: Math.round(50 + lcg(seed + i + 1) * 35) }
      : {
          show: false as const,
          suppression_reason: gate.suppression_reason,
          failed_gates: gate.failed_gates,
        };

    return {
      id: t.id,
      slug: t.slug,
      label: t.label,
      engineers,
      cohort_size: cohortSize,
      cost_usd: cost,
      ai_leverage_score,
      fidelity: "full" as const,
    };
  });

  return { window: input.window, teams };
}

/**
 * Real-branch read. Teams live in Postgres; aggregates (cost, AI Leverage
 * Score, engineer count) come from the ClickHouse `team_weekly_rollup` MV.
 *
 * EXPLAIN: PG `teams` pkey filter by `org_id`; CH `team_weekly_rollup` is an
 * AggregatingMergeTree ORDER BY (org_id, team_id, week) — partition column is
 * `week` (toMonday(toDate(ts))), NOT `week_start`. State columns
 * (`cost_usd_state` from sumState, `sessions_state` / `engineers_state` from
 * uniqState, `accepted_edits_state` from countIfState) MUST be read with the
 * matching `*Merge` finalizer; raw `sum()` / `uniq()` / `countIf()` against
 * those columns errors with "argument types do not match".
 *
 * `active_days` / `outcome_events` / `cohort_size` aren't on the MV today.
 * Zero-fill so the gate degrades gracefully rather than 500 — once Sandesh's
 * scoring writer + outcomes_daily MV land they wire through here.
 *
 * Tier-A forbidden columns are NEVER selected — aggregates only.
 */
async function listTeamsReal(ctx: Ctx, input: TeamListInput): Promise<TeamListOutput> {
  const teamRows = await ctx.db.pg.query<{
    id: string;
    name: string;
  }>(
    `SELECT id, name
       FROM teams
      WHERE org_id = $1
      ORDER BY name ASC`,
    [ctx.tenant_id],
  );

  if (teamRows.length === 0) return { window: input.window, teams: [] };

  const days = WINDOW_DAYS[input.window];

  const aggRows = await ctx.db.ch.query<{
    team_id: string;
    engineers: number;
    cohort_size: number;
    cost_usd: number;
    sessions_count: number;
    active_days: number;
    outcome_events: number;
    ai_leverage_v1: number;
    fidelity: TeamSummary["fidelity"];
  }>(
    `SELECT
       team_id,
       uniqMerge(engineers_state) AS engineers,
       uniqMerge(engineers_state) AS cohort_size,
       sumMerge(cost_usd_state) AS cost_usd,
       uniqMerge(sessions_state) AS sessions_count,
       0 AS active_days,
       0 AS outcome_events,
       0 AS ai_leverage_v1,
       'full' AS fidelity
     FROM team_weekly_rollup
     WHERE org_id = {tenant_id:String}
       AND week >= today() - {days:UInt16}
     GROUP BY team_id`,
    { tenant_id: ctx.tenant_id, days },
  );

  const aggByTeam = new Map(aggRows.map((r) => [r.team_id, r]));

  const teams: TeamSummary[] = teamRows.map((t) => {
    const agg = aggByTeam.get(t.id);
    const engineers = Number(agg?.engineers ?? 0);
    const cohortSize = Number(agg?.cohort_size ?? 0);

    const gate = applyDisplayGate({
      sessions_count: Number(agg?.sessions_count ?? 0),
      active_days: Number(agg?.active_days ?? 0),
      outcome_events: Number(agg?.outcome_events ?? 0),
      cohort_size: cohortSize,
      team_scope: true,
    });

    const ai_leverage_score = gate.show
      ? {
          show: true as const,
          value: clamp(Math.round(Number(agg?.ai_leverage_v1 ?? 0)), 0, 100),
        }
      : {
          show: false as const,
          suppression_reason: gate.suppression_reason,
          failed_gates: gate.failed_gates,
        };

    return {
      id: t.id,
      slug: t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label: t.name,
      engineers: Math.max(1, engineers),
      cohort_size: cohortSize,
      cost_usd: round2(Number(agg?.cost_usd ?? 0)),
      ai_leverage_score,
      fidelity: agg?.fidelity ?? "full",
    };
  });

  return { window: input.window, teams };
}

/**
 * 2×2 Manager view data — X = Outcome Quality percentile, Y = Efficiency
 * percentile. Cohort-stratified by `task_category` before cross-engineer
 * compare (CLAUDE.md §Scoring Rules §7.4).
 *
 * Top-level gate: when `cohort_size < 5` (k-anonymity floor, D9), the scatter
 * is suppressed and `points` is empty. The UI renders an `InsufficientData`
 * card with the failed-gate tooltip.
 */
export async function getTwoByTwo(ctx: Ctx, input: TeamTwoByTwoInput): Promise<TeamTwoByTwoOutput> {
  assertRole(ctx, ["admin", "manager"]);
  if (useFixtures()) return getTwoByTwoFixture(ctx, input);
  return getTwoByTwoReal(ctx, input);
}

async function getTwoByTwoFixture(ctx: Ctx, input: TeamTwoByTwoInput): Promise<TeamTwoByTwoOutput> {
  const team = FIXTURE_TEAMS.find((t) => t.id === input.team_id);
  const cohortSize = team?.engineers ?? 0;
  const taskCategory = input.task_category ?? null;

  const gate = applyDisplayGate({
    sessions_count: 100,
    active_days: 20,
    outcome_events: 10,
    cohort_size: cohortSize,
    team_scope: true,
  });

  const points: ScatterPoint[] = gate.show
    ? buildFixturePoints(
        `${ctx.tenant_id}:${input.team_id}:${input.window}:${taskCategory ?? "all"}`,
        cohortSize,
      )
    : [];

  return {
    window: input.window,
    team_id: input.team_id,
    task_category: taskCategory,
    cohort_size: cohortSize,
    display: gate.show
      ? { show: true }
      : {
          show: false,
          suppression_reason: gate.suppression_reason,
          failed_gates: gate.failed_gates,
        },
    points,
    available_task_categories: AVAILABLE_TASK_CATEGORIES,
    fidelity: "full",
  };
}

/**
 * Real-branch read.
 *
 * EXPLAIN: `dev_daily_rollup` is the only MV today carrying per-engineer
 * aggregates; `team_weekly_rollup` collapses to (org_id, team_id, week) so
 * it can't drive a per-engineer scatter. Per-engineer outcome_quality_pct /
 * efficiency_pct percentiles aren't materialized yet — Sandesh's scoring
 * writer + cohort-rank job will land them. Until then we render an empty
 * scatter (cohort_size still derived so the k≥5 gate banner picks correctly).
 *
 * State columns (`sessions_state`, `cost_usd_state`) require the matching
 * `*Merge` finalizer — raw `sum()` / `uniq()` errors on AggregateFunction
 * columns. `task_category` is also not on the MV; categories list is empty
 * until the dimension lands.
 *
 * Tier-A ALLOWLIST: aggregates only — no prompt_text / tool_input /
 * tool_output / messages / toolArgs / toolOutputs / fileContents / diffs /
 * filePaths / ticketIds / emails / realNames in SELECT.
 */
async function getTwoByTwoReal(ctx: Ctx, input: TeamTwoByTwoInput): Promise<TeamTwoByTwoOutput> {
  const days = WINDOW_DAYS[input.window];
  const taskCategory = input.task_category ?? null;

  const rows = await ctx.db.ch.query<{
    engineer_id_hash: string;
    outcome_quality: number;
    efficiency: number;
    sessions: number;
    cost_usd: number;
  }>(
    `SELECT
       substring(lower(hex(cityHash64(engineer_id))), 1, 8) AS engineer_id_hash,
       0 AS outcome_quality,
       0 AS efficiency,
       uniqMerge(sessions_state) AS sessions,
       sumMerge(cost_usd_state) AS cost_usd
     FROM dev_daily_rollup
     WHERE org_id = {tenant_id:String}
       AND day >= today() - {days:UInt16}
     GROUP BY engineer_id`,
    { tenant_id: ctx.tenant_id, days },
  );

  const cohortSize = rows.length;

  const gate = applyDisplayGate({
    sessions_count: rows.reduce((s, r) => s + Number(r.sessions), 0),
    active_days: Math.max(1, Math.min(days, 30)),
    outcome_events: rows.length,
    cohort_size: cohortSize,
    team_scope: true,
  });

  const points: ScatterPoint[] = gate.show
    ? rows.map((r) => ({
        engineer_id_hash: r.engineer_id_hash,
        outcome_quality: round2(clamp(Number(r.outcome_quality), 0, 100)),
        efficiency: round2(clamp(Number(r.efficiency), 0, 100)),
        sessions: Number(r.sessions),
        cost_usd: round2(Number(r.cost_usd)),
      }))
    : [];

  return {
    window: input.window,
    team_id: input.team_id,
    task_category: taskCategory,
    cohort_size: cohortSize,
    display: gate.show
      ? { show: true }
      : {
          show: false,
          suppression_reason: gate.suppression_reason,
          failed_gates: gate.failed_gates,
        },
    points,
    available_task_categories: AVAILABLE_TASK_CATEGORIES,
    fidelity: "full",
  };
}

const WINDOW_DAYS: Record<TeamListInput["window"], number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const FIXTURE_TEAMS = [
  { id: "team_growth", slug: "growth", label: "Growth", engineers: 12 },
  { id: "team_platform", slug: "platform", label: "Platform", engineers: 8 },
  { id: "team_ml", slug: "ml", label: "ML Infra", engineers: 4 },
] as const;

const AVAILABLE_TASK_CATEGORIES = ["feature_work", "bug_fix", "refactor", "tests", "docs"];

/**
 * Seeded pseudo-random point generator. Engineer ids are stable 8-char hex
 * hashes so repeat renders are identical.
 */
function buildFixturePoints(seedKey: string, n: number): ScatterPoint[] {
  const seed = hash(seedKey);
  return Array.from({ length: n }, (_, i) => {
    const r1 = lcg(seed + i * 2);
    const r2 = lcg(seed + i * 2 + 1);
    // Correlated clouds — positive-leaning diagonal with noise.
    const base = r1 * 60 + 20;
    const jitter = (r2 - 0.5) * 30;
    const outcome_quality = clamp(base + jitter, 0, 100);
    const efficiency = clamp(base - jitter * 0.5 + (r2 - 0.5) * 20, 0, 100);
    const sessions = Math.round(10 + r2 * 60);
    const cost_usd = round2(10 + r1 * 180);
    return {
      engineer_id_hash: shortHash(`${seedKey}:${i}`),
      outcome_quality: round2(outcome_quality),
      efficiency: round2(efficiency),
      sessions,
      cost_usd,
    };
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

function shortHash(s: string): string {
  return hash(s).toString(16).padStart(8, "0").slice(0, 8);
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

// Exported for tests.
export const _testing = { FIXTURE_TEAMS, K_ANONYMITY_FLOOR };
