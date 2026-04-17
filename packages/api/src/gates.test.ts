import { describe, expect, test } from "bun:test";
import { applyDisplayGate } from "./gates";

describe("applyDisplayGate", () => {
  const okInput = {
    sessions_count: 20,
    active_days: 10,
    outcome_events: 5,
    cohort_size: 12,
  };

  test("all thresholds met → show:true", () => {
    expect(applyDisplayGate(okInput)).toEqual({ show: true });
  });

  test("insufficient sessions trips first when it's the only gate that fails", () => {
    const result = applyDisplayGate({ ...okInput, sessions_count: 2 });
    expect(result.show).toBe(false);
    if (result.show === false) {
      expect(result.suppression_reason).toBe("insufficient_sessions");
      expect(result.failed_gates).toContain("sessions");
    }
  });

  test("k_anonymity_floor dominates other failures for team scope", () => {
    const result = applyDisplayGate({
      sessions_count: 1,
      active_days: 1,
      outcome_events: 0,
      cohort_size: 2,
      team_scope: true,
    });
    expect(result.show).toBe(false);
    if (result.show === false) {
      expect(result.suppression_reason).toBe("k_anonymity_floor");
      // All other gates also fail and are listed.
      expect(result.failed_gates).toContain("k_anonymity_floor");
      expect(result.failed_gates).toContain("sessions");
    }
  });

  test("individual scope with cohort < 8 shows insufficient_cohort", () => {
    const result = applyDisplayGate({ ...okInput, cohort_size: 4 });
    expect(result.show).toBe(false);
    if (result.show === false) {
      expect(result.suppression_reason).toBe("insufficient_cohort");
    }
  });

  test("team scope with cohort=6 (between k floor and MIN_COHORT) shows insufficient_cohort, not k_anonymity", () => {
    const result = applyDisplayGate({
      ...okInput,
      cohort_size: 6,
      team_scope: true,
    });
    expect(result.show).toBe(false);
    if (result.show === false) {
      // k=5 passes; cohort<8 still trips MIN_COHORT.
      expect(result.suppression_reason).toBe("insufficient_cohort");
      expect(result.failed_gates).not.toContain("k_anonymity_floor");
    }
  });

  test("outcome events ranks above active days in primary suppression selection", () => {
    const result = applyDisplayGate({
      ...okInput,
      active_days: 1,
      outcome_events: 0,
    });
    expect(result.show).toBe(false);
    if (result.show === false) {
      expect(result.suppression_reason).toBe("insufficient_outcome_events");
    }
  });
});
