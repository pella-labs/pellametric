# Bematist — Workstream H-scoring PRD

**Owner:** Sandesh
**Workstream:** H-scoring (the scoring math — `packages/scoring`)
**Status:** draft
**Last touched:** 2026-04-16
**Scope covers:** Sprint 1 v0 stub → Sprint 2 MERGE BLOCKER (`ai_leverage_v1` locked math + 500-case eval)
**Explicitly out of scope:** `ai_leverage_v2`/`_v3` roadmap, any LLM scoring (Insight Engine is Jorge's), cross-tool correlation (Phase 3+).

> This PRD is the implementation spec for one owner's vertical slice. It is **not** a re-debate of locked decisions — PRD §7 and CLAUDE.md §"Scoring Rules" already lock the math. This doc pins the build order, file shapes, testing layers, cross-workstream asks, and acceptance gates so Sprint 1 and Sprint 2 implementation are mechanical.

## 1. Executive summary

`packages/scoring` is pure, deterministic, eval-gated math. It takes pre-aggregated event rollups from Jorge's ClickHouse materialized views (`dev_daily_rollup`, `team_weekly_rollup`) and returns `ai_leverage_score` (0–100) plus five subscores per `(engineer, week)` or `(team, week)`. The math is already locked in PRD §7.1 (`ai_leverage_v1`) and contract `04-scoring-io.md`. This workstream implements that locked math, lands a Sprint-1 stub so Sebastian's dashboard renders a tile at M1, and passes the Sprint-2 merge-blocker eval (MAE ≤ 3 on 500 cases + 100-case held-out validation).

## 2. Scope

**In scope:**
- `packages/scoring/src/` implementation — types, entry, and `v1/` math.
- `ai_leverage_v1` 5-step math (raw subscores → winsorize + percentile-rank → weighted composite → confidence → final).
- `useful_output_v1 = accepted_code_edits_per_dollar` (D12, 6 locked rules).
- Display gates (4 thresholds + k≥5 team-scope floor).
- Metric-version pinning (`_v1` suffix, never silently redefined — D13).
- 500-case synthetic dev-month eval fixture + 100-case held-out validation + regression snapshot infrastructure.
- Integration test pattern that consumes Jorge's MV row shape without spinning up ClickHouse in scoring's test suite.
- Cross-workstream coordination asks (recorded below; owners ping on PR landing).

**Explicitly out of scope (deferred to follow-up PRDs):**
- `ai_leverage_v2` (adds retention) and `v3` (adds cross-tool correlation).
- Any LLM in `score()` — forbidden by D10; Insight Engine is Jorge's H-AI workstream.
- Maturity-ladder display UI (private IC view, Sebastian's surface).
- 2×2 manager-view rendering (Sebastian's surface; we provide the inputs).
- Per-session LLM scoring — forbidden.

**Workstream-boundary reminder:** we do not write code in `packages/embed`, `packages/schema`, `apps/web`, `apps/ingest`, or `apps/worker`. We read from contracts, we propose schema additions through the contract changelog, we never silently amend other owners' surfaces.

## 3. References (authoritative sources)

- `dev-docs/PRD.md` §7 "Metrics & Scoring" (§7.1 locked math + §7.2 `useful_output_v1` + §7.3 Maturity Ladder + §7.4 2×2 manager view).
- `dev-docs/PRD.md` §15 "Decision Log" — **D11, D12, D13, D21, D28** are the locked scoring decisions this PRD implements.
- `contracts/04-scoring-io.md` — function signature (`ScoringInput` / `ScoringOutput` / `score()`) and invariants. This PRD owns that contract.
- `contracts/09-storage-schema.md` — consumed for MV column shapes (`dev_daily_rollup`, `team_weekly_rollup`) and event-table pricing/task-category columns.
- `CLAUDE.md` §"Scoring Rules" (locked math), §"Testing Rules" (co-location convention + per-workstream minimums), §"AI Rules" step 5 (forbidden-field enumeration relevant to scoring inputs).

## 4. Locked decisions this PRD implements (non-negotiable)

| D# | Decision | This PRD's obligation |
|---|---|---|
| D11 | AI Leverage Score v1 — five subscores (Outcome 35 · Efficiency 25 · Autonomy 20 · Adoption 10 · Team Impact 10), SPACE-aligned | Weights hard-coded in `v1/composite.ts`; never re-weighted without `_v2` |
| D12 | `useful_output_v1 = accepted_code_edits_per_dollar` — 6 locked rules | All 6 rules implemented in `v1/useful_output.ts`; deviations bump `_v2` |
| D13 | Metric versioning mandatory — `_v1`/`_v2`/`_v3` suffixes; never silently redefined | Metric-version pinned per call via `ScoringInput.metric_version` |
| D21 | Pricing-version shifts render a dashboard banner; no silent recomputation | `pricing_version_at_capture` read-only at score time; never recomputed |
| D28 | 500-case synthetic dev-month eval gate (MAE ≤ 3, no outlier > 10, <30s CI); held-out 100-case validation split | `bun run test:scoring` is merge-blocking |

## 5. Input contract — `ScoringInput`

Pinned in `contracts/04-scoring-io.md`. Types live in `packages/scoring/src/index.ts` (exported at the package entry). All consumers — `apps/web` via `packages/api`, future Insight-Engine readers, fixtures — import from the same module.

```ts
export interface ScoringInput {
  metric_version: "ai_leverage_v1";          // pins the codepath
  scope: "engineer" | "team";
  scope_id: string;                          // engineer_id (hashed) OR team_id
  cohort_id: string;                         // peer cohort for normalization
  window: { from: string; to: string };      // ISO 8601 UTC

  signals: {
    // Outcome Quality (35%)
    accepted_edits: number;
    accepted_and_retained_edits: number;
    merged_prs: number;
    green_test_runs: number;

    // Efficiency (25%)
    cost_usd: number;
    pricing_version_at_capture: string;
    active_hours: number;
    accepted_edits_per_dollar?: number;      // null if cost_usd=0 (local model)

    // Autonomy (20%)
    avg_intervention_rate: number;           // 0..1; lower = more autonomous
    avg_session_depth: number;

    // Adoption Depth (10%)
    distinct_tools_used: number;
    distinct_sources_used: number;
    sessions_count: number;

    // Team Impact (10%) — D31 Promote-to-Playbook
    promoted_playbooks: number;
    promoted_playbook_total_clusters: number;
    playbook_adoption_by_others: number;     // distinct OTHER ICs; capped at 10

    // Confidence inputs
    outcome_events: number;
    active_days: number;
  };

  cohort_distribution: {
    accepted_edits: number[];
    accepted_edits_per_dollar: number[];
    avg_intervention_rate: number[];
    distinct_tools_used: number[];
    promoted_playbooks: number[];
  };
}
```

**Obligations on Jorge's MVs:** `dev_daily_rollup` and `team_weekly_rollup` must expose every signal above. `cohort_distribution` is derived at read time from peer rows. Exact column mapping is CW-3/CW-4 below.

## 6. Output contract — `ScoringOutput`

```ts
export interface ScoringOutput {
  metric_version: "ai_leverage_v1";
  scope: "engineer" | "team";
  scope_id: string;
  window: { from: string; to: string };

  ai_leverage_score: number;                 // 0..100, final shipped number
  raw_ai_leverage: number;                   // pre-confidence, for transparency
  confidence: number;                        // 0..1; final = raw * confidence

  subscores: {
    outcome_quality: number;                 // weight 0.35
    efficiency: number;                      // weight 0.25
    autonomy: number;                        // weight 0.20
    adoption_depth: number;                  // weight 0.10
    team_impact: number;                     // weight 0.10
  };

  display: {
    show: boolean;
    suppression_reason?:
      | "insufficient_sessions"              // < 10
      | "insufficient_active_days"           // < 5
      | "insufficient_outcome_events"        // < 3
      | "insufficient_cohort"                // < 8 peers
      | "k_anonymity_floor";                 // team tile with k<5
    failed_gates: string[];
    raw_subscores_available: boolean;        // R1 small-team fallback
    raw_subscores?: {                         // only populated when cohort<8
      outcome_quality_raw: number;
      efficiency_raw: number;
      autonomy_raw: number;
      adoption_depth_raw: number;
      team_impact_raw: number;
    };
  };

  pricing_version_drift: boolean;            // banner signal per D21

  inputs_hash: string;                       // sha256 of ScoringInput
}
```

> **Contract-04 additive change (G3-a).** The fields `display.raw_subscores_available` and optional `display.raw_subscores` are NEW. Recorded as an additive Changelog entry on `contracts/04-scoring-io.md` when this PRD lands. Rationale: small-team (cohort<8) fallback per R1 — show raw numbers instead of suppressing entirely.

## 7. The math — `ai_leverage_v1` (locked, 5 steps)

Implementation in `packages/scoring/src/v1/`. Order and operation cannot be changed without bumping to `_v2`.

**Step 1 — Raw subscores** (`v1/subscores.ts`). Formulas per PRD §7.1:

```
outcome_raw     = 0.4·mergedPRRate + 0.3·ciPassRate + 0.2·reviewAcceptRate + 0.1·(1 − revertRate)
efficiency_raw  = weighted(inverse(costPerMergedPR), inverse(costPerSession), inverse(retryRatio))
autonomy_raw    = 1 − weighted(approvalPromptRate, stallRate) + 0.3·recoveryAfterFailureRate
adoption_raw    = min(1, activeDays/21) · min(1, toolBreadth/5) · min(1, sessions/40)
teamImpact_raw  = promotedPlaybookShare + 0.5·playbookAdoptionByOthers
```

**Step 2 — Cohort-normalize** (`v1/normalize.ts`). Winsorize at p5/p95 within cohort, then percentile-rank. Output scaled to 0..100.

**Step 3 — Weighted composite** (`v1/composite.ts`):

```
raw_ALS = 0.35·outcome + 0.25·efficiency + 0.20·autonomy + 0.10·adoption + 0.10·teamImpact
```

**Step 4 — Confidence** (`v1/confidence.ts`):

```
confidence = min(1, √(outcome_events/10)) · min(1, √(active_days/10))
```

**Step 5 — Final:**

```
final_ALS = raw_ALS · confidence
```

## 8. `useful_output_v1` — 6 locked rules (`v1/useful_output.ts`)

Per D12 and PRD §7.2:

1. **Dedup unit:** `(session_id, hunk_sha256)`. Same hunk same session = 1; cross-session = counts twice.
2. **Denominator window:** same `session_id`. Cross-session attribution is `_v2` territory — **never back-ported into v1**.
3. **Unit:** USD at `pricing_version_at_capture` (stamped at write time — R3). Pricing-version mismatch between window start/end → `ScoringOutput.pricing_version_drift = true` (dashboard banner). **Never silently recompute.**
4. **Local-model fallback:** if `cost_usd = 0`, suppress `accepted_edits_per_dollar` and feed `accepted_edits_per_active_hour` into the efficiency subscore instead. **No `∞`, no `NaN`, ever.** Property test enforces.
5. **Revert penalty:** hunks reverted within 24h of acceptance subtracted from numerator. Companion metric `accepted_and_retained_edits_per_dollar` computed separately (exposed as `subscores.efficiency` raw input, not as its own output field in v1).
6. **Noise floor:** sessions with `accepted_edits < 3` excluded from the denominator.

## 9. Display gates (`v1/display_gates.ts`)

A tile renders a number only when **all four** hold:

- `sessions_count ≥ 10`
- `active_days ≥ 5`
- `outcome_events ≥ 3`
- `cohort_distribution[*].length ≥ 8` (all five distributions)

Below any threshold → `display.show = false`, `suppression_reason` set, `failed_gates: string[]` enumerates which gate(s) failed. Frontend renders "insufficient data — gate X failed." **Never approximated, never interpolated.**

For team-level tiles: also enforce **k-anonymity floor `k ≥ 5`** per CLAUDE.md §6.4. Below → `suppression_reason = "k_anonymity_floor"`.

**R1 small-team fallback (cohort<8 peers):** `display.show = false` AND `display.raw_subscores_available = true` AND `display.raw_subscores` populated with pre-normalization raw values. The IC `/me` view can render these raw numbers with a "small team — no peer normalization" chip. Manager-side tiles still suppress entirely (k≥5 team-scope rule is stricter).

## 10. Metric versioning (D13)

- Every `ScoringInput.metric_version` field is **required**. Server rejects malformed/missing field.
- Codepath selection: `v1` → `packages/scoring/src/v1/*`. Future `v2` will live in `v1/v2/` alongside, never replace.
- Dashboard frontend specifies `metric_version` on every read. **Server NEVER silently upgrades v1 → v2.** When `v2` ships, dashboards migrate explicitly with a banner showing the version switch.
- User-facing metric names carry the suffix (`AI Leverage Score v1`, `useful_output_v1`) — never shown bare.

## 11. Testing strategy (six layers)

> All test files co-located per CLAUDE.md §"Testing Rules": `*.test.ts` next to `*.ts` source file.

### §11.1 Unit tests (`≥ 20`)

Per CLAUDE.md Phase 1 minimum `H ≥ 20`. Covers:
- Each subscore function: happy path, zero signals, maxed signals, edge rounding.
- Each math step: `winsorize`, `percentileRank`, `composite` (weight sum), `confidence` (boundary at 10 outcomes / 10 days).
- Each `useful_output_v1` rule (1–6) in isolation.
- Each display gate in isolation.
- R1 small-team fallback path (cohort=0, cohort=7, cohort=8 boundary).
- `pricing_version_drift` detection (window-spanning rows with mismatching version strings).

### §11.2 Property-based tests

Assertions (1000 random inputs each):

- **Determinism:** `score(i) === score(i)` across 1000 replays; no `Date.now()`, no random, no I/O.
- **Bounds:** `0 ≤ ai_leverage_score ≤ 100`; `0 ≤ raw_ai_leverage ≤ 100`; `0 ≤ confidence ≤ 1`.
- **Monotonicity of confidence:** `confidence` is non-decreasing in both `outcome_events` and `active_days`.
- **Final ≤ raw:** `ai_leverage_score ≤ raw_ai_leverage` always (confidence never > 1).
- **No `NaN`, no `∞`:** every field of `ScoringOutput` is finite.

### §11.3 500-case eval fixture — **MERGE BLOCKER**

`bun run test:scoring`. Fixture layout:

- `packages/scoring/src/v1/__fixtures__/archetypes.jsonl` — 50 hand-curated archetypes.
- `packages/scoring/src/v1/__fixtures__/snapshots.jsonl` — 450 auto-snapshotted cases, seeded from `packages/fixtures/claude-code/session-fixture.jsonl` distributions.

**Fixture row format (JSONL):**

```json
{
  "input": { /* ScoringInput */ },
  "expected_score": 82,
  "expected_subscore_ordering": ["outcome_quality", "autonomy", "efficiency", "adoption_depth", "team_impact"],
  "rationale": "Senior autonomous dev, low cost, high retained edits — expect high outcome + autonomy, lower team_impact (no promoted playbooks yet)"
}
```

- `expected_score` is the "correct" target value.
- `expected_subscore_ordering` is optional; when present, asserts relative rank of subscores (catches sign/weight bugs even when the composite lands near target).
- `rationale` is a one-line justification; reviewers can challenge any single archetype without re-deriving all 500.

**Pass criteria:**
- MAE across all 500: ≤ 3 points.
- No single case off by > 10 points.
- Runs in <30s in CI.
- **Merge-blocking on any change under `packages/scoring/`.**

**Archetype taxonomy — 10 each across 5 categories (the 50 hand-curated):**

| Category | Shape | Example archetype |
|---|---|---|
| Happy-path ICs | Passes all gates; normal distributions | "Senior autonomous dev — low cost, high retained edits, moderate team_impact" |
| Insufficient-data | Fails ≥1 display gate | "New hire, 4 active days" → `suppression_reason = "insufficient_active_days"` |
| Gaming attempts | High raw numbers, low retained | "Accepted-then-reverted hunks, 90% revert rate within 24h" → low efficiency |
| Edge cases | `cost_usd=0`, pricing_version drift, cohort=7 (R1 boundary) | "Local-model-only dev: `cost_usd=0`; efficiency falls back to per-hour" |
| Team-scope | Team-level inputs (not engineer) | "Healthy team, cohort=8, retains all tiles"; "Small team cohort=4 → k-floor suppression" |

### §11.4 Held-out 100-case validation split

`packages/scoring/src/v1/__fixtures__/validation.jsonl`. Generated once at Sprint-2 fixture-build time, **committed to repo**, regenerated only on a major metric version bump (`v1` → `v2`). Runs in the same `test:scoring` command; same MAE ≤ 3 criterion. Guards against overfitting the 50 archetypes.

### §11.5 Regression snapshot

The 450 auto-snapshotted cases in `snapshots.jsonl` serve dual duty:
- Contribute to the 500-case MAE computation.
- Function as regression snapshots — any refactor that changes `score()` output drifts a snapshot and fails CI.

**Snapshot-update ritual when math legitimately changes:**

```bash
bun run test:scoring -- --update-snapshots
```

The PR description **must** enumerate every drifted snapshot with a one-line reason. Snapshot drift without an enumerating rationale is a review-blocker. This prevents silent regressions while allowing legitimate math corrections.

### §11.6 Integration test with rollup shape

End-to-end path: JSON fixture of a `dev_daily_rollup` row → translate via rollup-to-ScoringInput adapter → `score()` → assert output.

**Fixture location:** `packages/scoring/src/v1/__fixtures__/rollup_sample.json`. Content is a JSON snapshot of the expected MV row shape (coordinated with Jorge — CW-3). Scoring's test suite does **not** spin up ClickHouse; infrastructure stays in Jorge's workstream.

One happy-path test + five suppression-path tests (one per `suppression_reason` value).

### What is NOT covered (explicit non-goals)

- **LLM-judge evaluation of scoring.** Scoring is deterministic; LLM-judge lives in Jorge's Insight Engine pipeline.
- **Cross-tenant isolation tests.** That's Walid's RLS probe (CLAUDE.md §"Security Rules").
- **Performance benchmarks for `score()` itself.** Pure arithmetic at µs scale; perf gates live at the query + UI boundary.

## 12. Sprint-1 deliverables (M1 gate: "first tile renders")

### 12.1 File scaffolding (Day 1)

```
packages/scoring/src/
  index.ts                    # public API — ScoringInput, ScoringOutput, score()
  v1/
    index.ts                  # ai_leverage_v1 entry; routes from index.ts
    subscores.ts              # the 5 raw subscores (stubbed until Sprint 2)
    normalize.ts              # winsorize + percentile-rank (stubbed until Sprint 2)
    composite.ts              # weighted sum
    confidence.ts             # sqrt/10 formula
    useful_output.ts          # accepted_edits_per_dollar (stubbed until Sprint 2)
    display_gates.ts          # gate enumeration (partially implemented)
    __fixtures__/
      archetypes.jsonl        # empty at Sprint 1; filled at Sprint 2
      snapshots.jsonl         # empty at Sprint 1; filled at Sprint 2
      validation.jsonl        # empty at Sprint 1; filled at Sprint 2
      rollup_sample.json      # JSON fixture from Jorge (CW-3)
```

### 12.2 v0 `score()` stub behavior

Returns a **fully-shaped** `ScoringOutput` so Sebastian's dashboard can render a tile without errors (G1-b). Derived from two signals only: `accepted_edits` and `cost_usd`.

```ts
// v0 stub (Sprint 1) — replaced in Sprint 2 by v1 math
export function score(input: ScoringInput): ScoringOutput {
  const rawEfficiency = input.signals.cost_usd > 0
    ? Math.min(100, (input.signals.accepted_edits / input.signals.cost_usd) * 10)
    : 50;
  const rawALS = Math.round(rawEfficiency);
  return {
    metric_version: "ai_leverage_v1",
    scope: input.scope,
    scope_id: input.scope_id,
    window: input.window,
    ai_leverage_score: rawALS,
    raw_ai_leverage: rawALS,
    confidence: 1.0,
    subscores: {
      outcome_quality: rawALS,
      efficiency: rawALS,
      autonomy: 50,
      adoption_depth: 50,
      team_impact: 50,
    },
    display: {
      show: true,
      failed_gates: [],
      raw_subscores_available: false,
    },
    pricing_version_drift: false,
    inputs_hash: sha256OfInput(input),
  };
}
```

The stub intentionally fills every field so the M1 integration with `apps/web` doesn't choke. All values are **placeholder** — the Sprint-2 commit that replaces this is a pure-math diff and must pass the (then-populated) 500-case eval.

### 12.3 Wire to `apps/web` via `packages/api`

- `packages/scoring` exports `score()` and types.
- `packages/api` (Sebastian's) imports `score()` and exposes a tRPC procedure.
- `apps/web` (Sebastian's) renders the `ai_leverage_score` number in one tile.
- **We do not touch `packages/api` or `apps/web`.** We confirm Sebastian has the import target ready (this is IW-4 via `packages/config/src/bill-of-rights.ts` for the compliance side; for scoring, he imports `@bematist/scoring` directly).

### 12.4 Sprint-1 tests

- ≥ 5 unit tests covering the v0 stub (full output shape, local-model fallback, deterministic output).
- 3 property-based tests (determinism, bounds, no `NaN`/`∞`).
- 1 integration test using `rollup_sample.json`.
- **No 500-case eval at Sprint 1** — fixtures are empty placeholders.

### 12.5 M1 acceptance

- `bun run typecheck` + `bun run test` pass for `packages/scoring`.
- `apps/web` renders one real tile sourced from `score()` on real M0 seed data.
- File scaffolding matches §12.1.
- CW-3 (Jorge's rollup column list) and CW-4 (team rollup) received in additive changelog entries on `contracts/09-storage-schema.md`.

## 13. Sprint-2 deliverables (M2 gate: MERGE BLOCKER)

### 13.1 Replace v0 stub with full `ai_leverage_v1`

Commit flow (one PR per step recommended; all must land before the 500-case fixture can be populated):

1. Implement `v1/normalize.ts` (winsorize + percentile-rank) with unit tests.
2. Implement `v1/subscores.ts` with all 5 raw subscores + unit tests.
3. Implement `v1/useful_output.ts` with all 6 locked rules + unit tests.
4. Implement `v1/display_gates.ts` full gate logic + unit tests.
5. Implement `v1/composite.ts` + `v1/confidence.ts` + unit tests.
6. Wire `v1/index.ts` to replace v0 stub; all prior unit/property tests still pass.

### 13.2 Populate `__fixtures__/`

- Draft the 50 archetypes by category (10 × 5 taxonomy in §11.3).
- Each archetype landed with rationale; reviewer signs off per-archetype in PR description.
- Generate the 450 snapshots from seeded distributions; verify mean + variance of inputs matches `session-fixture.jsonl` derived stats within 15%.
- Generate the 100-case held-out validation split; commit.

### 13.3 Pass the eval

- `bun run test:scoring` runs in <30s.
- MAE ≤ 3 on the 500-case fixture.
- No single case off by > 10 points.
- Held-out 100-case validation split also passes (same MAE ≤ 3).
- **Merge-blocking.**

### 13.4 Honor R3 — `pricing_version` read-only

Scoring reads `input.signals.pricing_version_at_capture` verbatim. If the window spans two different pricing versions (which ingest stamps at write time, per R3), scoring sets `pricing_version_drift = true`. Scoring never joins a historical pricing table.

### 13.5 M2 acceptance

- All Sprint-2 deliverables in §13.1–§13.4.
- CW-1 resolved: Sebastian confirmed `task_category` fixed enum.
- CW-2 resolved: Jorge confirmed `pricing_version_at_capture` write-time stamping.
- All six testing layers from §11 green in CI.
- Scoring PR landed with 50 archetype rationales + 450 snapshot drift notes.

## 14. Resolved open questions + pending-confirm items

### §14.1 Resolved internally (no ping needed)

**R1 — Solo/embedded mode cohort (<8 peers).** Suppress normalized subscores; show raw values on IC's `/me` with "small team — no peer normalization" chip. Manager-side team tiles still suppress entirely per k≥5 rule.

**Rationale:** Consistent with existing gate `cohort_distribution[*].length ≥ 8`. Consistent with locked non-goal "no cross-tenant benchmarking" (any global-percentile fallback would violate).

**Implementation:** §6 `ScoringOutput.display.raw_subscores_available` + `display.raw_subscores`. Recorded as additive contract-04 changelog (G3-a).

### §14.2 Proposed, pending owner confirm

**R2 — `task_category` taxonomy for 2×2 stratification.** Proposed fixed enum `feature | bugfix | refactor | infra | docs | exploration`. Stamped at session-classification time on the Event. Stable buckets across weeks → meaningful cross-week comparisons.

- **Pending Sebastian (E — 2×2 renderer):** confirm `/team` 2×2 stratifies by this enum.
- **Pending Jorge (D — events table):** add `task_category LowCardinality(String)` column to `events` + both rollup MVs.

**R3 — `pricing_version_at_capture` timing.** Proposed: stamp at write time (ingest sets `events.pricing_version` from the current LiteLLM pricing table at INSERT). Scoring reads, never recomputes.

- **Pending Jorge (D):** confirm `events.pricing_version` column (already in `contracts/09` line 57) is populated at write time. Coordinate with Walid (ingest) on LiteLLM JSON freshness.

### §14.3 Cross-workstream asks (tracked as CW-N)

| # | Ask | Owner | Sprint | Blocks |
|---|---|---|---|---|
| CW-1 | Confirm R2 fixed-enum `task_category` | Sebastian | Sprint 1 Week 2 | Sprint-2 2×2 render |
| CW-2 | Confirm R3 write-time `pricing_version_at_capture` | Jorge | Sprint 1 Week 2 | Sprint-2 `useful_output_v1` impl |
| CW-3 | Publish `dev_daily_rollup` column list on `contracts/09` | Jorge | Sprint 1 Day 5 | §11.6 integration test + Sprint-1 wire to `apps/web` |
| CW-4 | Publish `team_weekly_rollup` column list on `contracts/09` | Jorge | Sprint 1 Day 5 | Sprint-2 team-scope scoring |

**Ping messages for each owner are in `dev-docs/workstreams/i-compliance-prd.md` §12** (kept together across both PRDs to avoid duplication).

## 15. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| HR-1 | 50 hand-curated archetypes inadvertently encode a math bug as "correct" → gate passes buggy math | HIGH | Each archetype has a rationale; any reviewer can challenge a single expected_score; diverse archetype taxonomy (§11.3) spans all math paths |
| HR-2 | Jorge's rollup MV column shapes drift after we author §11.6 fixture | MEDIUM | `rollup_sample.json` tracked in scoring repo; any drift shows as test failure, forces re-coordination |
| HR-3 | `task_category` enum value list rejected by Sebastian → delays 2×2 stratification | LOW | Enum values are negotiable; math doesn't depend on specific values, only on stability |
| HR-4 | `pricing_version_at_capture` write-time stamping contested by Jorge → forces recomputation path | LOW-MED | D21 is locked; PRD amendment would be required; we hold the line |
| HR-5 | 500-case eval takes >30s in CI → soft fail PRD obligation | LOW | Generate fixtures offline; eval step is pure-arithmetic, should run in <5s on commodity CI |
| HR-6 | Metric-version pin drift: frontend requests `v2` before we ship it | LOW | `score()` throws on unknown `metric_version`; frontend contract-bound to read from `packages/scoring` exported enum |

## 16. Acceptance criteria summary

| Gate | When | Must-pass |
|---|---|---|
| M1 (Sprint 1 end) | Day ~12 | v0 stub returns full `ScoringOutput` shape; `apps/web` renders one tile; `bun run test` green for `packages/scoring`; CW-3/CW-4 additive changelog entries landed on `contracts/09` |
| M2 (Sprint 2 end) | Day ~19 | Full `ai_leverage_v1` math + `useful_output_v1`; all 6 test layers green; **500-case eval MAE ≤ 3**, no outlier > 10, <30s CI; held-out 100-case validation passes; CW-1 + CW-2 resolved |
| M3 (Sprint 3 end — PoC ship) | Day ~26 | No scoring-layer regression; ALS rendered on real M3 demo dataset with honest confidence values; pricing-version-drift banner exercised in demo path |

## 17. Changelog

- 2026-04-16 — initial draft PRD landed alongside `contracts/04-scoring-io.md` Changelog entry for R1 (`display.raw_subscores_available` + `display.raw_subscores`).
