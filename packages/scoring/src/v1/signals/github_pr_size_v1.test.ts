/**
 * G2 — `github_pr_size_v1` contract test (RED first).
 *
 * Feeds efficiency_v1's denominator — accepted_and_retained_edits_per_dollar
 * unchanged; this module computes the PR-LOC side with D46 guard rails:
 *   - strip `.gitattributes linguist-generated` paths before counting LOC
 *   - PRs <10 LOC excluded
 *   - winsorize p5/p95
 *   - test_loc/prod_loc companion metric
 *
 * Linguist resolution is pluggable — in G2 it reads from a fixture; prod
 * wiring lands in G3.
 */

import { describe, expect, test } from "bun:test";
import { computePrSize, type PrSizeInput } from "./github_pr_size_v1";

function basePr(overrides: Partial<PrSizeInput["prs"][number]> = {}) {
  return {
    pr_number: 1,
    additions: 100,
    deletions: 20,
    files: [
      { path: "src/foo.ts", additions: 80, deletions: 20, is_test: false },
      { path: "src/foo.test.ts", additions: 20, deletions: 0, is_test: true },
    ],
    ...overrides,
  };
}

describe("github_pr_size_v1", () => {
  test("sums additions+deletions across non-generated files", () => {
    const result = computePrSize({
      prs: [basePr({ pr_number: 1 })],
      linguist_generated_globs: [],
    });
    expect(result.included_prs).toHaveLength(1);
    expect(result.included_prs[0]?.loc).toBe(120);
  });

  test("D46: strips linguist-generated globs", () => {
    const result = computePrSize({
      prs: [
        basePr({
          pr_number: 1,
          files: [
            { path: "src/foo.ts", additions: 40, deletions: 10, is_test: false },
            {
              path: "apps/web/next-env.d.ts",
              additions: 200,
              deletions: 0,
              is_test: false,
            },
            { path: "dist/bundle.js", additions: 5000, deletions: 0, is_test: false },
          ],
        }),
      ],
      linguist_generated_globs: ["*.d.ts", "dist/**"],
    });
    expect(result.included_prs[0]?.loc).toBe(50);
  });

  test("PRs <10 LOC excluded entirely", () => {
    const result = computePrSize({
      prs: [
        basePr({
          pr_number: 1,
          additions: 5,
          deletions: 2,
          files: [{ path: "src/foo.ts", additions: 5, deletions: 2, is_test: false }],
        }),
        basePr({ pr_number: 2 }),
      ],
      linguist_generated_globs: [],
    });
    expect(result.included_prs.map((p) => p.pr_number)).toEqual([2]);
    expect(result.excluded_count).toBe(1);
  });

  test("winsorize p5/p95 on PR-LOC distribution", () => {
    const result = computePrSize({
      prs: [
        basePr({
          pr_number: 1,
          additions: 10,
          deletions: 0,
          files: [{ path: "a", additions: 10, deletions: 0, is_test: false }],
        }),
        basePr({
          pr_number: 2,
          additions: 50,
          deletions: 0,
          files: [{ path: "a", additions: 50, deletions: 0, is_test: false }],
        }),
        basePr({
          pr_number: 3,
          additions: 100,
          deletions: 0,
          files: [{ path: "a", additions: 100, deletions: 0, is_test: false }],
        }),
        basePr({
          pr_number: 4,
          additions: 200,
          deletions: 0,
          files: [{ path: "a", additions: 200, deletions: 0, is_test: false }],
        }),
        basePr({
          pr_number: 5,
          additions: 10000,
          deletions: 0,
          files: [{ path: "a", additions: 10000, deletions: 0, is_test: false }],
        }),
      ],
      linguist_generated_globs: [],
    });
    // p95 on [10,50,100,200,10000] is much less than 10000 after winsorization.
    expect(result.winsorized_loc_sum).toBeLessThan(10000 + 200 + 100 + 50 + 10);
    expect(result.winsorized_loc_sum).toBeGreaterThan(0);
  });

  test("test_loc / prod_loc companion metric", () => {
    const result = computePrSize({
      prs: [basePr({ pr_number: 1 })], // 100 prod + 20 test
      linguist_generated_globs: [],
    });
    expect(result.test_loc).toBe(20);
    expect(result.prod_loc).toBe(100);
    expect(result.test_to_prod_ratio).toBeCloseTo(0.2, 6);
  });

  test("deterministic", () => {
    const input: PrSizeInput = {
      prs: [basePr()],
      linguist_generated_globs: [],
    };
    expect(computePrSize(input)).toEqual(computePrSize(input));
  });
});
