# Sprint-2 Scoring Plan — `packages/scoring`

**Owner:** Sandesh (workstream H)
**Branch:** `feature/scoring` (continues from PR #7)
**Feeder:** `sprint-2-scoring-research.md` (Presearch v2 Loop 0, 2026-04-17)
**Status:** PROPOSED — review before execution

## Purpose

Replace the v0 scaffold landed in PR #7 with a complete, CI-gateable `ai_leverage_v1` implementation. Two deliverables, gated by one test script:

1. **Full `ai_leverage_v1` math** — replaces `50`-placeholder subscores and the 5 TODO'd rules in `useful_output_v1`.
2. **500-case eval harness** — 50 hand-curated archetype cases + 450 auto-generated snapshots + 100-case held-out validation split, run via `bun run test:scoring`, gated at MAE ≤ 3 · max |err| ≤ 10 · Kendall τ ≥ 0.7.

No architecture change. No new deps. All locked PRD decisions (D11, D12, D13, D28) honored verbatim.

## Inputs (locked, do not re-litigate)

| Source | Locked decision | What it dictates here |
|---|---|---|
| `CLAUDE.md` §Scoring Rules | `ai_leverage_v1` 5-step math, fixed weights (35/25/20/10/10) | `composite.ts`, `normalize.ts`, `confidence.ts` formulas |
| `CLAUDE.md` §Scoring Rules | `useful_output_v1` 6 locked rules | `useful_output.ts` body |
| PRD §D13 | Metric versioning `_v1/_v2/_v3` | `v1/` directory, version string in every output |
| PRD §D12 rule 5 | Revert-penalty → companion `accepted_and_retained_edits_per_dollar` | Goodhart-gaming archetype scores LOW |
| `CLAUDE.md` §Testing Rules | MAE ≤ 3, no outlier > 10 | Gates (a) and (b) |
| `contracts/04-scoring-io.md` | `ScoringInput` / `ScoringOutput` shapes | No change — already matches |

## Proposed additions (require sign-off)

| # | Proposal | Why | Change required |
|---|---|---|---|
| P1 | Add **Kendall τ ≥ 0.7** as a third eval gate | MAE hides rank inversion; rank order is what managers actually see in the 2×2 view | PRD §10 amendment to Testing Rules; CLAUDE.md line 91 updated |
| P2 | **Archetype-stratified MAE** in CI output (not just aggregate) | Load-bearing anti-Goodhart signal — a regression in `Goodhart-gaming` cases must surface even when aggregate MAE is green | No PRD change — pure CI-output convention |
| P3 | Snapshot aggregate stats to `eval-snapshot.ai_leverage_v1.json`, version-pin | Prevents silent redefinition (D13 spirit); drift forces explicit bump to `_v2` | Check in snapshot file under `packages/scoring/` |

## Step-by-step implementation order

The order is **fixture → runner → math**, not math → fixture. Reason: without a fixture, any math change is unobservable. We build the yardstick before the thing it measures.

### Step 1 — Fixture schema and generator

**Goal:** Produce populated `archetypes.jsonl`, `snapshots.jsonl`, `validation.jsonl` (currently 0 bytes).

**Files:**
- `packages/scoring/src/v1/eval/schema.ts` — zod schema for fixture record (matches research brief §Q2 shape).
- `packages/scoring/src/v1/eval/archetypes.ts` — 50 hand-curated cases, 6 archetypes per distribution below. Each case has `archetype_tag`, `expected_final_als`, `expected_confidence` written explicitly (not computed — these are the ground truth).
- `packages/scoring/src/v1/eval/generate.ts` — auto-generator: samples log-normal on count fields (outcomeEvents, activeDays, acceptedEdits, sessions), beta on rates, computes target `final_ALS` analytically via the locked math, tags archetype by sampled parameters. Seeded RNG for reproducibility (seed committed).
- `packages/scoring/src/v1/__fixtures__/archetypes.jsonl` — 50 lines from archetypes.ts serialized.
- `packages/scoring/src/v1/__fixtures__/snapshots.jsonl` — 450 lines from generate.ts.
- `packages/scoring/src/v1/__fixtures__/validation.jsonl` — 100 lines from generate.ts with a **different** RNG seed (locks the held-out set).

**Archetype distribution** (per research §Q2):
| Archetype | Seed (archetypes.jsonl) | Generated (snapshots.jsonl) | Held-out (validation.jsonl) |
|---|---|---|---|
| low-performer | 8 | 68 | 15 |
| average | 8 | 225 | 50 |
| high-leverage | 8 | 90 | 20 |
| new-hire | 8 | 45 | 10 |
| regression-case | 8 | 0 | 0 |
| Goodhart-gaming | 10 | 22 | 5 |
| **total** | **50** | **450** | **100** |

**Acceptance:** `bun run generate:fixture` (new npm script) writes all three files deterministically; re-running produces byte-identical output; no file > 1 MB.

### Step 2 — Eval runner + `test:scoring` script

**Goal:** `bun run test:scoring` loads all three fixtures, runs each through `computeAiLeverageScore`, computes gate metrics, exits non-zero on gate failure.

**Files:**
- `packages/scoring/src/v1/eval/runner.ts` — loads JSONL, runs scorer, computes MAE, max |err|, Kendall τ, per-archetype MAE, SEM. Prints a compact table.
- `packages/scoring/src/v1/eval/gates.ts` — threshold definitions (`MAE_MAX=3`, `OUTLIER_MAX=10`, `KENDALL_MIN=0.7`). Single file so PRD amendment lands in one diff.
- `packages/scoring/src/v1/eval/snapshot.ts` — writes / reads `eval-snapshot.ai_leverage_v1.json` (MAE, max-err, τ, per-archetype MAE). CI compares current vs snapshot; drift > 0.5 MAE triggers `_v2` reminder.
- `packages/scoring/src/v1/eval/runner.test.ts` — Bun unit tests for runner logic (not for the scoring math itself — those live in the gate).
- Root `package.json` — add `"test:scoring": "bun run packages/scoring/src/v1/eval/runner.ts"`.

**Acceptance:**
- `bun run test:scoring` completes in < 30 s (PRD requirement).
- Exits 0 when all three gates pass, 1 otherwise.
- Prints headline table: `MAE <x.xx> · max|err| <x.x> · τ <x.xxx> · n=500`.
- Prints per-archetype table.
- Updates snapshot if `SCORING_SNAPSHOT_UPDATE=1` (dev loop); CI runs without that flag.

### Step 3 — Pilot run to set baselines

Run steps 1–2 against the current v0 stub **before** writing the real math. Expect: high MAE, high max-err — fine. Purpose is to prove the harness runs end-to-end, not to pass the gates. Record baseline numbers in a comment in `snapshot.ts` for reference.

### Step 4 — Implement real `ai_leverage_v1` math

Replace placeholders in this order, re-running `bun run test:scoring` after each:

1. **`subscores.ts`** — real subscore formulas per `h-scoring-prd.md §7.1` and `CLAUDE.md` Scoring Rules. The `50`-placeholders become calculations from raw signals.
2. **`useful_output.ts`** — implement rules 1 (dedup by `(session_id, hunk_sha256)`), 2 (denominator window = same session), 3 (USD at `pricing_version_at_capture_time`; panic on stamp mismatch), 5 (revert penalty; companion `accepted_and_retained_edits_per_dollar`), 6 (noise floor: sessions < 3 accepted edits excluded). Rule 4 (local-model fallback) already landed in PR #7.
3. **`display_gates.ts`** — add team-scope `k ≥ 5` floor (TODO in current code).
4. **`normalize.ts`** — actual winsorize at p5/p95 then percentile-rank (currently stub).
5. **`confidence.ts`** — verify formula matches `min(1, √(outcomeEvents/10)) · min(1, √(activeDays/10))` exactly.

After each file: `bun test packages/scoring` must pass; `bun run test:scoring` MAE must strictly decrease.

**Acceptance (end of Step 4):**
- Gate (a) MAE ≤ 3 on 500-case fixture · (b) max |err| ≤ 10 · (c) Kendall τ ≥ 0.7 — all pass with ≥ 1-pt margin.
- Held-out 100-case validation set (never seen by math during development) independently passes all three gates.
- Per-archetype MAE ≤ 4 on every archetype (individual archetype gate, looser than aggregate).
- Goodhart-gaming archetype: `final_ALS < 30` in ≥ 90% of cases (anti-gaming proof).

### Step 5 — Unit test expansion (H ≥ 20)

Current: 14 tests. Sprint-1 Phase-1 minimum: 20. Gap: 6 tests.

- 3 tests for `useful_output_v1` rules 1, 2, 5 (rule 3 covered in integration; rules 4, 6 already covered).
- 2 tests for `normalize.ts` winsorize + percentile-rank.
- 1 test for `display_gates.ts` team-scope `k ≥ 5` floor.

**Acceptance:** `bun test packages/scoring` shows ≥ 20 pass / 0 fail.

### Step 6 — PRD amendment PR (separate from code)

- `dev-docs/PRD.md` §10 Testing Rules: add Kendall τ ≥ 0.7 + per-archetype MAE convention.
- `CLAUDE.md` line 91: same.
- `dev-docs/workstreams/h-scoring-prd.md`: reference `eval-snapshot.ai_leverage_v1.json` versioning rule.

Land this PR **before or with** the Step-4 math PR. Separate diff keeps review clean.

## File-by-file change summary

| File | Change | Step |
|---|---|---|
| `packages/scoring/src/v1/eval/schema.ts` | NEW | 1 |
| `packages/scoring/src/v1/eval/archetypes.ts` | NEW | 1 |
| `packages/scoring/src/v1/eval/generate.ts` | NEW | 1 |
| `packages/scoring/src/v1/__fixtures__/*.jsonl` | POPULATE (from 0 bytes) | 1 |
| `packages/scoring/src/v1/eval/runner.ts` | NEW | 2 |
| `packages/scoring/src/v1/eval/gates.ts` | NEW | 2 |
| `packages/scoring/src/v1/eval/snapshot.ts` | NEW | 2 |
| `packages/scoring/src/v1/eval/runner.test.ts` | NEW | 2 |
| `packages/scoring/eval-snapshot.ai_leverage_v1.json` | NEW | 2 |
| Root `package.json` | add `test:scoring` script | 2 |
| `packages/scoring/src/v1/subscores.ts` | REWRITE | 4 |
| `packages/scoring/src/v1/useful_output.ts` | EXTEND (rules 1, 2, 3, 5, 6) | 4 |
| `packages/scoring/src/v1/normalize.ts` | REWRITE (real winsorize + percentile) | 4 |
| `packages/scoring/src/v1/display_gates.ts` | ADD team-scope k≥5 | 4 |
| `packages/scoring/src/v1/*.test.ts` | ADD 6 tests | 5 |
| `dev-docs/PRD.md`, `CLAUDE.md`, `h-scoring-prd.md` | amend | 6 |

## Dependencies / blockers

| Blocker | Owner | Affects |
|---|---|---|
| `task_category` enum | Sebastian (F) | Archetype stratification can proceed without it for Sprint-2; full integration deferred to Sprint-3 |
| `pricing_version_at_capture_time` write-time stamp | Jorge (D) | Needed for `useful_output_v1` rule 3 — fixture hardcodes a stamp for now; real ingest wiring is Jorge's |
| `audit_events` schema | Jorge (D) | Out of scope for this plan |

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hand-curated "ground truth" ALS values in `archetypes.ts` are subjective and wrong | Medium | Compute them from locked math against explicitly specified raw signals — they become deterministic, not judgment. Document formula inline. |
| MAE ≤ 3 turns out too tight with real math | Low–Medium | Pilot (Step 3) catches this before PRD amendment. If tight, loosen to ≤ 4 **once**, document, move on. Never silently loosen. |
| Auto-generator produces unrealistic distributions → harness passes but prod scores drift | Medium | Archetype distribution cross-checked against syncora-ai dataset ranges. Add a "smoke" test that samples 10 real dev-months from seeded fixtures post-Sprint-3 — deferred. |
| Kendall τ adds CI flakiness on tied ranks | Low | Use `scipy`-style tau-b (tie-adjusted), implemented inline — no new dep. |

## What this plan explicitly does NOT do

- Doesn't change `contracts/04-scoring-io.md` (the I/O shape is locked and already matches).
- Doesn't add any new npm dependencies.
- Doesn't wire scoring into the dashboard or ingest (that's workstream F).
- Doesn't address cross-session `useful_output_v2` (deferred per D12).
- Doesn't implement DP noise on released team rollups (Phase-2 per CLAUDE.md).

## Estimated effort

~3–4 days solo on `feature/scoring` branch (Sprint-2 week 1):
- Step 1: 1 day (archetype curation is the slow part)
- Step 2: 0.5 day
- Step 3: 0.1 day
- Step 4: 1.5 days
- Step 5: 0.5 day
- Step 6: 0.5 day (PR review turn-around dominates)

## Exit criteria — Sprint-2 scoring DONE

- [ ] 500-case fixture populated and deterministic
- [ ] `bun run test:scoring` exists at repo root, exits 0 in < 30 s
- [ ] MAE ≤ 3 · max |err| ≤ 10 · Kendall τ ≥ 0.7 all passing with ≥ 1-pt margin
- [ ] 100-case held-out split independently passes gates
- [ ] Per-archetype MAE ≤ 4 on every archetype
- [ ] Goodhart-gaming archetype `final_ALS < 30` in ≥ 90% of cases
- [ ] ≥ 20 unit tests passing in `packages/scoring`
- [ ] PRD amendment PR merged (Kendall τ gate + snapshot versioning)
- [ ] `eval-snapshot.ai_leverage_v1.json` checked in and version-pinned
