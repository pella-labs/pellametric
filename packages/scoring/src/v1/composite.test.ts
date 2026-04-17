import { describe, expect, test } from "bun:test";
import { composite, WEIGHTS } from "./composite";

describe("composite()", () => {
  test("weights sum to 1", () => {
    const sum =
      WEIGHTS.outcome_quality +
      WEIGHTS.efficiency +
      WEIGHTS.autonomy +
      WEIGHTS.adoption_depth +
      WEIGHTS.team_impact;
    // Floating-point tolerance — weights are decimals so exact equality is unsafe.
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  test("composite math matches expected weighted sum", () => {
    const result = composite({
      outcome_quality: 80,
      efficiency: 60,
      autonomy: 70,
      adoption_depth: 50,
      team_impact: 40,
    });
    // 0.35*80 + 0.25*60 + 0.20*70 + 0.10*50 + 0.10*40
    // = 28 + 15 + 14 + 5 + 4 = 66
    expect(result).toBeCloseTo(66, 9);
  });
});
