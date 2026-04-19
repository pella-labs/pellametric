/**
 * G2 — `github_first_push_green_v1` contract test (RED first).
 *
 * Verifies the signal's locked formula and guard rails per PRD §12.1 /
 * CLAUDE.md GitHub integration plan. The module is a pure function; these
 * tests pin the math and the four guard rails (k≥5, min-pushes, flaky-CI
 * filter D45, non-config-file-changed).
 */

import { describe, expect, test } from "bun:test";
import {
  computeFirstPushGreen,
  type FirstPushGreenInput,
  type FirstPushGreenPush,
} from "./github_first_push_green_v1";

const basePush: FirstPushGreenPush = {
  commit_sha: "a".repeat(40),
  pushed_at: "2026-04-10T10:00:00Z",
  non_config_file_changed: true,
  check_suite_completed_at: "2026-04-10T10:20:00Z",
  check_suite_conclusion: "success",
  check_suite_attempt_passed_on_rerun_within_24h: false,
};

function makeInput(pushes: FirstPushGreenPush[]): FirstPushGreenInput {
  return {
    pushes,
    repo_check_suites_last_7d: 10,
    team_cohort_size: 5,
  };
}

describe("github_first_push_green_v1", () => {
  test("all pushes pass → rate = 1.0, suppressed=false", () => {
    const result = computeFirstPushGreen(
      makeInput([
        { ...basePush, commit_sha: "a".repeat(40) },
        { ...basePush, commit_sha: "b".repeat(40) },
        { ...basePush, commit_sha: "c".repeat(40) },
        { ...basePush, commit_sha: "d".repeat(40) },
      ]),
    );
    expect(result.suppressed).toBe(false);
    expect(result.raw).toBeCloseTo(1.0, 6);
    expect(result.denominator).toBe(4);
    expect(result.numerator).toBe(4);
  });

  test("half pass → rate = 0.5", () => {
    const result = computeFirstPushGreen(
      makeInput([
        { ...basePush, commit_sha: "a".repeat(40), check_suite_conclusion: "success" },
        { ...basePush, commit_sha: "b".repeat(40), check_suite_conclusion: "failure" },
        { ...basePush, commit_sha: "c".repeat(40), check_suite_conclusion: "success" },
        { ...basePush, commit_sha: "d".repeat(40), check_suite_conclusion: "failure" },
      ]),
    );
    expect(result.suppressed).toBe(false);
    expect(result.raw).toBeCloseTo(0.5, 6);
  });

  test("D45 flaky-CI filter: commits that pass on re-run within 24h are EXCLUDED from denom", () => {
    const result = computeFirstPushGreen(
      makeInput([
        { ...basePush, commit_sha: "a".repeat(40), check_suite_conclusion: "failure" },
        // Flaky — pushed red but passed on re-run. Excluded entirely.
        {
          ...basePush,
          commit_sha: "b".repeat(40),
          check_suite_conclusion: "failure",
          check_suite_attempt_passed_on_rerun_within_24h: true,
        },
        { ...basePush, commit_sha: "c".repeat(40), check_suite_conclusion: "success" },
        { ...basePush, commit_sha: "d".repeat(40), check_suite_conclusion: "success" },
      ]),
    );
    // Denominator: 3 (flaky excluded). Numerator: 2 successes.
    expect(result.denominator).toBe(3);
    expect(result.numerator).toBe(2);
    expect(result.raw).toBeCloseTo(2 / 3, 6);
  });

  test("config-only pushes are EXCLUDED (require ≥1 non-config file changed)", () => {
    const result = computeFirstPushGreen(
      makeInput([
        { ...basePush, commit_sha: "a".repeat(40), non_config_file_changed: false },
        { ...basePush, commit_sha: "b".repeat(40), non_config_file_changed: true },
        { ...basePush, commit_sha: "c".repeat(40), non_config_file_changed: true },
        { ...basePush, commit_sha: "d".repeat(40), non_config_file_changed: true },
      ]),
    );
    expect(result.denominator).toBe(3);
    expect(result.numerator).toBe(3);
    expect(result.raw).toBeCloseTo(1.0, 6);
  });

  test("pushes without a check_suite within 30min are EXCLUDED from denominator", () => {
    const result = computeFirstPushGreen(
      makeInput([
        {
          ...basePush,
          commit_sha: "a".repeat(40),
          check_suite_completed_at: null,
          check_suite_conclusion: null,
        },
        { ...basePush, commit_sha: "b".repeat(40) },
      ]),
    );
    expect(result.denominator).toBe(1);
  });

  test("guard: <3 pushes-with-CI in window → suppressed", () => {
    const result = computeFirstPushGreen(
      makeInput([
        { ...basePush, commit_sha: "a".repeat(40) },
        { ...basePush, commit_sha: "b".repeat(40) },
      ]),
    );
    expect(result.suppressed).toBe(true);
    expect(result.suppression_reason).toBe("insufficient_pushes");
  });

  test("guard: repo with <2 check_suites/7d → suppressed", () => {
    const input = makeInput(
      Array.from({ length: 6 }, (_, i) => ({
        ...basePush,
        commit_sha: String(i).repeat(40).slice(0, 40),
      })),
    );
    input.repo_check_suites_last_7d = 1;
    const result = computeFirstPushGreen(input);
    expect(result.suppressed).toBe(true);
    expect(result.suppression_reason).toBe("repo_ci_inactive");
  });

  test("guard: team_cohort_size < 5 → suppressed (k-anonymity floor)", () => {
    const input = makeInput(
      Array.from({ length: 6 }, (_, i) => ({
        ...basePush,
        commit_sha: String(i).repeat(40).slice(0, 40),
      })),
    );
    input.team_cohort_size = 4;
    const result = computeFirstPushGreen(input);
    expect(result.suppressed).toBe(true);
    expect(result.suppression_reason).toBe("k_anonymity");
  });

  test("deterministic + pure — no dates, no random", () => {
    const input = makeInput([
      { ...basePush, commit_sha: "a".repeat(40) },
      { ...basePush, commit_sha: "b".repeat(40) },
      { ...basePush, commit_sha: "c".repeat(40) },
    ]);
    const a = computeFirstPushGreen(input);
    const b = computeFirstPushGreen(input);
    expect(a).toEqual(b);
  });
});
