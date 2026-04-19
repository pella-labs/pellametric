/**
 * G2 — D42 cohort key + fallback ladder (RED first).
 *
 * PRD §12.3:
 *   cohort_key = (task_category, author_association_tier, codeowner_domain, org_tenure_bucket)
 *
 * Fallback ladder when k<5: drop `org_tenure_bucket` → drop `codeowner_domain`
 * → drop `author_association_tier`. Log cohort fallback in audit_log.
 */

import { describe, expect, test } from "bun:test";
import {
  buildCohortKey,
  type CohortContext,
  orgTenureBucket,
  resolveCohortWithFallback,
} from "./cohort_key_v1_1";

const context: CohortContext = {
  task_category: "feature",
  author_association_tier: "SENIOR",
  codeowner_domain: "frontend",
  org_tenure_bucket: "31-180d",
};

describe("D42 cohort key", () => {
  test("buildCohortKey combines all 4 dims deterministically", () => {
    const key = buildCohortKey(context);
    expect(key).toBe("feature|SENIOR|frontend|31-180d");
  });

  test("orgTenureBucket bucket mapping", () => {
    expect(orgTenureBucket(20)).toBe("<=30d");
    expect(orgTenureBucket(90)).toBe("31-180d");
    expect(orgTenureBucket(400)).toBe("181-730d");
    expect(orgTenureBucket(1000)).toBe(">730d");
  });

  test("fallback ladder: full cohort has k≥5 → use full key", () => {
    const audit: string[] = [];
    const resolved = resolveCohortWithFallback(context, {
      cohortSizeAt: (k) => (k === "feature|SENIOR|frontend|31-180d" ? 10 : 0),
      minCohort: 5,
      onFallback: (reason) => audit.push(reason),
    });
    expect(resolved.key).toBe("feature|SENIOR|frontend|31-180d");
    expect(resolved.fallback_level).toBe(0);
    expect(audit).toHaveLength(0);
  });

  test("fallback: drop org_tenure → audit logged", () => {
    const audit: string[] = [];
    const resolved = resolveCohortWithFallback(context, {
      cohortSizeAt: (k) => {
        if (k === "feature|SENIOR|frontend|31-180d") return 3;
        if (k === "feature|SENIOR|frontend") return 7;
        return 0;
      },
      minCohort: 5,
      onFallback: (reason) => audit.push(reason),
    });
    expect(resolved.key).toBe("feature|SENIOR|frontend");
    expect(resolved.fallback_level).toBe(1);
    expect(audit).toEqual(["dropped_org_tenure_bucket"]);
  });

  test("fallback: drop org_tenure → drop codeowner → drop author_association", () => {
    const audit: string[] = [];
    const resolved = resolveCohortWithFallback(context, {
      cohortSizeAt: (k) => {
        if (k === "feature|SENIOR|frontend|31-180d") return 1;
        if (k === "feature|SENIOR|frontend") return 2;
        if (k === "feature|SENIOR") return 3;
        if (k === "feature") return 12;
        return 0;
      },
      minCohort: 5,
      onFallback: (reason) => audit.push(reason),
    });
    expect(resolved.key).toBe("feature");
    expect(resolved.fallback_level).toBe(3);
    expect(audit).toEqual([
      "dropped_org_tenure_bucket",
      "dropped_codeowner_domain",
      "dropped_author_association_tier",
    ]);
  });

  test("even task-only fails → final key returned with fallback=final", () => {
    const audit: string[] = [];
    const resolved = resolveCohortWithFallback(context, {
      cohortSizeAt: () => 0,
      minCohort: 5,
      onFallback: (reason) => audit.push(reason),
    });
    expect(resolved.key).toBe("feature");
    expect(resolved.fallback_level).toBe(3);
    expect(resolved.below_k_floor).toBe(true);
  });
});
