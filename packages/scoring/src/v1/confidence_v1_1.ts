/**
 * `confidence_v1.1` — D48 formula update for the v1.1 reading of
 * `ai_leverage_v1`.
 *
 *   outcomeEvents = |{accepted_hunks ∪ first_push_green ∪ deploy_success}|
 *   activeDays    = unchanged
 *   confidence    = min(1, √(outcomeEvents/10)) · min(1, √(activeDays/10))
 *
 * The v1 reading (only accepted_hunks) continues to live in `./confidence.ts`
 * — it is LOCKED per D13/D21 and MUST NOT CHANGE. Dashboards pinned to `v1`
 * keep calling `computeConfidence(accepted, days)`. Dashboards on `v1.1`
 * call `computeConfidenceV1_1(...)` with the union count.
 *
 * The "union" here is a COUNT union, not a set-membership dedupe — each
 * source is assumed to deliver already-deduped distinct events. Summing is
 * correct under that contract (enforced by the rollup pipeline, not here).
 */

import { computeConfidence } from "./confidence";

export interface OutcomeEventCounts {
  accepted_hunks: number;
  first_push_green: number;
  deploy_success: number;
}

export function outcomeEventsUnion(counts: OutcomeEventCounts): number {
  const a = Math.max(0, counts.accepted_hunks);
  const b = Math.max(0, counts.first_push_green);
  const c = Math.max(0, counts.deploy_success);
  return a + b + c;
}

export function computeConfidenceV1_1(counts: OutcomeEventCounts, active_days: number): number {
  return computeConfidence(outcomeEventsUnion(counts), active_days);
}
