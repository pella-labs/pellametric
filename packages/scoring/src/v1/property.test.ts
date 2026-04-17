import { describe, expect, test } from "bun:test";
import { type ScoringInput, score } from "../index";

/**
 * Sprint-1 property-based tests — plain for-loops, no new deps. 100 random
 * iterations each per h-scoring-prd §12.4. Sprint-2 expands to 1000 and adds
 * fast-check or similar once added to `devDependencies`.
 */

// Deterministic seeded RNG — we do NOT use Math.random() so test reruns are
// reproducible (a flaky property test that only fails in CI is worse than no
// test). Linear congruential generator; simple, good enough for fixture fuzz.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randomInput(rng: () => number): ScoringInput {
  const r = (min: number, max: number): number => min + rng() * (max - min);
  const cohortLen = Math.max(1, Math.floor(rng() * 20));
  const cohortOf = (lo: number, hi: number): number[] =>
    Array.from({ length: cohortLen }, () => r(lo, hi));
  return {
    metric_version: "ai_leverage_v1",
    scope: rng() > 0.5 ? "engineer" : "team",
    scope_id: `scope_${Math.floor(rng() * 1e6)}`,
    cohort_id: `cohort_${Math.floor(rng() * 1e6)}`,
    window: { from: "2026-04-01T00:00:00Z", to: "2026-04-08T00:00:00Z" },
    signals: {
      accepted_edits: Math.floor(r(0, 200)),
      accepted_and_retained_edits: Math.floor(r(0, 200)),
      merged_prs: Math.floor(r(0, 20)),
      green_test_runs: Math.floor(r(0, 50)),
      cost_usd: rng() > 0.2 ? r(0, 50) : 0, // exercise the cost_usd=0 fallback
      pricing_version_at_capture: "litellm-2026.04.10",
      active_hours: r(0, 40),
      avg_intervention_rate: r(0, 1),
      avg_session_depth: r(0, 30),
      distinct_tools_used: Math.floor(r(0, 10)),
      distinct_sources_used: Math.floor(r(0, 5)),
      sessions_count: Math.floor(r(0, 50)),
      promoted_playbooks: Math.floor(r(0, 5)),
      promoted_playbook_total_clusters: Math.floor(r(0, 10)),
      playbook_adoption_by_others: Math.floor(r(0, 10)),
      outcome_events: Math.floor(r(0, 30)),
      active_days: Math.floor(r(0, 14)),
    },
    cohort_distribution: {
      accepted_edits: cohortOf(0, 200),
      accepted_edits_per_dollar: cohortOf(0, 50),
      avg_intervention_rate: cohortOf(0, 1),
      distinct_tools_used: cohortOf(0, 10),
      promoted_playbooks: cohortOf(0, 5),
    },
  };
}

describe("score() properties", () => {
  test("determinism — same input replayed 100 times returns identical output", () => {
    const rng = makeRng(42);
    for (let i = 0; i < 100; i++) {
      const input = randomInput(rng);
      const a = score(input);
      const b = score(input);
      expect(a).toEqual(b);
    }
  });

  test("bounds — score subscores in [0, 100], confidence in [0, 1]", () => {
    const rng = makeRng(1337);
    for (let i = 0; i < 100; i++) {
      const out = score(randomInput(rng));
      expect(out.ai_leverage_score).toBeGreaterThanOrEqual(0);
      expect(out.ai_leverage_score).toBeLessThanOrEqual(100);
      expect(out.raw_ai_leverage).toBeGreaterThanOrEqual(0);
      expect(out.raw_ai_leverage).toBeLessThanOrEqual(100);
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(1);
      for (const v of Object.values(out.subscores)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  test("no NaN, no Infinity anywhere in the output", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 100; i++) {
      const out = score(randomInput(rng));
      const numericFields = [
        out.ai_leverage_score,
        out.raw_ai_leverage,
        out.confidence,
        ...Object.values(out.subscores),
      ];
      for (const v of numericFields) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
