/**
 * G2 — `outcome_quality_v1.1` composition + D41 suppression renormalization (RED first).
 *
 * PRD-github-integration §12.2:
 *   outcome_quality_v1.1 =
 *       0.60 · useful_output_retained_v1        (always present)
 *     + 0.25 · first_push_green_rate_v1         (may be suppressed)
 *     + 0.15 · deploy_success_per_dollar_v1     (stub in G2 — always suppressed)
 *
 * Suppression (D41): when a term has insufficient signal, its weight
 * redistributes proportionally across surviving terms. NEVER default-to-zero.
 */

import { describe, expect, test } from "bun:test";
import {
  computeOutcomeQualityV1_1,
  deploySuccessPerDollarV1FromPercentile,
  deploySuccessPerDollarV1Stub,
} from "./outcome_quality_v1_1";

describe("outcome_quality_v1.1", () => {
  test("all 3 terms present → standard weighted sum", () => {
    const result = computeOutcomeQualityV1_1({
      useful_output_retained: { value: 80, suppressed: false },
      first_push_green: { value: 70, suppressed: false },
      deploy_success_per_dollar: { value: 60, suppressed: false },
    });
    // 0.60*80 + 0.25*70 + 0.15*60 = 48 + 17.5 + 9 = 74.5
    expect(result.value).toBeCloseTo(74.5, 6);
    expect(result.surviving_terms).toEqual([
      "useful_output_retained",
      "first_push_green",
      "deploy_success_per_dollar",
    ]);
    expect(result.effective_weights.useful_output_retained).toBeCloseTo(0.6, 6);
    expect(result.effective_weights.first_push_green).toBeCloseTo(0.25, 6);
    expect(result.effective_weights.deploy_success_per_dollar).toBeCloseTo(0.15, 6);
  });

  test("deploy suppressed → remaining weights renormalize to sum-to-1", () => {
    const result = computeOutcomeQualityV1_1({
      useful_output_retained: { value: 80, suppressed: false },
      first_push_green: { value: 70, suppressed: false },
      deploy_success_per_dollar: { value: 0, suppressed: true },
    });
    // Survivors: useful=0.6, first_push=0.25 → total 0.85.
    // Renormalized: 0.6/0.85 = 0.70588..., 0.25/0.85 = 0.29411...
    // Score: 80*0.70588 + 70*0.29411 = 56.4706 + 20.5882 = 77.0588...
    expect(result.value).toBeCloseTo(77.0588, 3);
    const sumWeights =
      result.effective_weights.useful_output_retained +
      result.effective_weights.first_push_green +
      result.effective_weights.deploy_success_per_dollar;
    expect(sumWeights).toBeCloseTo(1, 6);
    expect(result.effective_weights.deploy_success_per_dollar).toBe(0);
  });

  test("deploy + first_push_green BOTH suppressed → all weight to useful_output_retained", () => {
    const result = computeOutcomeQualityV1_1({
      useful_output_retained: { value: 80, suppressed: false },
      first_push_green: { value: 0, suppressed: true },
      deploy_success_per_dollar: { value: 0, suppressed: true },
    });
    // Only survivor — gets effective weight 1.
    expect(result.value).toBeCloseTo(80, 6);
    expect(result.effective_weights.useful_output_retained).toBeCloseTo(1, 6);
    expect(result.surviving_terms).toEqual(["useful_output_retained"]);
  });

  test("suppressed term NEVER defaults to zero — verify no-deploy repo isn't penalized", () => {
    // Same useful_output + first_push values, once with deploy=suppressed,
    // once with deploy=0 NOT suppressed. The suppressed version must be
    // equal or higher — never lower.
    const suppressed = computeOutcomeQualityV1_1({
      useful_output_retained: { value: 70, suppressed: false },
      first_push_green: { value: 70, suppressed: false },
      deploy_success_per_dollar: { value: 0, suppressed: true },
    });
    const zeroFilled = computeOutcomeQualityV1_1({
      useful_output_retained: { value: 70, suppressed: false },
      first_push_green: { value: 70, suppressed: false },
      deploy_success_per_dollar: { value: 0, suppressed: false },
    });
    expect(suppressed.value).toBeGreaterThan(zeroFilled.value);
  });

  test("all suppressed → suppressed=true on result", () => {
    const result = computeOutcomeQualityV1_1({
      useful_output_retained: { value: 0, suppressed: true },
      first_push_green: { value: 0, suppressed: true },
      deploy_success_per_dollar: { value: 0, suppressed: true },
    });
    expect(result.suppressed).toBe(true);
    expect(result.value).toBe(0);
  });

  test("deterministic + pure", () => {
    const i = {
      useful_output_retained: { value: 50, suppressed: false },
      first_push_green: { value: 50, suppressed: false },
      deploy_success_per_dollar: { value: 50, suppressed: false },
    };
    expect(computeOutcomeQualityV1_1(i)).toEqual(computeOutcomeQualityV1_1(i));
  });

  test("G3 deploySuccessPerDollarV1Stub remains suppressed (G2-callsite back-compat)", () => {
    const term = deploySuccessPerDollarV1Stub();
    expect(term.suppressed).toBe(true);
    expect(term.value).toBe(0);
  });

  test("G3 deploySuccessPerDollarV1FromPercentile null → suppressed", () => {
    const t = deploySuccessPerDollarV1FromPercentile(null);
    expect(t.suppressed).toBe(true);
    expect(t.value).toBe(0);
  });

  test("G3 deploySuccessPerDollarV1FromPercentile 42 → not suppressed", () => {
    const t = deploySuccessPerDollarV1FromPercentile(42);
    expect(t.suppressed).toBe(false);
    expect(t.value).toBe(42);
  });

  test("G3 deploySuccessPerDollarV1FromPercentile Infinity → suppressed (no ∞ leak)", () => {
    const t = deploySuccessPerDollarV1FromPercentile(Number.POSITIVE_INFINITY);
    expect(t.suppressed).toBe(true);
  });
});
