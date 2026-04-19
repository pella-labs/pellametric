/**
 * G2 — cohort-fallback audit assertion (D42).
 *
 * When the D42 cohort key falls back (k<5 at some level of specificity),
 * the caller receives an `onFallback(reason)` callback so it can persist an
 * `audit_log` row. This test asserts:
 *   - the fallback sequence is (org_tenure → codeowner_domain → author_tier)
 *   - each step fires the callback exactly once with the correct reason
 *   - below-floor case sets `below_k_floor: true`
 *
 * The real `audit_log` write is wired in the dashboard rollup layer (out
 * of scope for the scoring package); here we assert the CALLBACK contract.
 */

import { describe, expect, test } from "bun:test";
import {
  type CohortContext,
  type FallbackReason,
  resolveCohortWithFallback,
} from "./cohort_key_v1_1";

const ctx: CohortContext = {
  task_category: "feature",
  author_association_tier: "JUNIOR",
  codeowner_domain: "backend",
  org_tenure_bucket: "<=30d",
};

describe("Cohort-fallback audit trail (D42)", () => {
  test("full cohort has k≥5 → no audit row written", () => {
    const audit: FallbackReason[] = [];
    const resolved = resolveCohortWithFallback(ctx, {
      cohortSizeAt: () => 20,
      minCohort: 5,
      onFallback: (r) => audit.push(r),
    });
    expect(resolved.fallback_level).toBe(0);
    expect(resolved.below_k_floor).toBe(false);
    expect(audit).toHaveLength(0);
  });

  test("single fallback → single audit row in correct order", () => {
    const audit: FallbackReason[] = [];
    const resolved = resolveCohortWithFallback(ctx, {
      cohortSizeAt: (k) => (k.split("|").length >= 4 ? 2 : 10),
      minCohort: 5,
      onFallback: (r) => audit.push(r),
    });
    expect(resolved.fallback_level).toBe(1);
    expect(audit).toEqual(["dropped_org_tenure_bucket"]);
  });

  test("three-step fallback fires all 3 audit rows in ladder order", () => {
    const audit: FallbackReason[] = [];
    resolveCohortWithFallback(ctx, {
      cohortSizeAt: (k) => {
        const parts = k.split("|").length;
        if (parts >= 4) return 1;
        if (parts === 3) return 2;
        if (parts === 2) return 3;
        return 100;
      },
      minCohort: 5,
      onFallback: (r) => audit.push(r),
    });
    expect(audit).toEqual([
      "dropped_org_tenure_bucket",
      "dropped_codeowner_domain",
      "dropped_author_association_tier",
    ]);
  });

  test("below_k_floor when every level fails — task-only returned with flag", () => {
    const audit: FallbackReason[] = [];
    const resolved = resolveCohortWithFallback(ctx, {
      cohortSizeAt: () => 0,
      minCohort: 5,
      onFallback: (r) => audit.push(r),
    });
    expect(resolved.below_k_floor).toBe(true);
    expect(resolved.key).toBe("feature");
    expect(audit).toEqual([
      "dropped_org_tenure_bucket",
      "dropped_codeowner_domain",
      "dropped_author_association_tier",
    ]);
  });
});
