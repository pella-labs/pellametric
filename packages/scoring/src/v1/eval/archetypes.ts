/**
 * Hand-curated archetype cases for the eval fixture.
 *
 * 10 cases across 6 archetypes. Each case is a full `ScoringInput` with raw
 * signals chosen to represent a specific scenario. `expected_final_als` /
 * `expected_confidence` / `expected_subscores` are populated by running the
 * production `score()` against the input — they are SNAPSHOTS, not independent
 * ground truth. The plan is: inspect each snapshot to confirm the number
 * lines up with the archetype's intent (low < avg < high; Goodhart LOW;
 * new-hire heavily confidence-discounted; etc.). Once confirmed, these
 * values become the regression-guard ground truth for `bun run test:scoring`.
 *
 * If ANY snapshot disagrees with the archetype intent, the production code
 * has a bug — that's the signal we want from this file.
 */

import type { ScoringInput } from "../../index";
import { score } from "../index";
import type { ArchetypeTag, FixtureCase } from "./schema";

const MIXED_ORG_COHORT = {
  accepted_edits: [3, 8, 15, 22, 35, 50, 68, 85, 110, 180],
  accepted_edits_per_dollar: [0.5, 1.2, 2.1, 3.0, 4.5, 6.0, 8.0, 11.0, 15.0, 22.0],
  avg_intervention_rate: [0.08, 0.12, 0.18, 0.25, 0.32, 0.4, 0.5, 0.6, 0.72, 0.85],
  distinct_tools_used: [1, 2, 2, 3, 3, 4, 5, 6, 7, 9],
  promoted_playbooks: [0, 0, 0, 0, 1, 1, 2, 3, 5, 8],
};

interface CaseSpec {
  case_id: string;
  archetype_tag: ArchetypeTag;
  signals: ScoringInput["signals"];
  note: string;
  tolerance?: { final_als?: number };
  cohort?: ScoringInput["cohort_distribution"];
  scope_id?: string;
}

