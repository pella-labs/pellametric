/**
 * G2 — D48 confidence formula update (RED first).
 *
 * Per PRD-github-integration §12.2, for v1.1 dashboards:
 *   outcomeEvents = |{accepted_hunks ∪ first_push_green ∪ deploy_success}|
 *   activeDays unchanged
 *   confidence = min(1, √(outcomeEvents/10)) · min(1, √(activeDays/10))
 *
 * v1 dashboards must NOT change — they continue using just accepted_hunks.
 * This module ships a new `computeConfidenceV1_1` that accepts the union.
 */

import { describe, expect, test } from "bun:test";
import { computeConfidenceV1_1, outcomeEventsUnion } from "./confidence_v1_1";

describe("confidence_v1.1 (D48)", () => {
  test("outcomeEventsUnion counts distinct events across 3 sources", () => {
    const total = outcomeEventsUnion({
      accepted_hunks: 5,
      first_push_green: 3,
      deploy_success: 2,
    });
    expect(total).toBe(10);
  });

  test("zero outcome events → confidence 0", () => {
    const c = computeConfidenceV1_1(
      { accepted_hunks: 0, first_push_green: 0, deploy_success: 0 },
      10,
    );
    expect(c).toBe(0);
  });

  test("10 total events + 10 active days saturates to 1", () => {
    const c = computeConfidenceV1_1(
      { accepted_hunks: 5, first_push_green: 3, deploy_success: 2 },
      10,
    );
    expect(c).toBeCloseTo(1.0, 9);
  });

  test("union absorbs sparse accepted_hunks — IC with 3 accepts + 5 first_push + 2 deploys saturates", () => {
    const c = computeConfidenceV1_1(
      { accepted_hunks: 3, first_push_green: 5, deploy_success: 2 },
      10,
    );
    expect(c).toBeCloseTo(1.0, 9);
  });

  test("monotonic non-decreasing across added signals", () => {
    let prev = -1;
    for (let first_push = 0; first_push <= 10; first_push++) {
      const c = computeConfidenceV1_1(
        { accepted_hunks: 2, first_push_green: first_push, deploy_success: 0 },
        10,
      );
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  test("v1 behavior preserved — accepted_hunks only with zero GitHub signals", () => {
    // If first_push_green and deploy_success are both 0, the union equals
    // accepted_hunks — v1 consumers who pass {github: 0, 0} get v1 behavior.
    const c = computeConfidenceV1_1(
      { accepted_hunks: 10, first_push_green: 0, deploy_success: 0 },
      10,
    );
    expect(c).toBeCloseTo(1.0, 9);
  });

  test("activeDays unchanged — negative inputs clamp to 0 (no NaN)", () => {
    const c = computeConfidenceV1_1(
      { accepted_hunks: -5, first_push_green: -2, deploy_success: 0 },
      -3,
    );
    expect(c).toBe(0);
  });
});
