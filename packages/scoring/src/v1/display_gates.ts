/**
 * Display gates — h-scoring-prd §9.
 *
 * A tile renders a number only when all four hold:
 *   - `sessions_count ≥ 10`
 *   - `active_days ≥ 5`
 *   - `outcome_events ≥ 3`
 *   - every `cohort_distribution[*].length ≥ 8`
 *
 * Below any threshold → `show = false`, `suppression_reason` set,
 * `failed_gates` enumerates which gate(s) failed. Never approximated.
 *
 * TODO(Sprint-2): team-scope k-anonymity floor `k ≥ 5` lives in Sprint 2
 * once `ScoringInput` exposes team-size context (cohort_distribution alone
 * doesn't distinguish k-floor from cohort-floor). R1 small-team fallback —
 * `raw_subscores_available = true` with raw pre-normalization values — also
 * Sprint 2.
 */

import type { ScoringInput, ScoringOutput } from "../index";

export const GATE_MIN_SESSIONS = 10;
export const GATE_MIN_ACTIVE_DAYS = 5;
export const GATE_MIN_OUTCOME_EVENTS = 3;
export const GATE_MIN_COHORT = 8;

export interface DisplayDecision {
  show: boolean;
  suppression_reason?: NonNullable<ScoringOutput["display"]["suppression_reason"]>;
  failed_gates: string[];
  raw_subscores_available: boolean;
}

export function evaluateDisplayGates(input: ScoringInput): DisplayDecision {
  if (process.env.BEMATIST_SINGLE_TRUST_DOMAIN === "1") {
    return { show: true, failed_gates: [], raw_subscores_available: true };
  }

  const failed_gates: string[] = [];
  let suppression_reason: DisplayDecision["suppression_reason"];

  const { signals, cohort_distribution } = input;

  if (signals.sessions_count < GATE_MIN_SESSIONS) {
    failed_gates.push("sessions_count");
    suppression_reason ??= "insufficient_sessions";
  }
  if (signals.active_days < GATE_MIN_ACTIVE_DAYS) {
    failed_gates.push("active_days");
    suppression_reason ??= "insufficient_active_days";
  }
  if (signals.outcome_events < GATE_MIN_OUTCOME_EVENTS) {
    failed_gates.push("outcome_events");
    suppression_reason ??= "insufficient_outcome_events";
  }

  const cohortLengths = [
    cohort_distribution.accepted_edits.length,
    cohort_distribution.accepted_edits_per_dollar.length,
    cohort_distribution.avg_intervention_rate.length,
    cohort_distribution.distinct_tools_used.length,
    cohort_distribution.promoted_playbooks.length,
  ];
  const minCohort = Math.min(...cohortLengths);
  if (minCohort < GATE_MIN_COHORT) {
    failed_gates.push("cohort");
    suppression_reason ??= "insufficient_cohort";
  }

  const show = failed_gates.length === 0;
  const decision: DisplayDecision = {
    show,
    failed_gates,
    raw_subscores_available: false,
  };
  if (suppression_reason !== undefined) {
    decision.suppression_reason = suppression_reason;
  }
  return decision;
}
