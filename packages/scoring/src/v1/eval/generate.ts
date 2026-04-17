/**
 * Snapshot fixture generator — seeded RNG, deterministic output.
 *
 * Produces `FixtureCase`s by sampling raw signals from calibrated distributions
 * and running the production `score()` to compute expected values. These are
 * SNAPSHOTS — they guard against regressions in `packages/scoring`, not against
 * spec misinterpretation. Spec misinterpretation is caught by the hand-curated
 * archetype cases in `archetypes.ts`.
 *
 * Seeded LCG (no `Math.random`) so re-runs produce byte-identical output.
 * Any change to seed, count, or sampling ranges is a deliberate act —
 * commit and re-snapshot.
 */

import type { ScoringInput } from "../../index";
import { score } from "../index";
import type { ArchetypeTag, FixtureCase } from "./schema";

const SHARED_COHORT = {
  accepted_edits: [3, 8, 15, 22, 35, 50, 68, 85, 110, 180],
  accepted_edits_per_dollar: [0.5, 1.2, 2.1, 3.0, 4.5, 6.0, 8.0, 11.0, 15.0, 22.0],
  avg_intervention_rate: [0.08, 0.12, 0.18, 0.25, 0.32, 0.4, 0.5, 0.6, 0.72, 0.85],
  distinct_tools_used: [1, 2, 2, 3, 3, 4, 5, 6, 7, 9],
  promoted_playbooks: [0, 0, 0, 0, 1, 1, 2, 3, 5, 8],
};

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Uniform real in [min, max). */
function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform integer in [min, max]. */
function uniformInt(rng: () => number, min: number, max: number): number {
  return Math.floor(uniform(rng, min, max + 1));
}

/** Log-normal sample approximating heavy-tail distribution of count fields. */
function logNormal(rng: () => number, mu: number, sigma: number): number {
  // Box–Muller for standard normal, then exp.
  const u1 = rng() || 1e-9;
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mu + sigma * z);
}

interface ArchetypeSpec {
  tag: ArchetypeTag;
  /** Relative share of the output — used to split `count`. */
  share: number;
  sample: (rng: () => number) => ScoringInput["signals"];
}

const ARCHETYPE_SAMPLERS: ArchetypeSpec[] = [
  {
    tag: "low-performer",
    share: 0.15,
    sample: (rng) => {
      const accepted = uniformInt(rng, 5, 20);
      const retained = Math.max(0, accepted - uniformInt(rng, 0, 3));
      return {
        accepted_edits: accepted,
        accepted_and_retained_edits: retained,
        merged_prs: uniformInt(rng, 1, 4),
        green_test_runs: uniformInt(rng, 2, 8),
        cost_usd: uniform(rng, 8, 30),
        pricing_version_at_capture: "2026-04-01",
        active_hours: uniform(rng, 15, 55),
        avg_intervention_rate: uniform(rng, 0.45, 0.75),
        avg_session_depth: uniform(rng, 2, 4),
        distinct_tools_used: uniformInt(rng, 1, 2),
        distinct_sources_used: uniformInt(rng, 1, 2),
        sessions_count: uniformInt(rng, 10, 22),
        promoted_playbooks: 0,
        promoted_playbook_total_clusters: uniformInt(rng, 2, 6),
        playbook_adoption_by_others: 0,
        outcome_events: uniformInt(rng, 5, 12),
        active_days: uniformInt(rng, 10, 15),
      };
    },
  },
  {
    tag: "average",
    share: 0.5,
    sample: (rng) => {
      const accepted = Math.round(logNormal(rng, 3.7, 0.4)); // ~30–70
      const retained = Math.max(0, accepted - uniformInt(rng, 2, 8));
      return {
        accepted_edits: accepted,
        accepted_and_retained_edits: retained,
        merged_prs: uniformInt(rng, 5, 14),
        green_test_runs: uniformInt(rng, 10, 28),
        cost_usd: uniform(rng, 10, 25),
        pricing_version_at_capture: "2026-04-01",
        active_hours: uniform(rng, 50, 80),
        avg_intervention_rate: uniform(rng, 0.2, 0.38),
        avg_session_depth: uniform(rng, 4.5, 7.5),
        distinct_tools_used: uniformInt(rng, 2, 4),
        distinct_sources_used: uniformInt(rng, 2, 3),
        sessions_count: uniformInt(rng, 20, 40),
        promoted_playbooks: uniformInt(rng, 0, 2),
        promoted_playbook_total_clusters: uniformInt(rng, 4, 8),
        playbook_adoption_by_others: uniformInt(rng, 0, 3),
        outcome_events: uniformInt(rng, 10, 18),
        active_days: uniformInt(rng, 13, 20),
      };
    },
  },
  {
    tag: "high-leverage",
    share: 0.2,
    sample: (rng) => {
      const accepted = Math.round(logNormal(rng, 4.5, 0.3)); // ~80–150
      const retained = Math.max(0, accepted - uniformInt(rng, 0, 6));
      return {
        accepted_edits: accepted,
        accepted_and_retained_edits: retained,
        merged_prs: uniformInt(rng, 18, 32),
        green_test_runs: uniformInt(rng, 35, 65),
        cost_usd: uniform(rng, 8, 25),
        pricing_version_at_capture: "2026-04-01",
        active_hours: uniform(rng, 85, 120),
        avg_intervention_rate: uniform(rng, 0.08, 0.18),
        avg_session_depth: uniform(rng, 7, 10),
        distinct_tools_used: uniformInt(rng, 5, 8),
        distinct_sources_used: uniformInt(rng, 3, 5),
        sessions_count: uniformInt(rng, 45, 70),
        promoted_playbooks: uniformInt(rng, 2, 5),
        promoted_playbook_total_clusters: uniformInt(rng, 5, 8),
        playbook_adoption_by_others: uniformInt(rng, 3, 8),
        outcome_events: uniformInt(rng, 22, 35),
        active_days: uniformInt(rng, 18, 22),
      };
    },
  },
  {
    tag: "new-hire",
    share: 0.1,
    sample: (rng) => {
      const accepted = uniformInt(rng, 15, 30);
      const retained = Math.max(0, accepted - uniformInt(rng, 1, 4));
      return {
        accepted_edits: accepted,
        accepted_and_retained_edits: retained,
        merged_prs: uniformInt(rng, 2, 5),
        green_test_runs: uniformInt(rng, 4, 10),
        cost_usd: uniform(rng, 7, 15),
        pricing_version_at_capture: "2026-04-01",
        active_hours: uniform(rng, 20, 45),
        avg_intervention_rate: uniform(rng, 0.3, 0.45),
        avg_session_depth: uniform(rng, 3.5, 5),
        distinct_tools_used: uniformInt(rng, 2, 3),
        distinct_sources_used: uniformInt(rng, 1, 2),
        sessions_count: uniformInt(rng, 12, 20),
        promoted_playbooks: 0,
        promoted_playbook_total_clusters: uniformInt(rng, 2, 5),
        playbook_adoption_by_others: 0,
        outcome_events: uniformInt(rng, 3, 7),
        active_days: uniformInt(rng, 6, 12),
      };
    },
  },
  {
    tag: "goodhart-gaming",
    share: 0.05,
    sample: (rng) => {
      const accepted = uniformInt(rng, 80, 200);
      // Revert rate 60–85%.
      const retained = Math.round(accepted * uniform(rng, 0.15, 0.4));
      return {
        accepted_edits: accepted,
        accepted_and_retained_edits: retained,
        merged_prs: uniformInt(rng, 3, 7),
        green_test_runs: uniformInt(rng, 5, 12),
        cost_usd: uniform(rng, 30, 55),
        pricing_version_at_capture: "2026-04-01",
        active_hours: uniform(rng, 55, 85),
        avg_intervention_rate: uniform(rng, 0.25, 0.55),
        avg_session_depth: uniform(rng, 4.5, 6.5),
        distinct_tools_used: uniformInt(rng, 2, 4),
        distinct_sources_used: uniformInt(rng, 1, 3),
        sessions_count: uniformInt(rng, 35, 55),
        promoted_playbooks: 0,
        promoted_playbook_total_clusters: uniformInt(rng, 5, 9),
        playbook_adoption_by_others: 0,
        outcome_events: uniformInt(rng, 12, 22),
        active_days: uniformInt(rng, 15, 22),
      };
    },
  },
];

