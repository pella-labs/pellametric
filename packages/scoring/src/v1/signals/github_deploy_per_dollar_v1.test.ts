/**
 * G3 — `github_deploy_per_dollar_v1` contract test (RED first).
 *
 * Pins the STRETCH outcome signal's locked formula and guard rails per
 * PRD-github-integration §12.1 / §11.7 / D60:
 *
 *   - prod-env allowlist (default `^(prod|production|live|main)$`, or
 *     admin-override regex per repo)
 *   - k≥5 team cohort floor
 *   - suppress repo when <1 deploy/week (re-using HAS_DEPLOYMENT_SIGNAL
 *     defined as ≥3 deploys in 30d AND distinct environments ≥1; the
 *     module's gate uses the weekly-rate reading passed in directly)
 *   - 24h revert penalty — deployments whose merged PR was reverted within
 *     24h subtract from the numerator
 *
 * Pure. Deterministic. No `Date.now` / random / I/O.
 */

import { describe, expect, test } from "bun:test";
import {
  computeDeployPerDollar,
  DEFAULT_PROD_ENV_ALLOWLIST_REGEX,
  type DeploymentRecord,
  type DeployPerDollarInput,
} from "./github_deploy_per_dollar_v1";

const base: DeploymentRecord = {
  deployment_id: "d-1",
  provider_repo_id: "101",
  environment: "production",
  sha: "a".repeat(40),
  status: "success",
  deployed_at: "2026-04-10T12:00:00Z",
  joined_pr_number: 42,
  merged_pr_cost_usd: 10,
  merged_pr_reverted_within_24h: false,
};

function makeInput(
  deployments: DeploymentRecord[],
  overrides: Partial<DeployPerDollarInput> = {},
): DeployPerDollarInput {
  return {
    deployments,
    team_cohort_size: 5,
    repo_deploys_last_7d: 5,
    prod_env_allowlist_regex: DEFAULT_PROD_ENV_ALLOWLIST_REGEX,
    ...overrides,
  };
}

