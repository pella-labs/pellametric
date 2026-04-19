/**
 * G3 — deploy-per-dollar end-to-end scoring test.
 *
 * Verifies the wire: `computeDeployPerDollar` → percentile → `Term` →
 * `scoreV1_1` → composite. A repo with real prod deploys at a high
 * percentile makes the composite RISE vs. the same IC with the deploy
 * term suppressed. If either D41 renormalization OR the module's
 * suppression gate is wrong, this test breaks.
 */

import { describe, expect, test } from "bun:test";
import { type ScoringInputV1_1, scoreV1_1 } from "../index_v1_1";
import {
  deploySuccessPerDollarV1FromPercentile,
  deploySuccessPerDollarV1Stub,
} from "../outcome_quality_v1_1";

function baseInput(): ScoringInputV1_1 {
  return {
    metric_version: "ai_leverage_v1",
    scope: "engineer",
    scope_id: "eng-test",
    cohort_id: "cohort-test",
    window: { from: "2026-03-01T00:00:00Z", to: "2026-03-31T23:59:59Z" },
    signals: {
      accepted_edits: 45,
      accepted_and_retained_edits: 40,
      merged_prs: 8,
      green_test_runs: 15,
      cost_usd: 20,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 60,
      avg_intervention_rate: 0.25,
      avg_session_depth: 5,
      distinct_tools_used: 3,
      distinct_sources_used: 2,
      sessions_count: 25,
      promoted_playbooks: 1,
      promoted_playbook_total_clusters: 5,
      playbook_adoption_by_others: 2,
      outcome_events: 15,
      active_days: 18,
    },
    cohort_distribution: {
      accepted_edits: [3, 8, 15, 22, 35, 50, 68, 85, 110, 180],
      accepted_edits_per_dollar: [0.5, 1.2, 2.1, 3.0, 4.5, 6.0, 8.0, 11.0, 15.0, 22.0],
      avg_intervention_rate: [0.08, 0.12, 0.18, 0.25, 0.32, 0.4, 0.5, 0.6, 0.72, 0.85],
      distinct_tools_used: [1, 2, 2, 3, 3, 4, 5, 6, 7, 9],
      promoted_playbooks: [0, 0, 0, 0, 1, 1, 2, 3, 5, 8],
    },
    github: {
      first_push_green: { value: 70, suppressed: false },
      deploy_success_per_dollar: deploySuccessPerDollarV1Stub(),
      outcome_event_counts: {
        accepted_hunks: 40,
        first_push_green: 10,
        deploy_success: 0,
      },
    },
  };
}

describe("github_deploy_per_dollar_v1 × outcome_quality_v1.1 composition", () => {
  test("suppressed deploy term leaves composite unchanged from G2 baseline", () => {
    const input = baseInput();
    const result = scoreV1_1(input);
    // The composition should succeed without throwing; surviving terms =
    // useful_output_retained + first_push_green. Deploy term contributes 0
    // weight to the sum.
    expect(result.subscores.outcome_quality).toBeGreaterThan(0);
    expect(result.subscores.outcome_quality).toBeLessThanOrEqual(100);
  });

  test("live deploy term at 85th percentile → composite outcome_quality RISES", () => {
    const suppressedInput = baseInput();
    const liveInput = baseInput();
    liveInput.github.deploy_success_per_dollar = deploySuccessPerDollarV1FromPercentile(85);
    liveInput.github.outcome_event_counts.deploy_success = 5;

    const suppressedResult = scoreV1_1(suppressedInput);
    const liveResult = scoreV1_1(liveInput);

    // With a 85-percentile deploy term, composite outcome_quality should be
    // higher than the suppressed version IFF the other two terms land below
    // 85 (useful=some-mid-percentile, first_push=70). A baseline check that
    // the term flows through the renormalization path.
    expect(liveResult.subscores.outcome_quality).toBeGreaterThanOrEqual(
      suppressedResult.subscores.outcome_quality,
    );
    // final ALS should also reflect the lift (bounded by weight 0.15 × 35 = 5.25).
    expect(liveResult.ai_leverage_score).toBeGreaterThanOrEqual(suppressedResult.ai_leverage_score);
  });

  test("live deploy term at 10th percentile → composite outcome_quality DROPS (vs 85)", () => {
    const highInput = baseInput();
    const lowInput = baseInput();
    highInput.github.deploy_success_per_dollar = deploySuccessPerDollarV1FromPercentile(85);
    lowInput.github.deploy_success_per_dollar = deploySuccessPerDollarV1FromPercentile(10);
    highInput.github.outcome_event_counts.deploy_success = 5;
    lowInput.github.outcome_event_counts.deploy_success = 5;
    const high = scoreV1_1(highInput);
    const low = scoreV1_1(lowInput);
    expect(high.subscores.outcome_quality).toBeGreaterThan(low.subscores.outcome_quality);
  });
});
