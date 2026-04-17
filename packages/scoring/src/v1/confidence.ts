/**
 * Confidence multiplier — Step 4 of `ai_leverage_v1` (locked).
 *
 *   confidence = min(1, √(outcome_events / 10)) · min(1, √(active_days / 10))
 *
 * Per PRD §7.1 and h-scoring-prd §7 Step 4. Monotonic non-decreasing in both
 * inputs. Capped at 1.0. Negative inputs are clamped to 0 (defensive — callers
 * should never pass negatives, but we never emit `NaN`).
 */

export function computeConfidence(outcome_events: number, active_days: number): number {
  const e = Math.max(0, outcome_events);
  const d = Math.max(0, active_days);
  const eventsFactor = Math.min(1, Math.sqrt(e / 10));
  const daysFactor = Math.min(1, Math.sqrt(d / 10));
  return eventsFactor * daysFactor;
}
