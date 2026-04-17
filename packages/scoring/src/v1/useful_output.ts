/**
 * `useful_output_v1 = accepted_code_edits_per_dollar` — Sprint-1 stub.
 *
 * Per D12 and PRD §7.2, the full implementation honors SIX locked rules. This
 * Sprint-1 version implements only the naive ratio and the `cost_usd = 0`
 * local-model fallback (rule 4). The remaining five rules land in Sprint 2
 * alongside the 500-case eval fixture that exercises them.
 *
 * TODO(Sprint-2) — LOCKED RULES still to implement:
 *   1. Dedup unit `(session_id, hunk_sha256)` — dedup at input-aggregation
 *      time (Jorge's MV), scoring just reads the deduped totals.
 *   2. Denominator window is same `session_id`. Cross-session is `_v2`
 *      territory — NEVER back-port into v1.
 *   3. Unit is USD at `pricing_version_at_capture`. Pricing-version mismatch
 *      across window sets `pricing_version_drift = true`; NEVER silently
 *      recompute.
 *   4. (this file) Local-model fallback — `cost_usd = 0` → suppress
 *      `accepted_edits_per_dollar`, feed `accepted_edits_per_active_hour`
 *      into efficiency instead. NO `∞`, NO `NaN`.
 *   5. Revert penalty — hunks reverted within 24h subtracted from numerator;
 *      companion metric `accepted_and_retained_edits_per_dollar`.
 *   6. Noise floor — sessions with `accepted_edits < 3` excluded entirely.
 */

export interface UsefulOutputSignals {
  accepted_edits: number;
  cost_usd: number;
  active_hours: number;
}

export interface UsefulOutput {
  /** `accepted_edits / cost_usd` when `cost_usd > 0`; otherwise null. */
  accepted_edits_per_dollar: number | null;
  /** Fallback metric when `cost_usd = 0` — per D12 Rule 4. */
  accepted_edits_per_active_hour: number | null;
  /** True when the local-model fallback path was taken. */
  local_model_fallback: boolean;
}

export function computeUsefulOutput(signals: UsefulOutputSignals): UsefulOutput {
  if (signals.cost_usd > 0) {
    return {
      accepted_edits_per_dollar: signals.accepted_edits / signals.cost_usd,
      accepted_edits_per_active_hour: null,
      local_model_fallback: false,
    };
  }

  // Local-model fallback — D12 Rule 4. No ∞, no NaN.
  const perHour = signals.active_hours > 0 ? signals.accepted_edits / signals.active_hours : null;
  return {
    accepted_edits_per_dollar: null,
    accepted_edits_per_active_hour: perHour,
    local_model_fallback: true,
  };
}
