import { assertRole, type Ctx } from "../auth";
import { K_ANONYMITY_FLOOR, applyDisplayGate } from "../gates";
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
 * Fixture-backed: returns a deterministic 3-team set seeded from
 * `ctx.tenant_id`. Swap for ClickHouse + Postgres join when Jorge's
 * `team_weekly_rollup` MV lands; signature stays stable.
 */
export async function listTeams(
  ctx: Ctx,
  input: TeamListInput,
): Promise<TeamListOutput> {
  assertRole(ctx, ["admin", "manager", "viewer"]);

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
 * 2×2 Manager view data — X = Outcome Quality percentile, Y = Efficiency
 * percentile. Cohort-stratified by `task_category` before cross-engineer
 * compare (CLAUDE.md §Scoring Rules §7.4).
 *
 * Top-level gate: when `cohort_size < 5` (k-anonymity floor, D9), the scatter
 * is suppressed and `points` is empty. The UI renders an `InsufficientData`
 * card with the failed-gate tooltip.
 */
export async function getTwoByTwo(
  ctx: Ctx,
  input: TeamTwoByTwoInput,
): Promise<TeamTwoByTwoOutput> {
  assertRole(ctx, ["admin", "manager"]);

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
    ? buildFixturePoints(`${ctx.tenant_id}:${input.team_id}:${input.window}:${taskCategory ?? "all"}`, cohortSize)
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

const AVAILABLE_TASK_CATEGORIES = [
  "feature_work",
  "bug_fix",
  "refactor",
  "tests",
  "docs",
];

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
