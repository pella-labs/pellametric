/**
 * G2 — GitHub fixture generator (PRD §12.4, D44).
 *
 * Produces 150 synthetic dev-month cases that exercise the 4 CORE GitHub
 * signals + D48 confidence union + D42 cohort stratification. Of those
 * 150, 100 are adversarial personas (8 types):
 *
 *   1. LOC-padding gamer         (×10)  — high accepts, huge LOC, mostly linguist-generated.
 *   2. CI-off repo               (×10)  — real productivity but no check_suites.
 *   3. Empty-push spammer        (×10)  — config-only pushes only.
 *   4. Junior in senior cohort   (×15)  — misstratified without the D42 cohort key.
 *   5. Backend vs frontend       (×15)  — different domains, similar productivity.
 *   6. Deploy-spam staging       (×10)  — deploys to staging, never prod.
 *   7. CI-flakiness-blamed       (×15)  — pushes failed but passed on re-run (D45).
 *   8. Revert-heavy high-LOC     (×15)  — useful_output_retained tanks.
 *
 * The remaining 50 cases are standard archetypes (~15 low, 20 avg, 10 high,
 * 5 new-hire) sampled from GitHub-aware signal distributions.
 *
 * Ground-truth methodology: we hand-craft each persona's signals to yield
 * a target ALS range (e.g. gamer → "should NOT score high"), then compute
 * `expected_final_als` by running the v1.1 scorer (oracle). The important
 * invariant is NOT "hit exactly N", it's "adversarial personas don't get
 * mislabeled" — verified by per-persona assertion tests in
 * `github_adversarial.test.ts`.
 *
 * Seeded LCG so re-runs produce byte-identical output.
 */

import type { ScoringInput } from "../../index";
import { type ScoringInputV1_1, scoreV1_1 } from "../index_v1_1";
import type { AuthorAssociation } from "../signals/github_author_association_v1";
import {
  computeFirstPushGreen,
  type FirstPushGreenInput,
} from "../signals/github_first_push_green_v1";
import type { FixtureCase } from "./schema";

export type GithubPersona =
  | "normal-low"
  | "normal-avg"
  | "normal-high"
  | "normal-new-hire"
  | "loc-padding-gamer"
  | "ci-off-repo"
  | "empty-push-spammer"
  | "junior-in-senior-cohort"
  | "backend-vs-frontend"
  | "deploy-spam-staging"
  | "ci-flakiness-blamed"
  | "revert-heavy-high-loc";

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

function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
function uniformInt(rng: () => number, min: number, max: number): number {
  return Math.floor(uniform(rng, min, max + 1));
}

interface GithubPersonaSpec {
  persona: GithubPersona;
  count: number;
  tag: "low-performer" | "average" | "high-leverage" | "new-hire" | "goodhart-gaming";
  sample: (rng: () => number) => GithubCaseSeed;
}

export interface GithubCaseSeed {
  signals: ScoringInput["signals"];
  first_push_green_input: FirstPushGreenInput;
  author_association: AuthorAssociation;
  codeowner_domain: string;
  /** If provided, override the first_push_green Term value/suppress directly. */
  first_push_green_override?: { value: number; suppressed: boolean };
  /** Always suppressed in G2 (G3 implements). */
  deploy_success_per_dollar: { value: number; suppressed: boolean };
  expected_persona_intent:
    | "score-low"
    | "score-average"
    | "score-high"
    | "score-new-hire-discounted"
    | "should-not-over-score"
    | "should-not-under-score";
}

