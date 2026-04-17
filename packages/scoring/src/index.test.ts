import { describe, expect, test } from "bun:test";
import { type ScoringInput, type ScoringOutput, score } from "./index";

/**
 * Sprint-1 unit tests for the v0 `score()` stub. These tests assert the
 * output *shape* and invariants that must hold across every future
 * `ai_leverage_v1` refinement — they are NOT assertions about specific
 * numeric scoring behavior (that's Sprint-2 eval territory).
 */

function makeInput(overrides?: Partial<ScoringInput["signals"]>): ScoringInput {
  return {
    metric_version: "ai_leverage_v1",
    scope: "engineer",
    scope_id: "eng_fixture",
    cohort_id: "cohort_fixture",
    window: { from: "2026-04-08T00:00:00Z", to: "2026-04-15T00:00:00Z" },
    signals: {
      accepted_edits: 20,
      accepted_and_retained_edits: 18,
      merged_prs: 2,
      green_test_runs: 5,
      cost_usd: 2.0,
      pricing_version_at_capture: "litellm-2026.04.10",
      active_hours: 4.0,
      avg_intervention_rate: 0.2,
      avg_session_depth: 10,
      distinct_tools_used: 3,
      distinct_sources_used: 2,
      sessions_count: 12,
      promoted_playbooks: 1,
      promoted_playbook_total_clusters: 2,
      playbook_adoption_by_others: 1,
      outcome_events: 7,
      active_days: 6,
      ...overrides,
    },
    cohort_distribution: {
      accepted_edits: [10, 12, 15, 18, 20, 22, 25, 30],
      accepted_edits_per_dollar: [4, 5, 6, 7, 8, 9, 10, 11],
      avg_intervention_rate: [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45],
      distinct_tools_used: [1, 2, 3, 3, 4, 4, 5, 5],
      promoted_playbooks: [0, 0, 1, 1, 2, 2, 3, 3],
    },
  };
}

function assertFullShape(o: ScoringOutput): void {
  expect(o.metric_version).toBe("ai_leverage_v1");
  expect(typeof o.scope_id).toBe("string");
  expect(typeof o.ai_leverage_score).toBe("number");
  expect(typeof o.raw_ai_leverage).toBe("number");
  expect(typeof o.confidence).toBe("number");
  expect(o.subscores).toBeDefined();
  expect(typeof o.subscores.outcome_quality).toBe("number");
  expect(typeof o.subscores.efficiency).toBe("number");
  expect(typeof o.subscores.autonomy).toBe("number");
  expect(typeof o.subscores.adoption_depth).toBe("number");
  expect(typeof o.subscores.team_impact).toBe("number");
  expect(o.display).toBeDefined();
  expect(typeof o.display.show).toBe("boolean");
  expect(Array.isArray(o.display.failed_gates)).toBe(true);
  expect(typeof o.display.raw_subscores_available).toBe("boolean");
  expect(typeof o.pricing_version_drift).toBe("boolean");
  expect(typeof o.inputs_hash).toBe("string");
  expect(o.inputs_hash.length).toBe(64); // sha256 hex
}

describe("score()", () => {
  test("returns a fully-shaped ScoringOutput for a typical input", () => {
    const out = score(makeInput());
    assertFullShape(out);
  });

  test("is deterministic — same input returns same output", () => {
    const input = makeInput();
    const a = score(input);
    const b = score(input);
    expect(a).toEqual(b);
  });

  test("local-model fallback (cost_usd=0) produces no NaN / no Infinity", () => {
    const out = score(makeInput({ cost_usd: 0 }));
    const values = [
      out.ai_leverage_score,
      out.raw_ai_leverage,
      out.confidence,
      out.subscores.outcome_quality,
      out.subscores.efficiency,
      out.subscores.autonomy,
      out.subscores.adoption_depth,
      out.subscores.team_impact,
    ];
    for (const v of values) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  test("Sprint-1 stub sets display.show = true", () => {
    const out = score(makeInput());
    expect(out.display.show).toBe(true);
    expect(out.display.failed_gates).toEqual([]);
  });

  test("metric_version pinned to ai_leverage_v1", () => {
    const out = score(makeInput());
    expect(out.metric_version).toBe("ai_leverage_v1");
  });
});
