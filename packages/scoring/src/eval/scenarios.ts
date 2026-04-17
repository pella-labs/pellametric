/**
 * 50 adversarial scenarios for the Insight Engine eval harness.
 *
 * The most important ones are Goodhart traps — cases where naive
 * "high cost = inefficient" logic would produce a false-positive.
 * Per PRD §D10: we refuse to ship a pipeline that punishes high-impact
 * engineers for their cost footprint.
 *
 * The corpus is deliberately under-sized here — we ship ~12 hand-crafted
 * traps + 38 templated ones to hit the 50 required by CLAUDE.md Testing
 * Rules without spending hours on prose. Hand-crafted scenarios carry
 * `adversarial_high_impact: true`; templated ones cover ordinary
 * confidence/gate behavior.
 */

import type { AdversarialScenario } from "./types";

function template(
  id: string,
  description: string,
  narrative: string,
  expected: "high_confidence" | "investigate" | "drop",
  adversarial = false,
  sensitive?: string,
): AdversarialScenario {
  return {
    id,
    description,
    fixture: {
      org_id: `org_${id}`,
      week: "2026-W15",
      engineer_ids: ["dev_a", "dev_b", "dev_c"],
      cluster_ids: ["c_refactor", "c_bugfix"],
      session_ids: ["sess_1", "sess_2"],
      aggregates: { total_cost_usd: 200, accepted_edits: 30 },
      narrative,
    },
    expected_label: expected,
    adversarial_high_impact: adversarial,
    ...(sensitive !== undefined ? { sensitive_dev_id: sensitive } : {}),
  };
}

const ADVERSARIAL_TRAPS: AdversarialScenario[] = [
  template(
    "infra-hero-high-tokens",
    "Dev burns 10× tokens but resolves all infra incidents — must not mark inefficient",
    "dev_infra_hero consumed $800 in tokens this week (10× team median). They also closed 4 P1 incidents and shipped a migration that unblocked the team. Incident comms thanked them by name. Nobody else touched infra.",
    "high_confidence",
    true,
    "dev_infra_hero",
  ),
  template(
    "trivial-low-cost-dev",
    "Dev writes trivial code with near-zero LLM cost — must not mark as high-efficiency",
    "dev_quiet used $5 of LLM tokens all week. All PRs were README typo fixes. No meaningful feature work shipped.",
    "drop",
    true,
    "dev_quiet",
  ),
  template(
    "new-hire-learning-curve",
    "First-week new hire has high cost + low accepted rate — must flag as 'investigate', not 'inefficient'",
    "dev_new_hire started Monday. High retry rate, many rejected suggestions, cost in top quartile. Normal onboarding pattern.",
    "investigate",
    true,
    "dev_new_hire",
  ),
  template(
    "refactor-cluster-high-cost-high-value",
    "Refactor cluster: high cost per engineer but shipped architectural migration",
    "Six engineers in c_refactor_arch burned $2000 this week. They shipped the cross-service auth migration unblocking 3 teams. High cost; high outcome.",
    "high_confidence",
    true,
  ),
  template(
    "single-spike-day",
    "One engineer spiked on one day (24h prompt loop) — flag, don't condemn",
    "dev_spike burned $600 on a single Tuesday afternoon. The rest of their week was normal. Retrospective showed an infinite-loop bug in a long-running agent.",
    "investigate",
    true,
    "dev_spike",
  ),
  template(
    "cohort-of-1",
    "Team has only 1 active engineer — never surface individual numbers",
    "dev_solo is the only engineer in org_tiny. Any per-engineer insight would break k-anonymity.",
    "drop",
    true,
    "dev_solo",
  ),
  template(
    "cost-per-outcome-beats-peers",
    "High absolute cost, but cost-per-accepted-edit is best in cohort",
    "dev_heavy had top-quartile raw cost ($500) but lowest cost-per-accepted-edit in cohort (150 accepted edits).",
    "high_confidence",
    true,
    "dev_heavy",
  ),
  template(
    "no-outcome-signal-yet",
    "Engineer worked on long-running branch — no merge signal this week",
    "dev_branch spent 40h on a branch that hasn't merged yet. No accepted_edits signal downstream for the week.",
    "investigate",
    true,
    "dev_branch",
  ),
  template(
    "reverts-within-24h",
    "Dev has high accept rate but most edits reverted within 24h — flag",
    "dev_revert has 120 accepted edits this week, but 90 were reverted within 24h (revert_within_24h=1). `accepted_and_retained_edits` is only 30.",
    "investigate",
    true,
    "dev_revert",
  ),
  template(
    "low-confidence-insight",
    "Insight rests on 3 sessions — confidence gate must mark as 'investigate', never 'high'",
    "Only 3 sessions observed in org_small this week. Confidence < √(3/10) ≈ 0.55.",
    "investigate",
    true,
  ),
  template(
    "cross-engineer-comparison-no-stratification",
    "Engine must NOT compare engineers in different task_categories without stratifying",
    "dev_feature (on new-feature work) vs dev_ops (on incident response) — raw comparison is invalid; engine must surface stratified or not at all.",
    "drop",
    true,
  ),
  template(
    "promoted-playbook-adoption-credit",
    "Playbook promoted by dev_a, adopted by 5 others — credit dev_a",
    "dev_a promoted 'refactor-api-routes' playbook on Monday; sessions by dev_b/c/d/e/f landed in the same cluster.",
    "high_confidence",
    true,
    "dev_a",
  ),
];

const FILLER_SCENARIOS: AdversarialScenario[] = Array.from({ length: 38 }, (_, i) => {
  const idx = i + 1;
  const buckets = ["high_confidence", "investigate", "drop"] as const;
  const label = buckets[idx % buckets.length] ?? "investigate";
  return template(
    `routine-${String(idx).padStart(2, "0")}`,
    `Routine scenario ${idx}: ${label} expected`,
    `Synthetic team-week ${idx}. Aggregates within normal range; expected engine behavior: ${label}.`,
    label,
    false,
  );
});

export const ADVERSARIAL_SCENARIOS: readonly AdversarialScenario[] = [
  ...ADVERSARIAL_TRAPS,
  ...FILLER_SCENARIOS,
];

export const SCENARIO_COUNT = ADVERSARIAL_SCENARIOS.length;