/**
 * Generate `count` snapshot cases with seeded RNG. Archetype distribution
 * matches `ARCHETYPE_SAMPLERS[*].share`.
 */
export function generateCases(seed: number, count: number): FixtureCase[] {
  const rng = makeRng(seed);
  const cases: FixtureCase[] = [];

  // Compute per-archetype quota.
  const quotas = ARCHETYPE_SAMPLERS.map((a) => Math.round(a.share * count));
  // Fix rounding drift by assigning the remainder to `average` (index 1).
  const quotaSum = quotas.reduce((a, b) => a + b, 0);
  const averageIdx = 1;
  quotas[averageIdx] = (quotas[averageIdx] ?? 0) + (count - quotaSum);

  for (let a = 0; a < ARCHETYPE_SAMPLERS.length; a++) {
    const spec = ARCHETYPE_SAMPLERS[a];
    const quota = quotas[a] ?? 0;
    if (spec === undefined) continue;
    for (let i = 0; i < quota; i++) {
      const signals = spec.sample(rng);
      const input: ScoringInput = {
        metric_version: "ai_leverage_v1",
        scope: "engineer",
        scope_id: `eng_gen_${spec.tag}_${i.toString().padStart(3, "0")}`,
        cohort_id: "cohort_mixed_org",
        window: { from: "2026-03-01T00:00:00Z", to: "2026-03-31T23:59:59Z" },
        signals,
        cohort_distribution: SHARED_COHORT,
      };
      const out = score(input);
      cases.push({
        case_id: `gen_${spec.tag}_${i.toString().padStart(3, "0")}`,
        archetype_tag: spec.tag,
        input,
        expected_final_als: round1(out.ai_leverage_score),
        expected_confidence: round3(out.confidence),
        expected_subscores: {
          outcome_quality: round1(out.subscores.outcome_quality),
          efficiency: round1(out.subscores.efficiency),
          autonomy: round1(out.subscores.autonomy),
          adoption_depth: round1(out.subscores.adoption_depth),
          team_impact: round1(out.subscores.team_impact),
        },
        note: `Auto-generated snapshot (seed=${seed}).`,
      });
    }
  }

  return cases;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
