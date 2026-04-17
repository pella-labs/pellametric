/**
 * Step 1 of `ai_leverage_v1` — raw subscores from primary signals.
 *
 * Returns ONE primary-signal value per dimension (not a composite). The
 * chosen primary signal per dimension matches what `cohort_distribution`
 * provides in the contract (04-scoring-io.md), so Step 2's percentile-rank
 * is apples-to-apples.
 *
 *   Outcome Quality  ← accepted_and_retained_edits   (D12 rule 5 — revert penalty)
 *   Efficiency       ← retained / cost_usd           (D12 rule 4 — local fallback)
 *                      OR retained / active_hours    (if cost_usd = 0)
 *                      OR 0                          (if both 0)
 *   Autonomy         ← 1 - avg_intervention_rate     (INVERTED — lower = better)
 *   Adoption Depth   ← distinct_tools_used
 *   Team Impact      ← promoted_playbooks + capped_adoption/10  (D31)
 *
 * No `∞`, no `NaN` — cost_usd=0 falls through to the active_hours branch;
 * both-zero falls through to 0. All branches exercised by property tests.
 */

import type { ScoringInput } from "../index";

export interface RawSubscores {
  outcome_quality: number;
  efficiency: number;
  autonomy: number;
  adoption_depth: number;
  team_impact: number;
}

export function computeRawSubscores(signals: ScoringInput["signals"]): RawSubscores {
  // Outcome Quality — revert-penalized edit count (D12 rule 5).
  const outcome_quality = Math.max(0, signals.accepted_and_retained_edits);

  // Efficiency — retained edits per dollar, with local-model fallback.
  let efficiency: number;
  if (signals.cost_usd > 0) {
    efficiency = signals.accepted_and_retained_edits / signals.cost_usd;
  } else if (signals.active_hours > 0) {
    efficiency = signals.accepted_and_retained_edits / signals.active_hours;
  } else {
    efficiency = 0;
  }

  // Autonomy — invert intervention rate (clamped to [0,1]).
  const interventionRate = Math.max(0, Math.min(1, signals.avg_intervention_rate));
  const autonomy = 1 - interventionRate;

  // Adoption Depth — distinct tools used.
  const adoption_depth = Math.max(0, signals.distinct_tools_used);

  // Team Impact — promoted playbooks + capped adoption-by-others (D31 cap at 10).
  const adoptionCapped = Math.min(10, Math.max(0, signals.playbook_adoption_by_others));
  const team_impact = Math.max(0, signals.promoted_playbooks) + adoptionCapped / 10;

  return {
    outcome_quality,
    efficiency,
    autonomy,
    adoption_depth,
    team_impact,
  };
}
