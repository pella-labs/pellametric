/**
 * Weighted composite — Step 3 of `ai_leverage_v1`.
 *
 * Weights are locked per D11 / PRD §7.1: Outcome 0.35 · Efficiency 0.25 ·
 * Autonomy 0.20 · Adoption 0.10 · Team Impact 0.10. Weights sum to 1.0.
 * Any reweight requires bumping to `_v2`.
 */

export interface CompositeInputs {
  outcome_quality: number;
  efficiency: number;
  autonomy: number;
  adoption_depth: number;
  team_impact: number;
}

export const WEIGHTS = {
  outcome_quality: 0.35,
  efficiency: 0.25,
  autonomy: 0.2,
  adoption_depth: 0.1,
  team_impact: 0.1,
} as const;

export function composite(inputs: CompositeInputs): number {
  return (
    WEIGHTS.outcome_quality * inputs.outcome_quality +
    WEIGHTS.efficiency * inputs.efficiency +
    WEIGHTS.autonomy * inputs.autonomy +
    WEIGHTS.adoption_depth * inputs.adoption_depth +
    WEIGHTS.team_impact * inputs.team_impact
  );
}