function makeCase(spec: CaseSpec): FixtureCase {
  const input: ScoringInput = {
    metric_version: "ai_leverage_v1",
    scope: "engineer",
    scope_id: spec.scope_id ?? `eng_${spec.case_id}`,
    cohort_id: "cohort_mixed_org",
    window: { from: "2026-03-01T00:00:00Z", to: "2026-03-31T23:59:59Z" },
    signals: spec.signals,
    cohort_distribution: spec.cohort ?? MIXED_ORG_COHORT,
  };

  const out = score(input);

  const base: FixtureCase = {
    case_id: spec.case_id,
    archetype_tag: spec.archetype_tag,
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
    note: spec.note,
  };
  if (spec.tolerance !== undefined) base.tolerance = spec.tolerance;
  return base;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// -----------------------------------------------------------------------------
// The 10 hand-curated archetype cases.
// -----------------------------------------------------------------------------

export const ARCHETYPE_CASES: FixtureCase[] = [
  // --- low-performer (2 cases) ----------------------------------------------
  makeCase({
    case_id: "low_001",
    archetype_tag: "low-performer",
    note: "Contractor barely engaged — low activity AND low efficiency. Display gates will suppress in prod; scoring still produces a number.",
    signals: {
      accepted_edits: 5,
      accepted_and_retained_edits: 3,
      merged_prs: 1,
      green_test_runs: 2,
      cost_usd: 12.0,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 8,
      avg_intervention_rate: 0.65,
      avg_session_depth: 2.1,
      distinct_tools_used: 1,
      distinct_sources_used: 1,
      sessions_count: 4,
      promoted_playbooks: 0,
      promoted_playbook_total_clusters: 2,
      playbook_adoption_by_others: 0,
      outcome_events: 2,
      active_days: 3,
    },
  }),
  makeCase({
    case_id: "low_002",
    archetype_tag: "low-performer",
    note: "Chronic underperformer — full engagement, still lowest-quintile on every axis. Confidence stays at 1, raw subscores all ~p10–p20.",
    signals: {
      accepted_edits: 15,
      accepted_and_retained_edits: 12,
      merged_prs: 3,
      green_test_runs: 6,
      cost_usd: 26.0,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 55,
      avg_intervention_rate: 0.58,
      avg_session_depth: 3.0,
      distinct_tools_used: 2,
      distinct_sources_used: 1,
      sessions_count: 18,
      promoted_playbooks: 0,
      promoted_playbook_total_clusters: 5,
      playbook_adoption_by_others: 0,
      outcome_events: 10,
      active_days: 14,
    },
  }),

  // --- average (2 cases) -----------------------------------------------------
  makeCase({
    case_id: "avg_001",
    archetype_tag: "average",
    note: "Typical mid-level IC — steady output, mid-pack on every axis.",
    signals: {
      accepted_edits: 45,
      accepted_and_retained_edits: 40,
      merged_prs: 8,
      green_test_runs: 15,
      cost_usd: 18.5,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 62,
      avg_intervention_rate: 0.3,
      avg_session_depth: 5.2,
      distinct_tools_used: 3,
      distinct_sources_used: 2,
      sessions_count: 28,
      promoted_playbooks: 1,
      promoted_playbook_total_clusters: 6,
      playbook_adoption_by_others: 1,
      outcome_events: 12,
      active_days: 15,
    },
  }),
  makeCase({
    case_id: "avg_002",
    archetype_tag: "average",
    note: "Above-median IC on some axes, below on others — scores land near the middle of the distribution overall.",
    signals: {
      accepted_edits: 55,
      accepted_and_retained_edits: 48,
      merged_prs: 10,
      green_test_runs: 20,
      cost_usd: 12.0,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 70,
      avg_intervention_rate: 0.22,
      avg_session_depth: 6.8,
      distinct_tools_used: 4,
      distinct_sources_used: 2,
      sessions_count: 34,
      promoted_playbooks: 0,
      promoted_playbook_total_clusters: 5,
      playbook_adoption_by_others: 2,
      outcome_events: 14,
      active_days: 17,
    },
  }),

  // --- high-leverage (2 cases) ----------------------------------------------
  makeCase({
    case_id: "high_001",
    archetype_tag: "high-leverage",
    note: "Senior IC shipping outsized outcomes — low intervention, multi-tool, playbook author adopted by 6 others.",
    signals: {
      accepted_edits: 140,
      accepted_and_retained_edits: 132,
      merged_prs: 28,
      green_test_runs: 58,
      cost_usd: 22.0,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 110,
      avg_intervention_rate: 0.1,
      avg_session_depth: 8.4,
      distinct_tools_used: 7,
      distinct_sources_used: 4,
      sessions_count: 62,
      promoted_playbooks: 4,
      promoted_playbook_total_clusters: 7,
      playbook_adoption_by_others: 6,
      outcome_events: 32,
      active_days: 21,
    },
  }),
  makeCase({
    case_id: "high_002",
    archetype_tag: "high-leverage",
    note: "Staff IC — very high retention rate, low cost, moderate output — efficiency dimension dominates.",
    signals: {
      accepted_edits: 95,
      accepted_and_retained_edits: 92,
      merged_prs: 18,
      green_test_runs: 38,
      cost_usd: 8.5,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 88,
      avg_intervention_rate: 0.12,
      avg_session_depth: 7.5,
      distinct_tools_used: 5,
      distinct_sources_used: 3,
      sessions_count: 48,
      promoted_playbooks: 2,
      promoted_playbook_total_clusters: 6,
      playbook_adoption_by_others: 4,
      outcome_events: 24,
      active_days: 20,
    },
  }),

  // --- new-hire (1 case) -----------------------------------------------------
  makeCase({
    case_id: "new_001",
    archetype_tag: "new-hire",
    note: "Strong fundamentals but short window — confidence discount pulls final score down even though raw is decent.",
    tolerance: { final_als: 4 },
    signals: {
      accepted_edits: 22,
      accepted_and_retained_edits: 20,
      merged_prs: 3,
      green_test_runs: 6,
      cost_usd: 9.5,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 30,
      avg_intervention_rate: 0.35,
      avg_session_depth: 4.0,
      distinct_tools_used: 2,
      distinct_sources_used: 2,
      sessions_count: 14,
      promoted_playbooks: 0,
      promoted_playbook_total_clusters: 3,
      playbook_adoption_by_others: 0,
      outcome_events: 4,
      active_days: 8,
    },
  }),

  // --- regression-case (1 case) ---------------------------------------------
  // Same signals as avg_001 but older pricing_version_at_capture. D21 says
  // pricing drift must surface, not silent-recompute. final_als must match
  // avg_001 exactly.
  makeCase({
    case_id: "reg_001",
    archetype_tag: "regression-case",
    note: "Old pricing stamp, otherwise identical to avg_001. final_als must match avg_001 exactly — any drift means silent recomputation is leaking.",
    signals: {
      accepted_edits: 45,
      accepted_and_retained_edits: 40,
      merged_prs: 8,
      green_test_runs: 15,
      cost_usd: 18.5,
      pricing_version_at_capture: "2025-11-01",
      active_hours: 62,
      avg_intervention_rate: 0.3,
      avg_session_depth: 5.2,
      distinct_tools_used: 3,
      distinct_sources_used: 2,
      sessions_count: 28,
      promoted_playbooks: 1,
      promoted_playbook_total_clusters: 6,
      playbook_adoption_by_others: 1,
      outcome_events: 12,
      active_days: 15,
    },
  }),

  // --- goodhart-gaming (2 cases) --------------------------------------------
  makeCase({
    case_id: "game_001",
    archetype_tag: "goodhart-gaming",
    note: "High accepted_edits (180) but 80% reverts — retained=35. D12 rule 5 says efficiency uses RETAINED, so this should score LOW despite high raw accepted.",
    signals: {
      accepted_edits: 180,
      accepted_and_retained_edits: 35,
      merged_prs: 5,
      green_test_runs: 8,
      cost_usd: 45.0,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 75,
      avg_intervention_rate: 0.22,
      avg_session_depth: 6.0,
      distinct_tools_used: 3,
      distinct_sources_used: 2,
      sessions_count: 52,
      promoted_playbooks: 0,
      promoted_playbook_total_clusters: 8,
      playbook_adoption_by_others: 0,
      outcome_events: 18,
      active_days: 19,
    },
  }),
  makeCase({
    case_id: "game_002",
    archetype_tag: "goodhart-gaming",
    note: "Moderate accepted with aggressive reverts AND high intervention — the double-trouble Goodhart case.",
    signals: {
      accepted_edits: 95,
      accepted_and_retained_edits: 18,
      merged_prs: 3,
      green_test_runs: 5,
      cost_usd: 32.0,
      pricing_version_at_capture: "2026-04-01",
      active_hours: 58,
      avg_intervention_rate: 0.55,
      avg_session_depth: 4.8,
      distinct_tools_used: 2,
      distinct_sources_used: 2,
      sessions_count: 38,
      promoted_playbooks: 0,
      promoted_playbook_total_clusters: 6,
      playbook_adoption_by_others: 0,
      outcome_events: 14,
      active_days: 17,
    },
  }),
];

export const ARCHETYPE_CASES_BY_TAG: Record<ArchetypeTag, FixtureCase[]> = {
  "low-performer": ARCHETYPE_CASES.filter((c) => c.archetype_tag === "low-performer"),
  average: ARCHETYPE_CASES.filter((c) => c.archetype_tag === "average"),
  "high-leverage": ARCHETYPE_CASES.filter((c) => c.archetype_tag === "high-leverage"),
  "new-hire": ARCHETYPE_CASES.filter((c) => c.archetype_tag === "new-hire"),
  "regression-case": ARCHETYPE_CASES.filter((c) => c.archetype_tag === "regression-case"),
  "goodhart-gaming": ARCHETYPE_CASES.filter((c) => c.archetype_tag === "goodhart-gaming"),
};
