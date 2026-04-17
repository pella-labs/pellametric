import { describe, expect, test } from "bun:test";
import { computeConfidence } from "./confidence";

describe("computeConfidence()", () => {
  test("zero outcome events yields confidence 0", () => {
    expect(computeConfidence(0, 10)).toBe(0);
  });

  test("10 events + 10 active days saturates to 1.0", () => {
    expect(computeConfidence(10, 10)).toBeCloseTo(1.0, 9);
  });

  test("monotonic non-decreasing in outcome_events (days held fixed)", () => {
    let prev = -1;
    for (let events = 0; events <= 20; events++) {
      const c = computeConfidence(events, 10);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});