const PERSONA_SPECS: GithubPersonaSpec[] = [
  // ----- Normal distribution (50) -----
  {
    persona: "normal-low",
    count: 15,
    tag: "low-performer",
    sample: (rng) => {
      const accepted = uniformInt(rng, 5, 20);
      const retained = Math.max(0, accepted - uniformInt(rng, 0, 3));
      return {
        signals: normalSignals(rng, accepted, retained, "low"),
        first_push_green_input: normalFirstPushInput(rng, "low"),
        author_association: pick(rng, ["CONTRIBUTOR", "COLLABORATOR"]),
        codeowner_domain: "frontend",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "score-low",
      };
    },
  },
  {
    persona: "normal-avg",
    count: 20,
    tag: "average",
    sample: (rng) => {
      const accepted = uniformInt(rng, 35, 65);
      const retained = Math.max(0, accepted - uniformInt(rng, 2, 8));
      return {
        signals: normalSignals(rng, accepted, retained, "avg"),
        first_push_green_input: normalFirstPushInput(rng, "avg"),
        author_association: "MEMBER",
        codeowner_domain: pick(rng, ["frontend", "backend", "infra"]),
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "score-average",
      };
    },
  },
  {
    persona: "normal-high",
    count: 10,
    tag: "high-leverage",
    sample: (rng) => {
      const accepted = uniformInt(rng, 90, 160);
      const retained = Math.max(0, accepted - uniformInt(rng, 0, 6));
      return {
        signals: normalSignals(rng, accepted, retained, "high"),
        first_push_green_input: normalFirstPushInput(rng, "high"),
        author_association: "MEMBER",
        codeowner_domain: pick(rng, ["frontend", "backend"]),
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "score-high",
      };
    },
  },
  {
    persona: "normal-new-hire",
    count: 5,
    tag: "new-hire",
    sample: (rng) => {
      const accepted = uniformInt(rng, 15, 28);
      const retained = Math.max(0, accepted - uniformInt(rng, 1, 4));
      const base = normalSignals(rng, accepted, retained, "new-hire");
      base.active_days = uniformInt(rng, 6, 11);
      base.outcome_events = uniformInt(rng, 3, 7);
      return {
        signals: base,
        first_push_green_input: normalFirstPushInput(rng, "avg"),
        author_association: "FIRST_TIME_CONTRIBUTOR",
        codeowner_domain: "generalist",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "score-new-hire-discounted",
      };
    },
  },
  // ----- Adversarial personas (100) -----
  {
    persona: "loc-padding-gamer",
    count: 10,
    tag: "goodhart-gaming",
    sample: (rng) => {
      // High accepted_edits but MOSTLY reverts — retained drops low.
      const accepted = uniformInt(rng, 150, 250);
      const retained = Math.round(accepted * uniform(rng, 0.1, 0.25));
      return {
        signals: goodhartSignals(rng, accepted, retained),
        first_push_green_input: normalFirstPushInput(rng, "avg"),
        author_association: "MEMBER",
        codeowner_domain: "frontend",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "should-not-over-score",
      };
    },
  },
  {
    persona: "ci-off-repo",
    count: 10,
    tag: "average",
    sample: (rng) => {
      // Productive IC on a repo with no CI. first_push_green MUST suppress.
      const accepted = uniformInt(rng, 40, 70);
      const retained = Math.max(0, accepted - uniformInt(rng, 2, 8));
      return {
        signals: normalSignals(rng, accepted, retained, "avg"),
        first_push_green_input: {
          pushes: [],
          repo_check_suites_last_7d: 0,
          team_cohort_size: 5,
        },
        first_push_green_override: { value: 0, suppressed: true },
        author_association: "MEMBER",
        codeowner_domain: "infra",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "should-not-under-score",
      };
    },
  },
  {
    persona: "empty-push-spammer",
    count: 10,
    tag: "goodhart-gaming",
    sample: (rng) => {
      // Pushes exist but all config-only → first_push_green should suppress
      // (insufficient non-config pushes). Accepts are low.
      const accepted = uniformInt(rng, 15, 30);
      const retained = Math.max(0, accepted - uniformInt(rng, 2, 6));
      return {
        signals: normalSignals(rng, accepted, retained, "low"),
        first_push_green_input: {
          pushes: Array.from({ length: 10 }, (_, i) => ({
            commit_sha: i.toString(16).padStart(40, "0"),
            pushed_at: "2026-04-10T10:00:00Z",
            non_config_file_changed: false,
            check_suite_completed_at: "2026-04-10T10:20:00Z",
            check_suite_conclusion: "success" as const,
            check_suite_attempt_passed_on_rerun_within_24h: false,
          })),
          repo_check_suites_last_7d: 10,
          team_cohort_size: 5,
        },
        first_push_green_override: { value: 0, suppressed: true },
        author_association: "CONTRIBUTOR",
        codeowner_domain: "generalist",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "should-not-over-score",
      };
    },
  },
  {
    persona: "junior-in-senior-cohort",
    count: 15,
    tag: "low-performer",
    sample: (rng) => {
      const accepted = uniformInt(rng, 12, 25);
      const retained = Math.max(0, accepted - uniformInt(rng, 1, 4));
      return {
        signals: normalSignals(rng, accepted, retained, "low"),
        first_push_green_input: normalFirstPushInput(rng, "avg"),
        author_association: "FIRST_TIME_CONTRIBUTOR",
        codeowner_domain: "backend",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "score-new-hire-discounted",
      };
    },
  },
  {
    persona: "backend-vs-frontend",
    count: 15,
    tag: "average",
    sample: (rng) => {
      const accepted = uniformInt(rng, 30, 60);
      const retained = Math.max(0, accepted - uniformInt(rng, 2, 7));
      return {
        signals: normalSignals(rng, accepted, retained, "avg"),
        first_push_green_input: normalFirstPushInput(rng, "avg"),
        author_association: "MEMBER",
        codeowner_domain: pick(rng, ["backend", "frontend"]),
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "score-average",
      };
    },
  },
  {
    persona: "deploy-spam-staging",
    count: 10,
    tag: "goodhart-gaming",
    sample: (rng) => {
      // Deploys exist but all to staging — deploy_success_per_dollar is
      // suppressed (prod allowlist in G3). Must not over-score.
      const accepted = uniformInt(rng, 20, 40);
      const retained = Math.max(0, accepted - uniformInt(rng, 2, 7));
      return {
        signals: normalSignals(rng, accepted, retained, "low"),
        first_push_green_input: normalFirstPushInput(rng, "avg"),
        author_association: "MEMBER",
        codeowner_domain: "infra",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "should-not-over-score",
      };
    },
  },
  {
    persona: "ci-flakiness-blamed",
    count: 15,
    tag: "average",
    sample: (rng) => {
      // 30% of pushes had a flaky red-then-green. With D45 they are
      // EXCLUDED. Without D45 they'd drag the IC's first_push_green down.
      const accepted = uniformInt(rng, 40, 70);
      const retained = Math.max(0, accepted - uniformInt(rng, 2, 8));
      const pushes = Array.from({ length: 10 }, (_, i) => ({
        commit_sha: i.toString(16).padStart(40, "0"),
        pushed_at: "2026-04-10T10:00:00Z",
        non_config_file_changed: true,
        check_suite_completed_at: "2026-04-10T10:20:00Z",
        check_suite_conclusion: (i < 3 ? "failure" : "success") as "success" | "failure",
        // Flaky on the 3 reds — all passed on re-run.
        check_suite_attempt_passed_on_rerun_within_24h: i < 3,
      }));
      return {
        signals: normalSignals(rng, accepted, retained, "avg"),
        first_push_green_input: {
          pushes,
          repo_check_suites_last_7d: 20,
          team_cohort_size: 8,
        },
        author_association: "MEMBER",
        codeowner_domain: "backend",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "should-not-under-score",
      };
    },
  },
  {
    persona: "revert-heavy-high-loc",
    count: 15,
    tag: "goodhart-gaming",
    sample: (rng) => {
      const accepted = uniformInt(rng, 100, 200);
      const retained = Math.round(accepted * uniform(rng, 0.2, 0.35));
      return {
        signals: goodhartSignals(rng, accepted, retained),
        first_push_green_input: normalFirstPushInput(rng, "low"),
        author_association: "MEMBER",
        codeowner_domain: "frontend",
        deploy_success_per_dollar: { value: 0, suppressed: true },
        expected_persona_intent: "should-not-over-score",
      };
    },
  },
];

