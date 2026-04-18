/**
 * @bematist/scoring — public API.
 *
 * Pure, deterministic, eval-gated math. Given pre-aggregated event rollups
 * (ClickHouse `dev_daily_rollup` / `team_weekly_rollup` — see
 * `contracts/09-storage-schema.md`), returns `ai_leverage_score` plus the
 * five locked subscores per (engineer, week) or (team, week).
 *
 * The Sprint-1 stub lives in `./v1/index.ts` and intentionally fills every
 * field of `ScoringOutput` so Sebastian's dashboard (Workstream E) can render
 * a tile without errors at M1. The full `ai_leverage_v1` math lands in Sprint 2
 * behind the 500-case MAE ≤ 3 eval gate.
 *
 * @see ../../../contracts/04-scoring-io.md — the authoritative contract.
 * @see ../../../dev-docs/workstreams/h-scoring-prd.md — implementation PRD.
 */

export interface ScoringInput {
  metric_version: "ai_leverage_v1";
  scope: "engineer" | "team";
  scope_id: string;
  cohort_id: string;
  window: { from: string; to: string };

  signals: {
    // Outcome Quality (35%)
    accepted_edits: number;
    accepted_and_retained_edits: number;
    merged_prs: number;
    green_test_runs: number;

    // Efficiency (25%)
    cost_usd: number;
    pricing_version_at_capture: string;
    active_hours: number;
    accepted_edits_per_dollar?: number;

    // Autonomy (20%)
    avg_intervention_rate: number;
    avg_session_depth: number;

    // Adoption Depth (10%)
    distinct_tools_used: number;
    distinct_sources_used: number;
    sessions_count: number;

    // Team Impact (10%) — D31 Promote-to-Playbook
    promoted_playbooks: number;
    promoted_playbook_total_clusters: number;
    playbook_adoption_by_others: number;

    // Confidence inputs
    outcome_events: number;
    active_days: number;
  };

  cohort_distribution: {
    accepted_edits: number[];
    accepted_edits_per_dollar: number[];
    avg_intervention_rate: number[];
    distinct_tools_used: number[];
    promoted_playbooks: number[];
  };
}

export interface ScoringOutput {
  metric_version: "ai_leverage_v1";
  scope: "engineer" | "team";
  scope_id: string;
  window: { from: string; to: string };

  /** Final shipped number, 0..100. */
  ai_leverage_score: number;
  /** Pre-confidence-multiplier value, for transparency. */
  raw_ai_leverage: number;
  /** 0..1; final = raw * confidence. */
  confidence: number;

  subscores: {
    outcome_quality: number;
    efficiency: number;
    autonomy: number;
    adoption_depth: number;
    team_impact: number;
  };

  display: {
    show: boolean;
    suppression_reason?:
      | "insufficient_sessions"
      | "insufficient_active_days"
      | "insufficient_outcome_events"
      | "insufficient_cohort"
      | "k_anonymity_floor";
    failed_gates: string[];
    /** Additive per h-scoring-prd §6 / G3-a — small-team (cohort<8) fallback. */
    raw_subscores_available: boolean;
    raw_subscores?: {
      outcome_quality_raw: number;
      efficiency_raw: number;
      autonomy_raw: number;
      adoption_depth_raw: number;
      team_impact_raw: number;
    };
  };

  /** Banner signal per D21 — pricing-version shifts must be surfaced, not recomputed. */
  pricing_version_drift: boolean;

  /** Audit trail — sha256 of canonical ScoringInput. */
  inputs_hash: string;
}

export {
  type ClusterKStats,
  cosineSimilarity,
  type FindTwinsError,
  type FindTwinsOpts,
  type FindTwinsOutcome,
  findTwins,
  type TwinFinderResult,
  type TwinSessionCandidate,
} from "./twinFinder";
export { score } from "./v1/index";
