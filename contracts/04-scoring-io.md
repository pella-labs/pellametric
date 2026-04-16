# 04 — Scoring I/O

**Status:** draft
**Owners:** Workstream H (scoring & AI)
**Consumers:** E (manager dashboard reads outputs), C (ingest writes the input rollups via materialized views)
**Last touched:** 2026-04-16

## Purpose

`packages/scoring` is pure, deterministic, eval-gated math. It takes pre-aggregated event rollups (from ClickHouse materialized views) and produces the AI Leverage Score + 5 visible subscores per (engineer, week) and per (team, week). Locked math = `ai_leverage_v1`; future versions ship as `_v2`/`_v3` with explicit metric versioning.

This contract pins the function signature and the input/output shapes. **The math itself is in `packages/scoring/v1/`** and gated by the 500-case eval (MAE ≤ 3, no outlier > 10).

## Function shape

```ts
// packages/scoring/index.ts (draft)
export interface ScoringInput {
  metric_version: "ai_leverage_v1";   // pins the codepath; bump when adding v2
  scope: "engineer" | "team";
  scope_id: string;                   // engineer_id (hashed) OR team_id
  cohort_id: string;                  // peer cohort for normalization
  window: { from: string; to: string }; // ISO 8601 UTC

  // Aggregates from ClickHouse `dev_daily_rollup` / `team_weekly_rollup`
  signals: {
    // Outcome Quality (35%)
    accepted_edits: number;
    accepted_and_retained_edits: number;  // not reverted within 24h
    merged_prs: number;
    green_test_runs: number;

    // Efficiency (25%)
    cost_usd: number;
    pricing_version_at_capture: string;
    active_hours: number;                 // session-derived, not wall-clock
    accepted_edits_per_dollar?: number;   // null if cost_usd=0 (local model fallback)

    // Autonomy (20%)
    avg_intervention_rate: number;        // 0..1; lower = more autonomous
    avg_session_depth: number;            // mean tool-call count per session

    // Adoption Depth (10%)
    distinct_tools_used: number;
    distinct_sources_used: number;        // claude-code + cursor + continue → 3
    sessions_count: number;

    // Team Impact (10%)
    promoted_playbooks: number;
    promoted_playbook_total_clusters: number;
    playbook_adoption_by_others: number;  // distinct OTHER ICs; capped at 10

    // Confidence inputs
    outcome_events: number;
    active_days: number;
  };

  // Cohort distribution (for percentile-rank step)
  cohort_distribution: {
    accepted_edits: number[];
    accepted_edits_per_dollar: number[];
    avg_intervention_rate: number[];
    distinct_tools_used: number[];
    promoted_playbooks: number[];
  };
}

export interface ScoringOutput {
  metric_version: "ai_leverage_v1";
  scope: "engineer" | "team";
  scope_id: string;
  window: { from: string; to: string };

  /** Final shipped number, 0..100. */
  ai_leverage_score: number;
  /** Pre-confidence-multiplier value, for transparency. */
  raw_ai_leverage: number;
  /** 0..1; final = raw * confidence. */
  confidence: number;

  subscores: {
    outcome_quality: number;     // weight 0.35
    efficiency: number;          // weight 0.25
    autonomy: number;            // weight 0.20
    adoption_depth: number;      // weight 0.10
    team_impact: number;         // weight 0.10
  };

  /** Provenance: which gate failed, if the tile shouldn't render. */
  display: {
    show: boolean;
    suppression_reason?:
      | "insufficient_sessions"          // < 10
      | "insufficient_active_days"       // < 5
      | "insufficient_outcome_events"    // < 3
      | "insufficient_cohort"            // < 8 peers
      | "k_anonymity_floor";             // team tile with k<5
    failed_gates: string[];              // for the "insufficient data — gate X" UI
  };

  /** For the dashboard banner when pricing changed mid-window. */
  pricing_version_drift: boolean;

  /** Audit trail — every input that fed this number. */
  inputs_hash: string;                   // sha256 of ScoringInput
}

export function score(input: ScoringInput): ScoringOutput;
```

## The math (locked, `ai_leverage_v1`)

Five steps, in order. Implemented in `packages/scoring/v1/`. **Cannot be reordered or substituted without bumping to `_v2`.**