function pick<T>(rng: () => number, arr: T[]): T {
  const i = Math.min(arr.length - 1, Math.floor(rng() * arr.length));
  return arr[i] as T;
}

function normalSignals(
  rng: () => number,
  accepted: number,
  retained: number,
  tier: "low" | "avg" | "high" | "new-hire",
): ScoringInput["signals"] {
  switch (tier) {
    case "low":
      return {
        accepted_edits: accepted,
        accepted_and_retained_edits: retained,
        merged_prs: uniformInt(rng, 1, 4),
        green_test_runs: uniformInt(rng, 2, 8),
        cost_usd: uniform(rng, 10, 30),
        pricing_version_at_capture: "2026-04-01",
        active_hours: uniform(rng, 20, 60),
        avg_intervention_rate: uniform(rng, 0.45, 0.7),
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
    case "avg":
      return {
        accepted_edits: accepted,
        accepted_and_retained_edits: retained,
        merged_prs: uniformInt(rng, 6, 14),
        green_test_runs: uniformInt(rng, 10, 28),
        cost_usd: uniform(rng, 10, 25),
        pricing_version_at_capture: "2026-04-01",
        active_hours: uniform(rng, 50, 80),
        avg_intervention_rate: uniform(rng, 0.2, 0.35),
        avg_session_depth: uniform(rng, 4.5, 7),
        distinct_tools_used: uniformInt(rng, 2, 4),
        distinct_sources_used: uniformInt(rng, 2, 3),
        sessions_count: uniformInt(rng, 22, 40),
        promoted_playbooks: uniformInt(rng, 0, 2),
        promoted_playbook_total_clusters: uniformInt(rng, 4, 8),
        playbook_adoption_by_others: uniformInt(rng, 0, 3),
        outcome_events: uniformInt(rng, 11, 18),
        active_days: uniformInt(rng, 13, 20),
      };
    case "high":
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
    case "new-hire":
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
  }
}

function goodhartSignals(
  rng: () => number,
  accepted: number,
  retained: number,
): ScoringInput["signals"] {
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
}

function normalFirstPushInput(
  rng: () => number,
  tier: "low" | "avg" | "high",
): FirstPushGreenInput {
  // Green rate tied to tier; all pushes are non-config, no flakiness.
  const count = uniformInt(rng, 8, 14);
  const passRate = tier === "high" ? 0.9 : tier === "avg" ? 0.7 : 0.4;
  const pushes = Array.from({ length: count }, (_, i) => ({
    commit_sha: i.toString(16).padStart(40, "0"),
    pushed_at: "2026-04-10T10:00:00Z",
    non_config_file_changed: true,
    check_suite_completed_at: "2026-04-10T10:20:00Z",
    check_suite_conclusion: (rng() < passRate ? "success" : "failure") as "success" | "failure",
    check_suite_attempt_passed_on_rerun_within_24h: false,
  }));
  return {
    pushes,
    repo_check_suites_last_7d: 20,
    team_cohort_size: 8,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Convert a seed → built ScoringInputV1_1 + derived first_push Term.
 */
function buildInputV1_1(seed: GithubCaseSeed): ScoringInputV1_1 {
  let firstPushTerm = seed.first_push_green_override;
  if (firstPushTerm === undefined) {
    const r = computeFirstPushGreen(seed.first_push_green_input);
    firstPushTerm = r.suppressed
      ? { value: 0, suppressed: true }
      : { value: Math.round(r.raw * 100), suppressed: false };
  }

  // Outcome-event counts for D48 confidence union.
  const firstPushOutcomes = seed.first_push_green_input.pushes.filter(
    (p) =>
      p.non_config_file_changed &&
      !p.check_suite_attempt_passed_on_rerun_within_24h &&
      p.check_suite_conclusion === "success",
  ).length;

  return {
    metric_version: "ai_leverage_v1",
    scope: "engineer",
    scope_id: `github_case`,
    cohort_id: "cohort_github",
    window: { from: "2026-03-01T00:00:00Z", to: "2026-03-31T23:59:59Z" },
    signals: seed.signals,
    cohort_distribution: SHARED_COHORT,
    github: {
      first_push_green: firstPushTerm,
      deploy_success_per_dollar: seed.deploy_success_per_dollar,
      outcome_event_counts: {
        accepted_hunks: seed.signals.accepted_and_retained_edits,
        first_push_green: firstPushOutcomes,
        deploy_success: 0,
      },
    },
    // Stash persona context for test-side assertions via a sidecar:
    // we use `scope_id` as the unique case id, persona is stored in the
    // FixtureCase metadata below.
    _author_association: seed.author_association,
    _codeowner_domain: seed.codeowner_domain,
  } as ScoringInputV1_1;
}

export interface GithubFixtureCase extends FixtureCase {
  persona: GithubPersona;
  expected_persona_intent: GithubCaseSeed["expected_persona_intent"];
  author_association: AuthorAssociation;
  codeowner_domain: string;
}

export function generateGithubCases(
  seed: number,
  idPrefix: string,
  countOverrides: Partial<Record<GithubPersona, number>> = {},
): GithubFixtureCase[] {
  const rng = makeRng(seed);
  const cases: GithubFixtureCase[] = [];
  for (const spec of PERSONA_SPECS) {
    const count = countOverrides[spec.persona] ?? spec.count;
    for (let i = 0; i < count; i++) {
      const seedCase = spec.sample(rng);
      const input = buildInputV1_1(seedCase);
      input.scope_id = `eng_${idPrefix}_${spec.persona}_${i.toString().padStart(3, "0")}`;
      const out = scoreV1_1(input);
      cases.push({
        case_id: `${idPrefix}_${spec.persona}_${i.toString().padStart(3, "0")}`,
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
        persona: spec.persona,
        expected_persona_intent: seedCase.expected_persona_intent,
        author_association: seedCase.author_association,
        codeowner_domain: seedCase.codeowner_domain,
        note: `GitHub persona ${spec.persona} (seed=${seed})`,
      });
    }
  }
  return cases;
}

export const GITHUB_PERSONA_COUNTS: Record<GithubPersona, number> = Object.fromEntries(
  PERSONA_SPECS.map((s) => [s.persona, s.count]),
) as Record<GithubPersona, number>;