describe("github_deploy_per_dollar_v1", () => {
  test("3 prod successful deploys + $30 total → raw = 0.1 deploys/$", () => {
    const r = computeDeployPerDollar(
      makeInput([
        { ...base, deployment_id: "d-1", sha: "a".repeat(40), joined_pr_number: 1 },
        { ...base, deployment_id: "d-2", sha: "b".repeat(40), joined_pr_number: 2 },
        { ...base, deployment_id: "d-3", sha: "c".repeat(40), joined_pr_number: 3 },
      ]),
    );
    expect(r.suppressed).toBe(false);
    expect(r.numerator).toBe(3);
    expect(r.denominator_usd).toBeCloseTo(30, 6);
    expect(r.raw).toBeCloseTo(0.1, 6);
  });

  test("staging-env deploys are excluded via prod-env allowlist (persona 6)", () => {
    // 100 staging deploys vs 2 prod — staging-spam gamer persona. Numerator
    // counts ONLY the 2 prod deploys regardless of the 100 staging noise.
    const stagingSpam: DeploymentRecord[] = Array.from({ length: 100 }, (_, i) => ({
      ...base,
      deployment_id: `staging-${i}`,
      sha: i.toString(16).padStart(40, "0"),
      environment: "staging",
      joined_pr_number: 1000 + i,
      merged_pr_cost_usd: 5,
    }));
    const prod: DeploymentRecord[] = [
      { ...base, deployment_id: "p-1", sha: "f".repeat(40), joined_pr_number: 1 },
      { ...base, deployment_id: "p-2", sha: "e".repeat(40), joined_pr_number: 2 },
    ];
    const r = computeDeployPerDollar(makeInput([...stagingSpam, ...prod]));
    expect(r.suppressed).toBe(false);
    expect(r.numerator).toBe(2);
    expect(r.excluded_environment_count).toBe(100);
  });

  test("repo-admin override allowlist accepts `deploy-us-east`", () => {
    const deploys: DeploymentRecord[] = [
      { ...base, environment: "deploy-us-east", joined_pr_number: 1 },
      { ...base, environment: "deploy-us-east", sha: "b".repeat(40), joined_pr_number: 2 },
      { ...base, environment: "deploy-us-east", sha: "c".repeat(40), joined_pr_number: 3 },
    ];
    // With default regex, all 3 would be excluded.
    const def = computeDeployPerDollar(makeInput(deploys));
    expect(def.excluded_environment_count).toBe(3);
    expect(def.suppressed).toBe(true);

    // With admin override matching `deploy-us-east`, they count.
    const over = computeDeployPerDollar(
      makeInput(deploys, { prod_env_allowlist_regex: /^deploy-us-east$/ }),
    );
    expect(over.excluded_environment_count).toBe(0);
    expect(over.numerator).toBe(3);
  });

  test("non-prod-env gamer (`canary-eu`) is excluded without admin override (persona: non-prod-env)", () => {
    // 10 deploys/day to `canary-eu` → 10-day window, 100 total.
    const deploys: DeploymentRecord[] = Array.from({ length: 100 }, (_, i) => ({
      ...base,
      deployment_id: `canary-${i}`,
      sha: i.toString(16).padStart(40, "0"),
      environment: "canary-eu",
      joined_pr_number: 100 + i,
    }));
    const r = computeDeployPerDollar(makeInput(deploys));
    expect(r.excluded_environment_count).toBe(100);
    expect(r.suppressed).toBe(true);
    expect(r.suppression_reason).toBe("insufficient_deploys");
  });

  test("failed deployments are not counted (only status=success)", () => {
    const deploys: DeploymentRecord[] = [
      {
        ...base,
        status: "failure",
        deployment_id: "d-f",
        sha: "1".repeat(40),
        joined_pr_number: 1,
      },
      { ...base, status: "error", deployment_id: "d-e", sha: "2".repeat(40), joined_pr_number: 2 },
      {
        ...base,
        status: "success",
        deployment_id: "d-s1",
        sha: "3".repeat(40),
        joined_pr_number: 3,
      },
      {
        ...base,
        status: "success",
        deployment_id: "d-s2",
        sha: "4".repeat(40),
        joined_pr_number: 4,
      },
      {
        ...base,
        status: "success",
        deployment_id: "d-s3",
        sha: "5".repeat(40),
        joined_pr_number: 5,
      },
    ];
    const r = computeDeployPerDollar(makeInput(deploys));
    expect(r.numerator).toBe(3);
  });

  test("24h revert penalty subtracts from numerator", () => {
    // 4 prod deploys; one is reverted within 24h. numerator = 3.
    const deploys: DeploymentRecord[] = [
      { ...base, deployment_id: "d-1", sha: "1".repeat(40), joined_pr_number: 1 },
      { ...base, deployment_id: "d-2", sha: "2".repeat(40), joined_pr_number: 2 },
      { ...base, deployment_id: "d-3", sha: "3".repeat(40), joined_pr_number: 3 },
      {
        ...base,
        deployment_id: "d-revert",
        sha: "4".repeat(40),
        joined_pr_number: 4,
        merged_pr_reverted_within_24h: true,
      },
    ];
    const r = computeDeployPerDollar(makeInput(deploys));
    expect(r.numerator).toBe(3);
    expect(r.reverted_count).toBe(1);
  });

  test("k<5 → suppress with k_anonymity", () => {
    const deploys: DeploymentRecord[] = [
      { ...base, deployment_id: "d-1", joined_pr_number: 1 },
      { ...base, deployment_id: "d-2", sha: "b".repeat(40), joined_pr_number: 2 },
      { ...base, deployment_id: "d-3", sha: "c".repeat(40), joined_pr_number: 3 },
    ];
    const r = computeDeployPerDollar(makeInput(deploys, { team_cohort_size: 4 }));
    expect(r.suppressed).toBe(true);
    expect(r.suppression_reason).toBe("k_anonymity");
  });

  test("<1 deploy/week → suppress has_deployment_signal=false", () => {
    // D60: HAS_DEPLOYMENT_SIGNAL false when repo has <3 deploys/30d or zero
    // distinct environments. repo_deploys_last_7d=0 forces the suppression.
    const deploys: DeploymentRecord[] = [];
    const r = computeDeployPerDollar(makeInput(deploys, { repo_deploys_last_7d: 0 }));
    expect(r.suppressed).toBe(true);
    expect(r.suppression_reason).toBe("insufficient_deploys");
  });

  test("zero matched deploys after filter → suppressed (no ∞ values)", () => {
    // denominator = 0 while repo_deploys_last_7d happens to be high — e.g.
    // all deploys filtered by environment.
    const deploys: DeploymentRecord[] = [{ ...base, environment: "staging", joined_pr_number: 1 }];
    const r = computeDeployPerDollar(makeInput(deploys, { repo_deploys_last_7d: 5 }));
    expect(r.suppressed).toBe(true);
    expect(Number.isFinite(r.raw)).toBe(true);
  });

  test("cost_usd=0 sessions → that deploy not in denominator (local-model fallback)", () => {
    // Mirrors D12 rule 4: local-model runs have cost_usd=0 → we can't
    // compute per-$, so the deploy joins zero cost. Skip but DON'T crash.
    const deploys: DeploymentRecord[] = [
      { ...base, deployment_id: "d-0", joined_pr_number: 1, merged_pr_cost_usd: 0 },
      {
        ...base,
        deployment_id: "d-1",
        sha: "b".repeat(40),
        joined_pr_number: 2,
        merged_pr_cost_usd: 15,
      },
      {
        ...base,
        deployment_id: "d-2",
        sha: "c".repeat(40),
        joined_pr_number: 3,
        merged_pr_cost_usd: 15,
      },
      {
        ...base,
        deployment_id: "d-3",
        sha: "d".repeat(40),
        joined_pr_number: 4,
        merged_pr_cost_usd: 15,
      },
    ];
    const r = computeDeployPerDollar(makeInput(deploys));
    expect(r.denominator_usd).toBeCloseTo(45, 6);
    expect(r.numerator).toBe(3); // the $0 deploy is excluded
    expect(r.excluded_cost_zero_count).toBe(1);
  });
});