1. **Raw subscores** from primary signals (formulas in `packages/scoring/v1/subscores.ts`).
2. **Cohort-normalize:** winsorize at p5/p95, then percentile-rank within cohort.
3. **Weighted composite:** `raw_ALS = 0.35·OQ + 0.25·EFF + 0.20·AUT + 0.10·AD + 0.10·TI`.
4. **Confidence:** `confidence = min(1, √(outcome_events/10)) · min(1, √(active_days/10))`.
5. **Final:** `final_ALS = raw_ALS · confidence`.

## `useful_output_v1 = accepted_code_edits_per_dollar` (D12)

Six locked rules; live in `packages/scoring/v1/useful_output.ts`:

1. Dedup unit: `(session_id, hunk_sha256)`. Same hunk in same session counts once.
2. Denominator window: same `session_id`. Cross-session is `_v2` territory.
3. Unit: USD normalized at `pricing_version_at_capture`. Pricing-version shifts → dashboard banner; **never silent recomputation**.
4. Local-model fallback: if `cost_usd=0`, the tile suppresses `accepted_edits_per_dollar` and renders `accepted_edits_per_active_hour` instead. **No ∞ values, ever.**
5. Revert penalty: hunks reverted within 24h subtracted from numerator; companion metric `accepted_and_retained_edits_per_dollar` is computed separately.
6. Noise floor: sessions with `accepted_edits < 3` excluded entirely.

## Display gates

A tile renders a number only when **all four** hold:

- `sessions_count ≥ 10`
- `active_days ≥ 5`
- `outcome_events ≥ 3`
- `cohort_distribution[*].length ≥ 8`

Below any threshold → `display.show = false`, `suppression_reason` set, UI shows "insufficient data — gate X failed". Never approximated, never interpolated.

For team-level tiles, also enforce **k-anonymity floor `k ≥ 5`** (CLAUDE.md §6.4). Below → "insufficient cohort".

## 2×2 Manager view (§7.4)

The dashboard renders a 2×2 with X = `subscores.outcome_quality`, Y = `subscores.efficiency`. Cohorts MUST be stratified by `task_category` before cross-engineer compare. IC names hidden by default (color dots; reveal requires IC opt-in per `07-manager-api.md` Reveal gesture).

## Maturity Ladder

Aware → Operator → Builder → Architect. **Private to the IC** in their `/me` Agent Coach view. Managers see only a team-level histogram. **Stage is never auto-assigned for performance review.** Contract language enforces this — see `legal/templates/`.

## Eval gate

```bash
bun run test:scoring
```

- 500-case synthetic dev-month fixture in `packages/scoring/v1/__fixtures__/`.
- Hand-curated "correct" AI Leverage Scores.
- MAE ≤ 3 points, no outlier > 10.
- Held-out 100-case validation split must also pass.
- Runs in <30s in CI.
- **Merge-blocking on any change in `packages/scoring`.**

## Invariants

1. `score()` is **pure**: same input → same output. No Date.now(), no random, no I/O, no network. Tested by property-based tests on the same input replayed.
2. **Metric version pinned per dashboard.** Frontend specifies `metric_version` on every read. Server NEVER silently upgrades v1 → v2.
3. **Inputs hash recorded.** `ScoringOutput.inputs_hash` lets us reproduce any historical score.
4. **Suppression is explicit.** When a tile doesn't render, `display.show = false` and `suppression_reason` is one of the named values. Frontend never guesses.
5. **No ∞, no NaN.** Local-model fallback (`cost_usd=0`) MUST be handled at the function entry. Property test asserts.
6. **No second-order LLM in `score()`** (D10). LLM runs in the Insight Engine pipeline (separate, see `06-clio-pipeline.md` for the on-device half; the Insight Engine itself is a separate doc — TODO if we surface that contract).

## Open questions

- Cohort definition for solo/embedded mode (≤5 engineers) — fall back to global percentile or suppress all percentile-normalized subscores? (Owner: H — likely suppress; show raw values with "small team" annotation.)
- `task_category` taxonomy for the 2×2 stratification — comes from the Insight Engine cluster labels, or a fixed enum? (Owner: H + E — leaning fixed enum: feature, bugfix, refactor, infra, docs, exploration.)
- Where does `pricing_version_at_capture` get stamped — on the Event at write time (current plan) or recomputed at score time? (Owner: H + D — at write time. Leave recomputation for `_v2`.)

## Changelog

- 2026-04-16 — initial draft
