/**
 * `github_deploy_per_dollar_v1` — STRETCH outcome signal (PRD-github-integration §12.1, §11.7, D60).
 *
 * Feeds `outcome_quality_v1.1` at weight 0.15 — the rate of production
 * deployments joined to merged PRs per dollar of session cost.
 *
 * Formula (locked):
 *   numerator       = |deployments where status='success'
 *                     AND environment matches prod-env allowlist
 *                     AND merged_pr NOT reverted within 24h|
 *   denominator_usd = sum(cost_usd of sessions joined to those PRs where cost_usd > 0)
 *   raw             = numerator / denominator_usd     (deploys per USD)
 *
 * Guard rails (all merge-blocking):
 *   - `k_anonymity`: suppress when `team_cohort_size < 5`.
 *   - `insufficient_deploys`: suppress when `repo_deploys_last_7d < 1`
 *     OR the post-filter numerator is 0 (D60 — "false absence beats false
 *     precision"; dashboards render `insufficient data`, never zero-fill).
 *   - Prod-env allowlist — default regex `^(prod|production|live|main)$`.
 *     Repos with exotic prod-env names (`deploy-us-east`, `prod-eu`) supply
 *     an admin-override regex. Everything else is dropped with a counter.
 *   - Revert penalty (24h) — deployments whose merged PR is reverted
 *     within 24h subtract from the numerator (mirrors D12 rule 5 posture
 *     on `accepted_and_retained_edits_per_dollar`).
 *   - cost_usd=0 (local-model fallback) — deploys with $0 joined session
 *     are excluded from both numerator AND denominator (never emit ∞).
 *
 * Pure: deterministic for identical input. No I/O, no `Date.now`, no random.
 */

export const DEFAULT_PROD_ENV_ALLOWLIST_REGEX = /^(prod|production|live|main)$/;

export interface DeploymentRecord {
  deployment_id: string;
  provider_repo_id: string;
  environment: string;
  sha: string;
  /** GitHub deployment_status.state. */
  status: "pending" | "queued" | "in_progress" | "success" | "failure" | "error" | "inactive";
  deployed_at: string;
  /** Merged PR number this deploy joined to; null when no join. */
  joined_pr_number: number | null;
  /** USD cost across all sessions joined to `joined_pr_number`; 0 for local-model. */
  merged_pr_cost_usd: number;
  /** D60 revert penalty — merged PR was reverted within 24h. */
  merged_pr_reverted_within_24h: boolean;
}

export interface DeployPerDollarInput {
  deployments: DeploymentRecord[];
  /** Distinct IC contributors to the team tile — k-anonymity floor ≥5. */
  team_cohort_size: number;
  /** Deploys the repo received in the last 7 days (any env, any status). */
  repo_deploys_last_7d: number;
  /**
   * Prod-env allowlist. Default `^(prod|production|live|main)$`. Admins
   * override per-repo via `/admin/github/repos/:id/prod-env-regex`.
   */
  prod_env_allowlist_regex: RegExp;
}

export type DeployPerDollarSuppression = "k_anonymity" | "insufficient_deploys";

export interface DeployPerDollarResult {
  /** Deployments per USD; suppressed→0. */
  raw: number;
  numerator: number;
  denominator_usd: number;
  excluded_environment_count: number;
  excluded_cost_zero_count: number;
  reverted_count: number;
  suppressed: boolean;
  suppression_reason?: DeployPerDollarSuppression;
}

const MIN_TEAM_COHORT = 5;
const MIN_REPO_DEPLOYS_7D = 1;

export function computeDeployPerDollar(input: DeployPerDollarInput): DeployPerDollarResult {
  let numerator = 0;
  let denominator_usd = 0;
  let excluded_environment_count = 0;
  let excluded_cost_zero_count = 0;
  let reverted_count = 0;

  // k-anonymity first — most restrictive.
  if (input.team_cohort_size < MIN_TEAM_COHORT) {
    return {
      raw: 0,
      numerator,
      denominator_usd,
      excluded_environment_count,
      excluded_cost_zero_count,
      reverted_count,
      suppressed: true,
      suppression_reason: "k_anonymity",
    };
  }

  for (const d of input.deployments) {
    if (d.status !== "success") continue;
    if (!input.prod_env_allowlist_regex.test(d.environment)) {
      excluded_environment_count++;
      continue;
    }
    if (d.joined_pr_number === null) continue;
    if (d.merged_pr_cost_usd <= 0) {
      excluded_cost_zero_count++;
      continue;
    }
    if (d.merged_pr_reverted_within_24h) {
      reverted_count++;
      // Revert subtracts from numerator but the cost is still spent → stays
      // in the denominator (this is identical in spirit to D12 rule 5's
      // `accepted_and_retained_edits_per_dollar`).
      denominator_usd += d.merged_pr_cost_usd;
      continue;
    }
    numerator++;
    denominator_usd += d.merged_pr_cost_usd;
  }

  // D60 activity floor.
  if (input.repo_deploys_last_7d < MIN_REPO_DEPLOYS_7D || numerator === 0) {
    return {
      raw: 0,
      numerator,
      denominator_usd,
      excluded_environment_count,
      excluded_cost_zero_count,
      reverted_count,
      suppressed: true,
      suppression_reason: "insufficient_deploys",
    };
  }

  const raw = denominator_usd === 0 ? 0 : numerator / denominator_usd;
  return {
    raw,
    numerator,
    denominator_usd,
    excluded_environment_count,
    excluded_cost_zero_count,
    reverted_count,
    suppressed: false,
  };
}
