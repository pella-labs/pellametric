/**
 * Cohort normalization — Step 2 of `ai_leverage_v1`.
 *
 * Real implementation (Sprint-2). Winsorize at p5/p95 using Hyndman–Fan
 * Type-7 percentile (linear interpolation — same convention as scipy /
 * numpy default), then percentile-rank the input value within the
 * winsorized cohort.
 *
 *   1. Sort the cohort ascending.
 *   2. Compute p5 and p95 via Type-7 interpolation.
 *   3. Winsorize: clamp every cohort member to [p5, p95].
 *   4. Clamp the input value to [p5, p95] as well.
 *   5. Percentile-rank the clamped value within the winsorized sorted cohort
 *      via Type-7 linear interpolation.
 *
 * Per contract-04: the cohort array for the `autonomy` dimension must be
 * pre-inverted by the caller (lower intervention = higher rank), since
 * `normalizeAgainstCohort` assumes higher-is-better monotonicity.
 */

/**
 * Winsorize a cohort by clamping each value into `[p5, p95]`. Callers
 * usually compute `p5` / `p95` via `percentileValue()`.
 */
export function winsorize(values: number[], p5: number, p95: number): number[] {
  return values.map((v) => Math.max(p5, Math.min(p95, v)));
}

/**
 * Type-7 percentile VALUE — returns the number at percentile `pct` of
 * `sortedAsc` via linear interpolation between adjacent order statistics.
 *
 * For cohort of length `n`: rank = pct/100 × (n-1).
 * Value = sortedAsc[floor(rank)] × (1 - frac) + sortedAsc[ceil(rank)] × frac.
 */
export function percentileValue(sortedAsc: number[], pct: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const first = sortedAsc[0] ?? 0;
  if (n === 1) return first;
  const rank = (pct / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const valLo = sortedAsc[lo] ?? first;
  const valHi = sortedAsc[hi] ?? valLo;
  if (lo === hi) return valLo;
  const frac = rank - lo;
  return valLo * (1 - frac) + valHi * frac;
}

/**
 * Return the percentile RANK of `value` within `cohort` in `[0, 100]`,
 * via Type-7 linear interpolation. Assumes `value` is already clamped
 * into the cohort range if winsorization was desired.
 *
 * Sprint-2 locked definition — matches the 500-case eval fixture expectation.
 */
export function percentileRank(value: number, cohort: number[]): number {
  if (cohort.length === 0) return 50;
  const sorted = [...cohort].sort((a, b) => a - b);
  const n = sorted.length;
  const first = sorted[0] ?? 0;
  const last = sorted[n - 1] ?? first;
  if (value <= first) return 0;
  if (value >= last) return 100;
  for (let i = 0; i < n - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a === undefined || b === undefined) continue;
    if (value >= a && value <= b) {
      const frac = b === a ? 0 : (value - a) / (b - a);
      return ((i + frac) / (n - 1)) * 100;
    }
  }
  return 50;
}

/**
 * Convenience — run Step 2 end-to-end for one scalar against one cohort.
 * Winsorize the cohort at p5/p95, clamp `value` into the same range,
 * then percentile-rank against the winsorized cohort.
 */
export function normalizeAgainstCohort(value: number, cohort: number[]): number {
  if (cohort.length === 0) return 50;
  const sorted = [...cohort].sort((a, b) => a - b);
  const p5 = percentileValue(sorted, 5);
  const p95 = percentileValue(sorted, 95);
  const winsorized = winsorize(sorted, p5, p95);
  const clampedValue = Math.max(p5, Math.min(p95, value));
  return percentileRank(clampedValue, winsorized);
}
