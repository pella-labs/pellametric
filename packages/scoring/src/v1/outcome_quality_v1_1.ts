/**
 * `outcome_quality_v1.1` — CORE subscore composition (PRD-github-integration §12.2, D41).
 *
 * Replaces the v1 single-term outcome_quality (raw accepted_and_retained
 * count) with a three-term weighted sum once GitHub signals are available:
 *
 *   outcome_quality_v1.1 =
 *       0.60 · useful_output_retained_v1
 *     + 0.25 · first_push_green_rate_v1
 *     + 0.15 · deploy_success_per_dollar_v1
 *
 * Per-term inputs are assumed already raw→winsorize p5/p95→percentile-rank
 * (done upstream by `normalizeAgainstCohort`).
 *
 * **Suppression rule (D41)** — when a term has insufficient signal its
 * weight redistributes proportionally across SURVIVING terms. NEVER
 * default-to-zero: a no-deploy repo is not penalized to zero on the
 * deploy axis; instead the other terms absorb the weight. This keeps the
 * composite on the same [0, 100] scale regardless of which terms are
 * present.
 *
 * **Version pin (D13):** the re-normalization rule is part of v1.1. Any
 * change to suppression behavior must bump to v1.2 — do NOT silently
 * redefine what a v1.1 dashboard number means.
 *
 * G2 wires `deploy_success_per_dollar` to a stub that always flags
 * `suppressed: true` — the real module lands in G3. Tests exercise the
 * "deploy suppressed" path explicitly; when G3 lands the composition
 * starts accepting a live deploy value with no v1.1 re-version required.
 *
 * Pure: deterministic for identical input. No I/O.
 */

export interface Term {
  /** Percentile-ranked value on [0, 100]; meaningful only when `suppressed=false`. */
  value: number;
  suppressed: boolean;
}

export interface OutcomeQualityV1_1Inputs {
  useful_output_retained: Term;
  first_push_green: Term;
  deploy_success_per_dollar: Term;
}

export const OUTCOME_QUALITY_V1_1_WEIGHTS = {
  useful_output_retained: 0.6,
  first_push_green: 0.25,
  deploy_success_per_dollar: 0.15,
} as const;

export type TermName = keyof OutcomeQualityV1_1Inputs;

export interface OutcomeQualityV1_1Result {
  value: number;
  suppressed: boolean;
  surviving_terms: TermName[];
  effective_weights: Record<TermName, number>;
}

export function computeOutcomeQualityV1_1(
  inputs: OutcomeQualityV1_1Inputs,
): OutcomeQualityV1_1Result {
  const terms: TermName[] = [
    "useful_output_retained",
    "first_push_green",
    "deploy_success_per_dollar",
  ];

  const survivors = terms.filter((t) => !inputs[t].suppressed);
  const effective_weights: Record<TermName, number> = {
    useful_output_retained: 0,
    first_push_green: 0,
    deploy_success_per_dollar: 0,
  };

  if (survivors.length === 0) {
    return {
      value: 0,
      suppressed: true,
      surviving_terms: [],
      effective_weights,
    };
  }

  // Sum the base weights of surviving terms.
  const baseSum = survivors.reduce((s, t) => s + OUTCOME_QUALITY_V1_1_WEIGHTS[t], 0);

  let value = 0;
  for (const t of survivors) {
    const w = OUTCOME_QUALITY_V1_1_WEIGHTS[t] / baseSum;
    effective_weights[t] = w;
    value += w * inputs[t].value;
  }

  return {
    value,
    suppressed: false,
    surviving_terms: survivors,
    effective_weights,
  };
}

/**
 * G3 deploy term resolver — live by default, suppressed when the caller
 * passes `null` (module-not-wired or absent-signal fallback). The G3 live
 * pipeline supplies a pre-normalized percentile-ranked value on [0, 100]
 * OR a suppressed marker; a non-finite number is treated as suppressed.
 *
 * Kept as a named export (`deploySuccessPerDollarV1Stub`) for G2 callers
 * that imported it before G3 landed — same shape, same meaning. The stub
 * retains its "always suppressed" default so old call sites keep working.
 */
export function deploySuccessPerDollarV1Stub(): Term {
  return {
    value: 0,
    suppressed: true,
  };
}

/**
 * G3: convert a live `computeDeployPerDollar` raw result + its cohort's
 * percentile-rank pipeline into the `Term` shape consumed by v1.1.
 *
 * Callers are expected to run the raw→winsorize p5/p95→percentile-rank
 * pipeline themselves (the cohort lives server-side and is org-specific).
 * This helper just closes the shape.
 */
export function deploySuccessPerDollarV1FromPercentile(percentile_rank_0_100: number | null): Term {
  if (percentile_rank_0_100 === null || !Number.isFinite(percentile_rank_0_100)) {
    return { value: 0, suppressed: true };
  }
  return { value: percentile_rank_0_100, suppressed: false };
}
