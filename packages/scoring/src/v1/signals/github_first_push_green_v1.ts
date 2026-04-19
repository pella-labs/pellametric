/**
 * `github_first_push_green_v1` — CORE outcome signal (PRD §12.1).
 *
 * Feeds `outcome_quality_v1.1` at weight 0.25 — the fraction of pushes with a
 * matching check_suite that conclude `success` within 30 minutes of head_sha.
 *
 * Formula:
 *   numerator   = |pushes with check_suite_completed && conclusion='success'|
 *   denominator = |pushes with ≥1 check_suite_completed within 30min|
 *   raw         = numerator / denominator, [0, 1]
 *
 * Guard rails (all merge-blocking per PRD §12.1):
 *   - `k_anonymity`: suppress when `team_cohort_size < 5`.
 *   - `insufficient_pushes`: suppress when <3 pushes-with-CI in window
 *     (team-level tile cannot render a fraction from <3 draws).
 *   - `repo_ci_inactive`: suppress when repo has <2 check_suites in last 7d
 *     (can't meaningfully measure pass-rate on a CI-off repo).
 *   - `D45 flaky-CI filter`: pushes whose check_suite failed but passed on
 *     a re-run within 24h are EXCLUDED entirely (neither num nor denom).
 *   - `non_config_file_changed`: pushes that touch only config/metadata
 *     files are EXCLUDED from the denominator (a dependabot-style bump
 *     isn't a meaningful "first push green" signal).
 *
 * Pure: deterministic for identical input. No I/O, no `Date.now`, no random.
 */

export interface FirstPushGreenPush {
  /** 40-char hex commit SHA. */
  commit_sha: string;
  /** ISO-8601 UTC timestamp of the push. */
  pushed_at: string;
  /** True when the push touched at least one non-config file. */
  non_config_file_changed: boolean;
  /** Null if no check_suite was observed within the 30-min window. */
  check_suite_completed_at: string | null;
  /** One of the 8 GitHub check_suite conclusions, or null. */
  check_suite_conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "timed_out"
    | "action_required"
    | "stale"
    | "skipped"
    | null;
  /** D45: true when a subsequent attempt within 24h PASSED after initial failure. */
  check_suite_attempt_passed_on_rerun_within_24h: boolean;
}

export interface FirstPushGreenInput {
  pushes: FirstPushGreenPush[];
  /** Count of check_suite.completed events on the tracked repo in the last 7 days. */
  repo_check_suites_last_7d: number;
  /** Distinct ICs contributing to the team tile — k-anonymity floor is ≥5. */
  team_cohort_size: number;
}

export type SuppressionReason = "k_anonymity" | "insufficient_pushes" | "repo_ci_inactive";

export interface FirstPushGreenResult {
  raw: number;
  numerator: number;
  denominator: number;
  excluded_flaky_count: number;
  excluded_config_only_count: number;
  suppressed: boolean;
  suppression_reason?: SuppressionReason;
}

const MIN_TEAM_COHORT = 5;
const MIN_PUSHES_WITH_CI = 3;
const MIN_REPO_CHECK_SUITES_7D = 2;

export function computeFirstPushGreen(input: FirstPushGreenInput): FirstPushGreenResult {
  let numerator = 0;
  let denominator = 0;
  let excluded_flaky_count = 0;
  let excluded_config_only_count = 0;

  for (const p of input.pushes) {
    // D45: flaky-CI filter — exclude entirely.
    if (p.check_suite_attempt_passed_on_rerun_within_24h) {
      excluded_flaky_count++;
      continue;
    }
    // Require non-config file change.
    if (!p.non_config_file_changed) {
      excluded_config_only_count++;
      continue;
    }
    // Require a check_suite within the 30-min window.
    if (p.check_suite_completed_at === null || p.check_suite_conclusion === null) {
      continue;
    }
    denominator++;
    if (p.check_suite_conclusion === "success") {
      numerator++;
    }
  }

  // Guard ordering: k_anonymity first (most restrictive), then activity floors.
  if (input.team_cohort_size < MIN_TEAM_COHORT) {
    return {
      raw: 0,
      numerator,
      denominator,
      excluded_flaky_count,
      excluded_config_only_count,
      suppressed: true,
      suppression_reason: "k_anonymity",
    };
  }
  if (input.repo_check_suites_last_7d < MIN_REPO_CHECK_SUITES_7D) {
    return {
      raw: 0,
      numerator,
      denominator,
      excluded_flaky_count,
      excluded_config_only_count,
      suppressed: true,
      suppression_reason: "repo_ci_inactive",
    };
  }
  if (denominator < MIN_PUSHES_WITH_CI) {
    return {
      raw: 0,
      numerator,
      denominator,
      excluded_flaky_count,
      excluded_config_only_count,
      suppressed: true,
      suppression_reason: "insufficient_pushes",
    };
  }

  const raw = denominator === 0 ? 0 : numerator / denominator;
  return {
    raw,
    numerator,
    denominator,
    excluded_flaky_count,
    excluded_config_only_count,
    suppressed: false,
  };
}
