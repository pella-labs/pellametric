/**
 * `ai_leverage_v1.1` scorer — additive overlay on top of the LOCKED
 * `ai_leverage_v1` math. Per PRD-github-integration §12, v1.1:
 *
 *   - REPLACES the outcome_quality subscore with `outcome_quality_v1.1`
 *     (3-term composition + D41 suppression renormalization).
 *   - UPDATES confidence to count the union of outcome-event sources
 *     (D48) when the caller supplies GitHub counts.
 *   - ACCEPTS a cohort resolver (D42) at step-2 normalization. Defaults
 *     to task-only if not supplied (= v1 behavior).
 *
 * `ai_leverage_v1` step-2/3/weights are UNCHANGED. v1 LOCKED.
 *
 * Callers:
 *   - Dashboards pinned to `v1` → continue using `score()` from `./index`.
 *   - Dashboards on `v1.1` → use `scoreV1_1()` from this module.
 *
 * The v1.1 scorer is pure. No I/O. Deterministic for identical input.
 */

import { createHash } from "node:crypto";
import type { ScoringInput, ScoringOutput } from "../index";
import { composite } from "./composite";
import { computeConfidenceV1_1 } from "./confidence_v1_1";
import { evaluateDisplayGates } from "./display_gates";
import { normalizeAgainstCohort } from "./normalize";
import {
  computeOutcomeQualityV1_1,
  deploySuccessPerDollarV1Stub,
  type Term,
} from "./outcome_quality_v1_1";
import { computeRawSubscores } from "./subscores";

/**
 * Extension over v1 `ScoringInput` with the v1.1-specific GitHub signal
 * values. Each sub-input is an already-percentile-ranked scalar on [0,100]
 * plus a `suppressed` flag. The caller is responsible for running the
 * raw→winsorize→percentile pipeline upstream (it needs the live cohort
 * distribution which is provider-specific).
 */
export interface ScoringInputV1_1 extends ScoringInput {
  github: {
    first_push_green: Term;
    /** G2: always {suppressed: true}; G3 replaces with real module. */
    deploy_success_per_dollar: Term;
    /** D48 inputs — outcome event counts per source. */
    outcome_event_counts: {
      accepted_hunks: number;
      first_push_green: number;
      deploy_success: number;
    };
  };
}

function sha256OfInput(input: ScoringInputV1_1): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function scoreV1_1(input: ScoringInputV1_1): ScoringOutput & {
  metric_version_overlay: "ai_leverage_v1.1";
} {
  if (input.metric_version !== "ai_leverage_v1") {
    throw new Error(`Unknown metric_version: ${input.metric_version as string}`);
  }

  const { signals, cohort_distribution } = input;

  // Step 1 — raw subscores per v1 (locked).
  const raw = computeRawSubscores(signals);

  // Step 2 — cohort-normalize per v1 (locked). v1.1 adds the GitHub
  // outcome terms downstream — they're already cohort-ranked at call time
  // by the caller (they have repo-specific cohort slices).
  const invertedInterventionCohort = cohort_distribution.avg_intervention_rate.map(
    (r) => 1 - Math.max(0, Math.min(1, r)),
  );

  const useful_output_retained_v1 = normalizeAgainstCohort(
    raw.outcome_quality,
    cohort_distribution.accepted_edits,
  );
  const efficiency = normalizeAgainstCohort(
    raw.efficiency,
    cohort_distribution.accepted_edits_per_dollar,
  );
  const autonomy = normalizeAgainstCohort(raw.autonomy, invertedInterventionCohort);
  const adoption_depth = normalizeAgainstCohort(
    raw.adoption_depth,
    cohort_distribution.distinct_tools_used,
  );
  const team_impact = normalizeAgainstCohort(
    raw.team_impact,
    cohort_distribution.promoted_playbooks,
  );

  // outcome_quality_v1.1 composition.
  const oq = computeOutcomeQualityV1_1({
    useful_output_retained: { value: useful_output_retained_v1, suppressed: false },
    first_push_green: input.github.first_push_green,
    deploy_success_per_dollar: input.github.deploy_success_per_dollar,
  });

  const normalized = {
    outcome_quality: oq.value,
    efficiency,
    autonomy,
    adoption_depth,
    team_impact,
  };

  // Step 3 — weighted composite (v1 weights LOCKED).
  const rawALS = composite(normalized);

  // Step 4 — confidence (v1.1 D48 union).
  const confidence = computeConfidenceV1_1(input.github.outcome_event_counts, signals.active_days);

  // Step 5 — final.
  const finalALS = rawALS * confidence;

  const displayDecision = evaluateDisplayGates(input);

  const display: ScoringOutput["display"] = {
    show: displayDecision.show,
    failed_gates: displayDecision.failed_gates,
    raw_subscores_available: displayDecision.raw_subscores_available,
  };
  if (displayDecision.suppression_reason !== undefined) {
    display.suppression_reason = displayDecision.suppression_reason;
  }

  return {
    metric_version: "ai_leverage_v1",
    metric_version_overlay: "ai_leverage_v1.1",
    scope: input.scope,
    scope_id: input.scope_id,
    window: input.window,
    ai_leverage_score: finalALS,
    raw_ai_leverage: rawALS,
    confidence,
    subscores: {
      outcome_quality: normalized.outcome_quality,
      efficiency: normalized.efficiency,
      autonomy: normalized.autonomy,
      adoption_depth: normalized.adoption_depth,
      team_impact: normalized.team_impact,
    },
    display,
    pricing_version_drift: false,
    inputs_hash: sha256OfInput(input),
  };
}

export { deploySuccessPerDollarV1Stub };
