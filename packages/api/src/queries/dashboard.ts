import { assertRole, type Ctx } from "../auth";
import { applyDisplayGate } from "../gates";
import type {
  DashboardSummaryInput,
  DashboardSummaryOutput,
} from "../schemas/dashboard";

/**
 * Top-of-dashboard summary — cost, accepted edits, sessions, AI Leverage Score.
 *
 * Fixture-backed stub: until Jorge's ClickHouse materialized views land
 * (`dev_daily_rollup`, `team_weekly_rollup`), we synthesize a plausible series
 * from a deterministic pseudo-random function so the UI renders end-to-end
 * against the real output shape. Swap the body for a real CH query when the MVs
 * are ready; the signature stays the same.
 */
export async function getSummary(
  ctx: Ctx,
  input: DashboardSummaryInput,
): Promise<DashboardSummaryOutput> {
  assertRole(ctx, ["admin", "manager", "viewer"]);

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
