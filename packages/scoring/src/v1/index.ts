/**
 * `ai_leverage_v1` entry — Sprint-2 real math.
 *
 * Runs the five locked steps per CLAUDE.md §"Scoring Rules":
 *   1. Raw subscores from primary signals — `subscores.ts`.
 *   2. Cohort-normalize (winsorize p5/p95 + Type-7 percentile) — `normalize.ts`.
 *   3. Weighted composite (0.35/0.25/0.20/0.10/0.10) — `composite.ts`.
 *   4. Confidence `√(events/10) · √(days/10)` capped at 1 — `confidence.ts`.
 *   5. Final ALS = raw · confidence.
 *
 * Display gates applied via `display_gates.ts` — a tile renders only when
 * all four gates pass (sessions, active days, outcome events, cohort size).
 *
 * Pure: same input → same output. No Date.now, no random, no I/O.
 * Guaranteed no `NaN`, no `Infinity` — property test enforces.
 */

import { createHash } from "node:crypto";
import type { ScoringInput, ScoringOutput } from "../index";
import { composite } from "./composite";
import { computeConfidence } from "./confidence";
import { evaluateDisplayGates } from "./display_gates";
import { normalizeAgainstCohort } from "./normalize";
import { computeRawSubscores } from "./subscores";

function sha256OfInput(input: ScoringInput): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function score(input: ScoringInput): ScoringOutput {
  if (input.metric_version !== "ai_leverage_v1") {
    throw new Error(`Unknown metric_version: ${input.metric_version as string}`);
  }

  const { signals, cohort_distribution } = input;

  // Step 1 — raw subscores (primary signals per dimension).
  const raw = computeRawSubscores(signals);

  // Step 2 — cohort-normalize each dimension against its paired cohort array.
  // Autonomy: invert the cohort (lower intervention_rate = higher autonomy rank).
  const invertedInterventionCohort = cohort_distribution.avg_intervention_rate.map(
    (r) => 1 - Math.max(0, Math.min(1, r)),
  );

  const normalized = {
    outcome_quality: normalizeAgainstCohort(
      raw.outcome_quality,
      cohort_distribution.accepted_edits,
    ),
    efficiency: normalizeAgainstCohort(
      raw.efficiency,
      cohort_distribution.accepted_edits_per_dollar,
    ),
    autonomy: normalizeAgainstCohort(raw.autonomy, invertedInterventionCohort),
    adoption_depth: normalizeAgainstCohort(
      raw.adoption_depth,
      cohort_distribution.distinct_tools_used,
    ),
    team_impact: normalizeAgainstCohort(raw.team_impact, cohort_distribution.promoted_playbooks),
  };

  // Step 3 — weighted composite (returns 0..100).
  const rawALS = composite(normalized);

  // Step 4 — confidence multiplier (0..1).
  const confidence = computeConfidence(signals.outcome_events, signals.active_days);

  // Step 5 — final.
  const finalALS = rawALS * confidence;

  // Display gates.
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
