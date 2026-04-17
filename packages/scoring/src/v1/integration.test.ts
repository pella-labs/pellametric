import { describe, expect, test } from "bun:test";
import { type ScoringInput, score } from "../index";
import rollupSample from "./__fixtures__/rollup_sample.json" with { type: "json" };

/**
 * Integration test for h-scoring-prd §11.6 + §12.4.
 *
 * Reads the hand-written `dev_daily_rollup` sample (pending Jorge's CW-3
 * publish) through a small adapter into `score()`. When Jorge's real column
 * list lands, update `rollup_sample.json` AND the adapter below together.
 */

interface RollupRow {
  org_id: string;
  engineer_id_hash: string;
  day: string;
  sessions_count: number;
  active_hours: number;
  accepted_edits: number;
  accepted_and_retained_edits: number;
  cost_usd: number;
  pricing_version_at_capture: string;
  merged_prs: number;
  green_test_runs: number;
  avg_intervention_rate: number;
  avg_session_depth: number;
  distinct_tools_used: number;
  distinct_sources_used: number;
  promoted_playbooks: number;
  promoted_playbook_total_clusters: number;
  playbook_adoption_by_others: number;
  outcome_events: number;
  active_days: number;
}

function rollupToScoringInput(row: RollupRow): ScoringInput {
  return {
    metric_version: "ai_leverage_v1",
    scope: "engineer",
    scope_id: row.engineer_id_hash,
    cohort_id: `${row.org_id}:default`,
    window: { from: `${row.day}T00:00:00Z`, to: `${row.day}T23:59:59Z` },
    signals: {
      accepted_edits: row.accepted_edits,
      accepted_and_retained_edits: row.accepted_and_retained_edits,
      merged_prs: row.merged_prs,
      green_test_runs: row.green_test_runs,
      cost_usd: row.cost_usd,
      pricing_version_at_capture: row.pricing_version_at_capture,
      active_hours: row.active_hours,
      avg_intervention_rate: row.avg_intervention_rate,
      avg_session_depth: row.avg_session_depth,
      distinct_tools_used: row.distinct_tools_used,
      distinct_sources_used: row.distinct_sources_used,
      sessions_count: row.sessions_count,
      promoted_playbooks: row.promoted_playbooks,
      promoted_playbook_total_clusters: row.promoted_playbook_total_clusters,
      playbook_adoption_by_others: row.playbook_adoption_by_others,
      outcome_events: row.outcome_events,
      active_days: row.active_days,
    },
    // Sprint-1 placeholder cohort — in production, read via peer-row aggregation
    // (Jorge's CW-3/CW-4). Adequate to exercise the rollup → ScoringInput path.
    cohort_distribution: {
      accepted_edits: [10, 12, 15, 18, 20, 22, 25, 30],
      accepted_edits_per_dollar: [4, 5, 6, 7, 8, 9, 10, 11],
      avg_intervention_rate: [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45],
      distinct_tools_used: [1, 2, 3, 3, 4, 4, 5, 5],
      promoted_playbooks: [0, 0, 1, 1, 2, 2, 3, 3],
    },
  };
}

describe("integration — rollup_sample.json → score()", () => {
  test("translates the fixture row and returns a fully-shaped output", () => {
    const input = rollupToScoringInput(rollupSample as unknown as RollupRow);
    const out = score(input);
    expect(out.metric_version).toBe("ai_leverage_v1");
    expect(out.scope_id).toBe((rollupSample as unknown as RollupRow).engineer_id_hash);
    expect(Number.isFinite(out.ai_leverage_score)).toBe(true);
    expect(out.display.show).toBe(true);
  });
});
