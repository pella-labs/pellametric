# M2 Gate — Parallel Agent-Team Plan

> **Status:** revised · 2026-04-17 · post Jorge-merge sweep + Sprint-1 reconciliation
> **Owner:** Sebastian (orchestrator)
> **Model:** every agent Opus 4.7
> **Goal:** reach the M2 gate defined in `WORKSTREAMS.md` lines 96–109 using a fan-out of parallel subagents. Jorge's Sprint 1 + Sprint 2 (#13–16, #24–32) merged. #17 + #18 reconciled and consolidated into **#34** (D1-05 control-plane + D1-06 RLS/INT9). #19 closed — sidecar skeleton already on main; follow-up PR for Dockerfile + tests deferred.

## 1. What M2 requires

Per `WORKSTREAMS.md` §M2:

- [ ] All 6 v1 adapters with golden fixtures (today: Claude Code only)
- [x] OTLP receiver + webhooks + GitHub App live
- [x] ~~All MVs~~ — 5 CH MVs + 2 projections on main (#14 D1-02, #15 D1-03)
- [x] ~~Partition-drop worker~~ — real impl on main (#16 D1-04 · `apps/worker/src/jobs/partition_drop.ts`)
- [x] ~~RLS + INT9 cross-tenant probe~~ — **#34** merged (reconciled D1-05 + D1-06; 5 INT9 tests green, app_bematist role + FORCE RLS on 15 tables)
- [x] Manager 2×2 + `/me` + Reveal flow + cluster pages + outcomes
- [ ] **Scoring math passes 500-case eval** — MAE ≤ 3, no outlier > 10 · **MERGE BLOCKER** (60-case fixture + LLM-judge harness #28 on main; expansion + held-out split pending)
- [~] Insight Engine H4a–H4f pipeline returns High-confidence insights — **skeleton on main** (#26 · `apps/worker/src/jobs/insight/h4{a..f}*.ts`); adversarial eval + web wire-up pending
- [x] ~~Embed provider chain~~ — 4-tier resolver + Redis/PG cache on main (#25 D2-01, #29 D2-05)
- [x] ~~Nightly cluster job~~ — mini-batch k-means on main (#30 D2-06 · `apps/worker/src/jobs/cluster/recluster.ts`)
- [x] ~~Gateway cluster labeler~~ — Haiku 4.5 + regex gate on main (#32 D2-08)
- [x] ~~Twin Finder (math)~~ — cosine + k-anonymity gate on main (#31 D2-07 · `packages/scoring/src/twinFinder.ts`); live API wire-up pending
- [~] Anomaly SSE channel emits hourly — **detector + notifier on main** (#27 D2-03 · `apps/worker/src/jobs/anomaly/`); SSE route wire-up pending
- [ ] **Privacy adversarial gate** — ≥98% secret recall, 100% forbidden-field rejection, ≥95% Clio verifier recall · **MERGE BLOCKER**
- [ ] **Perf gate** — p95 dashboard < 2s on 1M seeded events, p99 ingest < 100ms · **MERGE BLOCKER** (`tests/perf/dashboard.k6.js` exists; 1M seed + ingest k6 + CI gate pending)

Plus the feature surface behind those gates (Ed25519 signed-config, adapters, Clio, compliance, etc.).

## 2. Strategy

- **13 agents across 2 waves** (down from 17). Wave 0 retired — Jorge's real impls superseded every stub. A8 (embed providers) retired — fully shipped by #25 + #29. A9/A10/A11 downgraded to **wire-up briefs** — the math/skeletons landed via #26/#27/#30/#31/#32; what remains is web/API integration, adversarial eval, and SSE plumbing.
- **Disjoint file scopes.** Every brief lists `OWNS` / `READS` / `DO NOT TOUCH`. The few shared files (`apps/collector/src/adapters/index.ts`, `apps/worker/src/index.ts`) force sequential merging of those specific PRs — call-out in §6.
- **Jorge still has three open PRs** (#17, #18, #19). None block the agent team: A9/A10/A11 wire-up can proceed against main's current schema; A14 signed-config uses its own new tables; A16 privacy gate needs #18 landed for RLS probe but can start test-scaffold work against main-today. Rebase-assist brief in §3.
- **Every agent inherits a standard preamble** (§7) that forces them to read `CLAUDE.md`, stay in scope, TDD when the gate demands it, and open a PR but not merge.

## 3. Wave 0 — retired

> A0 stub scaffolding: not needed (real impls on main).
> A0' Jorge rebase-assist: completed — #17 + #18 reconciled into **#34** (pending merge); #19 closed with note for future thin follow-up.

---

## 4. Wave 1 — Independent lanes (parallel after A0 merges)

All Wave 1 agents can launch simultaneously once A0 is on main. Each has disjoint `OWNS`. Shared-file collisions are documented; those PRs merge sequentially.

### A1 — Codex CLI adapter

**Owns:** `apps/collector/src/adapters/codex/**`, `packages/fixtures/codex/**`
**Reads:** `packages/sdk/adapter.ts`, `apps/collector/src/adapters/claude-code/**` (reference impl), `contracts/03-adapter-sdk.md`, `CLAUDE.md` §Adapter Matrix
**Shared-file collision:** `apps/collector/src/adapters/index.ts` (registers the new adapter) — also touched by A2–A5; merge sequentially.

**Specifics per CLAUDE.md:**
- JSONL tail + cumulative `token_count` diffing. Stateful running totals persisted in egress journal.
- Golden fixture `packages/fixtures/codex/sample-session.jsonl` (10–20 events covering `exec_command_end.exit_code`, `patch_apply_end.success=false`).
- `firstTryRate` cross-agent labels include Codex's `exec_command_end.exit_code != 0` + `patch_apply_end.success=false`.

**Acceptance:**
- ≥10 tests. Golden fixture parses end-to-end via adapter → Event[].
- `P0 fixes (D17)` — Codex-side equivalents of `parseSessionFile` dedup, `durationMs`, safe file reader.

**PR title:** `feat(collector): Codex CLI adapter — JSONL tail + token_count diffing + P0 fixes (B1)`

---

### A2 — Cursor adapter (token-only with caveat)

**Owns:** `apps/collector/src/adapters/cursor/**`, `packages/fixtures/cursor/**`
**Reads:** same as A1
**Shared-file collision:** `apps/collector/src/adapters/index.ts`

**Specifics:**
- Read-only SQLite poll (`mode=ro`), copy-and-read to avoid lock contention.
- Auto-mode events emit `cost_estimated=true` badge.
- Golden fixture is a small SQLite snapshot.

**Acceptance:** ≥10 tests · `cost_estimated` badge flows through · handles missing/corrupt SQLite gracefully.

**PR title:** `feat(collector): Cursor token-only adapter — read-only SQLite poll + cost_estimated flag`

---

### A3 — OpenCode adapter (post-migration)

**Owns:** `apps/collector/src/adapters/opencode/**`, `packages/fixtures/opencode/**`
**Shared-file collision:** `apps/collector/src/adapters/index.ts`

**Specifics:**
- Handles post-v1.2 SQLite schema.
- Pre-v1.2 sharded JSON sessions are skipped with a `[warn] opencode: pre-v1.2 session skipped` log and a one-line entry in the egress journal's `skipped` counter.

**Acceptance:** ≥10 tests · warning path covered.

**PR title:** `feat(collector): OpenCode adapter (post-v1.2 SQLite) + skip-pre-v1.2 warning`

---

### A4 — Continue.dev adapter (full, 4-stream)

**Owns:** `apps/collector/src/adapters/continue-dev/**`, `packages/fixtures/continue-dev/**`
**Shared-file collision:** `apps/collector/src/adapters/index.ts`

**Specifics per PRD D23:**
- 4 JSONL streams: `chatInteraction`, `tokensGenerated`, `editOutcome`, `toolUsage`. One adapter with 4 cursor keys, one per stream.
- No existing OSS parser — design from the file layout described in CLAUDE.md.
- Richest fidelity of any v1 adapter; set baseline for "full" badge in `data_fidelity` chip.

**Acceptance:** ≥10 tests per stream (≥10 total is the floor; aim ≥20) · all 4 streams produce canonical Event[].

**PR title:** `feat(collector): Continue.dev adapter — 4-stream JSONL (D23 first OSS parser)`

---

### A5 — VS Code generic adapter scaffold

**Owns:** `apps/collector/src/adapters/vscode-generic/**`, `packages/fixtures/vscode-generic/**`, `packages/sdk/adapter.ts` (add any hooks community adapters need)
**Shared-file collision:** `apps/collector/src/adapters/index.ts`

**Specifics:**
- Base adapter SDK shape community VS Code extension authors extend. One working example (you choose a plausible extension; document why).
- Focus: documented seam more than perfect coverage. This adapter demonstrates the "+1 VS Code generic" slot in the M2 count.

**Acceptance:** ≥10 tests · `adapter.test.ts` documents the extension pattern.

**PR title:** `feat(collector): VS Code generic adapter scaffold + one example extension`

---

### A6 — Server-side redaction hot-path (C + G-backend)

**Owns:** `packages/redact/src/engines/` (TruffleHog, Gitleaks, Presidio wrappers), `packages/redact/src/orchestrator.ts`, `apps/ingest/src/redact/hotpath.ts`, `packages/fixtures/redaction/`
**Reads:** `contracts/08-redaction.md`, `apps/ingest/src/server.ts` (to know insertion points)
**Do not touch:** `packages/clio/**` (A7 owns), any other ingest file outside `apps/ingest/src/redact/`

**Decision the agent makes at start:** subprocess (shell out to Go binaries + Python Presidio daemon) vs JS-native (regex-based secret detection + Xenova NER for PII). Document choice + rationale in PR body. Subprocess buys higher recall; JS-native buys zero-deploy complexity. Either is acceptable if the gate passes.

**Specifics per CLAUDE.md:**
- Redaction targets: `prompt_text`, `tool_input`, `tool_output`, `raw_attrs`.
- Output: `<REDACTED:type:hash>` markers (match the chip renderer in `apps/web/`); `redaction_count++` on event; `redaction_audit` row per hit.
- Tier-A `raw_attrs` allowlist enforced at write-time.

**Acceptance:**
- 100-secret adversarial corpus in `packages/fixtures/redaction/secrets/` — AWS keys, GCP service accounts, GitHub PATs, Slack webhooks, JWTs, Postgres URLs, passwords, PII names/emails/SSNs. Mix real-format and near-miss.
- Test suite asserts ≥98% recall on the corpus (MERGE BLOCKER).
- 100% rejection of forbidden fields (`prompt_text`, `rawPrompt`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`) on Tier A/B events.
- `redaction_audit` row shape matches contract 09.

**PR title:** `feat(redact): server-side redaction hot path — ≥98% recall adversarial corpus (G-back MERGE BLOCKER)`

---

### A7 — Clio on-device pipeline (B + G)

**Owns:** `packages/clio/src/**` (redact, abstract, verify, embed stages), `packages/fixtures/clio/`
**Reads:** `contracts/06-clio-pipeline.md`, `packages/redact/` (re-exports for secrets)
**Do not touch:** `packages/redact/engines/` (A6 owns)

**Specifics per CLAUDE.md §D27:**
- **Redact:** reuse `@bematist/redact`'s TruffleHog + Gitleaks + Presidio engines.
- **Abstract:** priority order — user's own running Claude Code / Codex via local MCP → local Ollama Qwen 2.5-7B (bundled config) → skip + flag `abstract pending`. **NEVER cloud LLM on raw prompt.**
- **Verify:** Clio verifier LLM returns YES/NO on identifying content; drop on YES, no retry.
- **Embed:** local Xenova `@xenova/transformers` MiniLM-L6 (22MB, 384-dim, Apache 2.0); cache by `sha256(abstract)`.
- **Output:** `PromptRecord { sessionIdHash, promptIndex, abstract, embedding, redactionReport }`. NEVER `rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`.

**Acceptance:**
- 50-prompt adversarial fixture in `packages/fixtures/clio/identifying/`: prompts with PII, secrets, proper nouns, filesystem paths.
- Verifier test asserts ≥95% recall catching identifying content (MERGE BLOCKER).
- E2E pipeline test proves raw prompt never reaches embed stage (assertion: embed input matches `abstract`, not raw).

**PR title:** `feat(clio): on-device 4-stage pipeline + ≥95% verifier recall (D27 MERGE BLOCKER)`

---

### ~~A8 — Embed provider chain~~ (RETIRED — shipped via #25 + #29)

The 4-tier resolver (OpenAI / Voyage / Ollama / Xenova), Redis L1 + Postgres L2 cache, cacheKey derivation, and cost guards all landed on main. If you need to extend the chain, open a narrow follow-up PR; do not re-spawn this agent.

---

### A9 — Twin Finder live API wire-up

**Owns:** `packages/api/src/queries/cluster.ts` (add Twin Finder query endpoint using `packages/scoring/src/twinFinder.ts`), `apps/web/app/(dashboard)/clusters/page.tsx` (surface k-NN results), `apps/worker/src/index.ts` (register the #30 recluster cron if not already registered)
**Reads:** `packages/scoring/src/twinFinder.ts` (on main), `packages/embed/src/embedCached.ts`, `apps/worker/src/jobs/cluster/recluster.ts`.
**Depends on:** Jorge #17 (control-plane `prompt_clusters` table) merged — **or** agent defines minimal prompt_clusters shape inline against contract 09 if #17 still pending. Document which path taken in PR body.
**Shared-file collision:** `apps/worker/src/index.ts` (cron registry) — also touched by A10, A11; merge sequentially.

**Specifics:**
- Twin Finder live endpoint: cosine similarity against `embedding_cache` + `prompt_clusters` centroids; top-K k-NN. p95 < 500ms on a 10k-embedding fixture.
- Enforce k ≥ 3 contributor floor before returning cluster results (per CLAUDE.md Privacy Model Rules).
- Hook #30's nightly recluster into `apps/worker/src/index.ts` (if not already; check first).
- Web surface: wire `/dashboard/clusters` page to the new query.

**Acceptance:** live Twin Finder unit test on 10k-fixture within p95 budget; cron registered; `/clusters` page renders against real query.

**PR title:** `feat(cluster): Twin Finder live API + /clusters page wire-up + cron registration`

---

### A10 — Insight Engine adversarial eval + web wire-up

**Owns:** `apps/worker/src/jobs/insight/eval/**` (new adversarial fixture + judge runner building on #28), `packages/api/src/queries/insights.ts` (consume High-confidence output), `apps/web/app/(dashboard)/insights/page.tsx` (render against real API).
**Reads:** existing `apps/worker/src/jobs/insight/h4{a..f}_*.ts + pipeline.ts` (#26 skeleton on main), `packages/scoring/src/v1/eval/` (#28 LLM-judge harness), contract 07 §insights.
**Do not touch:** the H4a–H4f phase files themselves — Jorge's skeleton is authoritative. Add eval + wire-up only.
**Shared-file collision:** `apps/worker/src/index.ts` (cron registration).

**Specifics per CLAUDE.md §AI Rules:**
- Build the **50 synthetic team-week adversarial scenarios** fixture (does not exist on main yet) per §8.3.
- Reuse #28's LLM-judge harness; new gate: LLM-judge ≥ 0.7 · **MERGE BLOCKER**.
- Citation-grounding validator: mutate IDs in the fixture; pipeline must drop (not regenerate infinitely).
- Confidence gate visible on `/insights`: High shown, Med labeled "investigate", Low never shown.
- Prompt-injection envelope + prompt-caching already in #26 skeleton — verify, don't replace.

**Acceptance:** 50-case adversarial eval ≥ 0.7; citation-grounding validator tests; `/insights` renders real output.

**PR title:** `feat(insight-engine): adversarial eval ≥ 0.7 + /insights wire-up (M2 MERGE BLOCKER)`

---

### A11 — Anomaly SSE emitter + web wire-up

**Owns:** `apps/web/app/sse/anomalies/route.ts` (replace any stub; tail `alerts` table for real), `apps/worker/src/index.ts` (register #27's detector + notifier on an hourly cron if not already).
**Reads:** `apps/worker/src/jobs/anomaly/detector.ts + notifier.ts` (#27 on main), `apps/worker/src/jobs/anomaly_detect.ts`.
**Do not touch:** detector math — #27 is authoritative. Wire only.
**Shared-file collision:** `apps/worker/src/index.ts`.

**Specifics per CLAUDE.md §AI Rules:**
- Hourly cadence — NOT weekly. 3σ threshold + cohort fallback for new devs already in the detector.
- SSE channel tails the `alerts` table (confirm table exists on main or blocked on #17) and streams new rows.
- Integration test: connect → detector writes an alert row → client receives event within 5s.

**Acceptance:** SSE integration test green; hourly cron registered; anomaly visible on dashboard.

**PR title:** `feat(anomaly): live /sse/anomalies emission + hourly cron (wire-up of #27)`

---

### A12 — 500-case scoring eval (H-scoring)

**Owns:** `packages/scoring/src/v1/__fixtures__/` (expand), `packages/scoring/src/v1/eval/` (expand)
**Reads:** existing 60-case fixture + `packages/scoring/src/v1/eval/runner.ts`
**Do not touch:** `packages/scoring/src/v1/` math files (locked per CLAUDE.md — math is `ai_leverage_v1`; only eval expands)

**Specifics:**
- Expand 60 → 500 synthetic dev-month cases. One per archetype × parameter sweep (token range, outcome count, maturity stage, retention pattern). Use existing `generate.ts` helpers.
- Add **100-case held-out validation split**: sampled differently (e.g., different seed, different archetype weights); `runner.ts` asserts both the train and held-out sets pass MAE ≤ 3 + no-outlier > 10 gates.
- Keep total runtime < 30s (pure math, no I/O — should stay well under).
- `test:scoring` script in root `package.json` already exists; just expand fixtures.

**Acceptance:** `bun run test:scoring` passes both splits, runs < 30s. Merge-blocking via CI.

**PR title:** `feat(scoring): 500-case eval + 100-case held-out split; enforce MAE ≤ 3 (M2 MERGE BLOCKER)`

---

### A13 — Compliance docs (I)

**Owns:**
- `legal/review/cse-consultation-FR.md`
- `legal/review/union-agreement-IT.md`
- `legal/review/SCCs-module-2.md`
- `legal/review/CAIQ-v4.0.3.md`
- `legal/review/SIG-Lite-2024.md`
- `legal/review/cyclone-dx-SBOM.md`
- `legal/review/SOC2-prep.md`

**Reads:** `legal/review/works-agreement-DE.md` (style template), `dev-docs/workstreams/i-compliance-prd.md` (Sandesh's PRD with CR-9, CR-10, and verbatim citations).

**Specifics:**
- Match the DE works-agreement structure and tone.
- FR: Groupe Alpha method agreement (15 Dec 2025) + Metlife Europe (June 2025) red-lines + **TJ Nanterre 29 Jan 2026** pilot-not-exempt clause.
- IT: **GSK–ViiV Healthcare + RSU accordo (28 Jul 2025)** exemplar; 21-day retention ceiling per **Garante Provv. 364/2024**; strumento-di-lavoro comma-2 trap per **Cass. 28365/2025**.
- SCCs: Commission SCCs 2021/914 Module 2 + TIA + DPF self-cert plan.
- CAIQ v4.0.3 + SIG Lite 2024: pre-filled vendor questionnaires (use the draft grid in Sandesh's PRD).
- CycloneDX SBOM: generation script + example output.
- SOC 2 prep: outline of Type I readiness (Phase 2) → Type II (Phase 3).

**Acceptance:** every file exists; each follows the DE template sections (scope, permitted use, employee rights, data protection, conflict resolution); CR-9 and CR-10 from compliance PRD addressed verbatim.

**PR title:** `feat(compliance): FR CSE + IT union-agreement + SCCs + CAIQ + SIG Lite + SBOM + SOC 2 (Workstream I)`

---

### A14 — Ed25519 signed-config validator + cooldown

**Owns:** `packages/config/src/signed-config.ts`, `apps/ingest/src/policy-flip/**`
**Reads:** `contracts/02-ingest-api.md` §Auth, `CLAUDE.md` §Security Rules (D20)
**Do not touch:** existing `packages/config/src/{paths,atomicWrite,pricing,bill-of-rights}.ts`.

**Specifics per D20:**
- Tenant-wide Tier-C admin flip requires Ed25519-signed config payload.
- 7-day cooldown enforced between flips; violations rejected.
- IC banner emitted at flip time via `alerts` row (A0 stub table) + SSE push.
- Audit row per flip — signer fingerprint, tenant, timestamp, previous/new tier.
- Pinned public key(s) via env `SIGNED_CONFIG_PUBLIC_KEYS` (comma-separated hex).

**Acceptance:** valid/invalid signature tests, cooldown enforcement tests, audit write verification.

**PR title:** `feat(policy): Ed25519 signed-config validator + 7-day cooldown for Tier-C admin flip (D20)`

---

### A15 — Perf gate enforcement (F)

**Owns:** `packages/fixtures/seed/**` (event seed generator), `tests/perf/*.k6.js` (expand existing `dashboard.k6.js` + add `ingest.k6.js`), `.github/workflows/perf.yml` (wire as merge blocker)
**Reads:** A0's MV shapes, existing `tests/perf/run.sh`.

**Specifics per CLAUDE.md §Testing Rules:**
- Seed generator writes 1M events into ClickHouse (via docker-compose stack) — 100 devs × 90d × 100 events/day.
- k6 scenarios:
  - `dashboard.k6.js` — 50 concurrent dashboard users, hit `/dashboard/summary`, `/teams`, `/sessions` for 2 min; assert p95 < 2s.
  - `ingest.k6.js` — 1k events/s sustained for 2 min against `/v1/events`; assert p99 < 100ms.
- Wire as CI merge blocker: `perf` workflow fails on threshold breach.

**Acceptance:**
- Both gates pass on A0 stubs + existing ingest.
- CI `perf` workflow exits 1 if p95/p99 breached.

**PR title:** `feat(perf): 1M-event seed + k6 dashboard/ingest gates — MERGE BLOCKER (F)`

---

## 5. Wave 2 — Integration (parallel after Wave 1 merges)

### A16 — Privacy adversarial gate assembly

**Depends on:** A6, A7, A11, A14, A0 merged.
**Owns:** `tests/privacy/adversarial/**` (new test suite), `.github/workflows/privacy.yml` (new CI workflow), root `package.json` `test:privacy` script (replace stub)
**Reads:** outputs of A6, A7.

**Specifics:**
- Assemble all three gates behind one `bun run test:privacy`:
  1. A6's TruffleHog+Gitleaks+Presidio — ≥98% recall on 100-secret corpus
  2. A7's Clio verifier — ≥95% recall on 50-prompt identifying corpus
  3. Existing forbidden-field fuzzer — 100% rejection on seeded corpus
  4. **Nightly invariant scan**: 0 raw secrets or forbidden fields present in ClickHouse rows.
  5. RLS cross-tenant probe (INT9) — returns 0 rows.
- Wire `.github/workflows/privacy.yml` as merge blocker on any `packages/redact/**`, `packages/clio/**`, `apps/ingest/src/**` change.

**Acceptance:** `bun run test:privacy` exits 0 green on main; CI gate fires on regressions.

**PR title:** `feat(privacy): adversarial gate assembly — all 5 thresholds (M2 MERGE BLOCKER)`

---

### A17 — End-to-end + `USE_FIXTURES=0` verification

**Depends on:** A0 + A6 + A8 + A11 merged (at minimum).
**Owns:** `apps/web/integration-tests/**`, `apps/ingest/src/smoke.ts` (expand to seed real CH), `docker-compose.dev.yml` seed hook (optional), `apps/worker/src/index.ts` wire-up (consolidate A9 + A10 + A11 cron registration in one commit — ask the orchestrator before touching if the wave-1 collisions are still unresolved)
**Reads:** all of Wave 1.

**Specifics:**
- Drive one real event collector → ingest → CH (A0 stub table) → dashboard query.
- Flip `USE_FIXTURES=0` locally and in one CI smoke job.
- Produce a short `docs/m2-demo.md` transcript with commands + expected output.

**Acceptance:** end-to-end smoke passes against stubbed MVs; `USE_FIXTURES=0` dashboard renders one real tile.

**PR title:** `test(e2e): event traverses collector → ingest → stub MV → dashboard (USE_FIXTURES=0)`

---

## 6. Execution graph

```
                      (Wave 0 retired — A0 stubs obsolete; A0' optional)
    ╔══════════════════════════════════════════════════╗
    ║          Wave 1 — launch in parallel today       ║
    ║                                                  ║
    ║  B-lane (merge sequentially on adapters/index.ts)║
    ║    A1 Codex   A2 Cursor   A3 OpenCode            ║
    ║    A4 Continue.dev   A5 VS Code generic          ║
    ║                                                  ║
    ║  Privacy-lane                                    ║
    ║    A6 server redact   A7 Clio on-device          ║
    ║                                                  ║
    ║  AI-lane wire-ups (seq on worker/index.ts)       ║
    ║    A9 Twin Finder API  A10 Insight Engine eval   ║
    ║    A11 anomaly SSE wire                          ║
    ║    (A8 retired — providers shipped via #25/#29)  ║
    ║                                                  ║
    ║  Gates                                           ║
    ║    A12 500-case eval  A15 perf gate              ║
    ║                                                  ║
    ║  Policy                                          ║
    ║    A14 Ed25519 signed config                     ║
    ║                                                  ║
    ║  Compliance                                      ║
    ║    A13 FR/IT/SCCs/CAIQ/SIG/SBOM/SOC2             ║
    ╚══════════════════════╤══════════════════════════╝
              in parallel: │  Jorge rebases #17 → #18 → #19
                           │  (or A0' reconciles)
                           │
                         Wave 2
                  ┌────────┴────────────────┐
                  │                         │
                  ▼                         ▼
           A16 privacy gate          A17 E2E USE_FIXTURES=0
                  │                         │
                  └──────────┬──────────────┘
                             │
                             ▼
                     ━━━━━━━ M2 gate ━━━━━━━
```

## 7. Standard preamble (prepend to every agent prompt)

```
You are one of ~13 Opus-4.7 subagents building the Bematist M2 gate in parallel.
Before writing any code, read:

- /Users/sebastian/dev/gauntlet/analytics-research/CLAUDE.md — locked project conventions
- /Users/sebastian/dev/gauntlet/analytics-research/WORKSTREAMS.md — lane scope + M2 checkpoint definition
- /Users/sebastian/dev/gauntlet/analytics-research/dev-docs/PRD.md — decision history D1–D32
- /Users/sebastian/dev/gauntlet/analytics-research/contracts/<the seam(s) in your OWNS section>
- /Users/sebastian/dev/gauntlet/analytics-research/dev-docs/m2-gate-agent-team.md — this plan

Then follow these rules:

1. You are in an isolated git worktree off main. The `main` you see is the latest merged state.
2. Branch off `main`: `git checkout -b <branch-suggested-in-PR-title-slugified>`.
3. Stay inside your OWNS scope. If you must touch a file in "DO NOT TOUCH", stop and report back.
4. Follow CLAUDE.md conventions: no unnecessary comments, no speculative abstractions, no features beyond the brief. Default to no comments; only write one when the WHY is non-obvious.
5. When the brief calls out a MERGE BLOCKER gate (adversarial recall, MAE, p95), your tests MUST enforce it — not just log it.
6. Run `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test` at the end. Fix anything that fails in YOUR scope. Pre-existing warnings are OK.
7. Commit messages: single concise subject line, Co-Author trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
8. Push and open a PR: `gh pr create --base main --title "..." --body "..."`. Body must include: what changed (files), why (brief + contract refs), test plan (checklist), MERGE BLOCKER status if any.
9. Do NOT run `gh pr merge`. Report back: PR URL, test results, anything surprising.

Keep your final report under 250 words. The orchestrator (a human) reviews + merges.
```

## 8. Merge-order hints for the orchestrator

- **Adapters A1–A5.** Each touches `apps/collector/src/adapters/index.ts`. Merge one, re-sync the next, merge, etc. OR: merge A1, then ask remaining agents to rebase + resolve the one-line registration conflict in parallel. Lower-risk: sequential.
- **Worker wire-ups A9, A10, A11.** Same story for `apps/worker/src/index.ts` (cron registry). Sequential merges or delegated rebase.
- **Wave 2 (A16, A17)** after the Wave-1 items they depend on.
- **Jorge's remaining PRs (#17, #18, #19)** land whenever Jorge rebases (or A0' reconciles). A18 (RLS probe) is a MERGE BLOCKER; A9/A10/A11 should note in PR body whether they consumed #17's tables or inlined a minimal shim.

## 9. Definition of done — M2 gate

- [ ] `bun run test:scoring` — MAE ≤ 3, no outlier > 10, both splits (A12) · **MERGE BLOCKER**
- [ ] `bun run test:privacy` — ≥98% secret recall, 100% forbidden rejection, ≥95% Clio verifier, 0 raw leakage, 0 cross-tenant rows (A16) · **MERGE BLOCKER**
- [ ] `bun run test:perf` — p95 dash < 2s, p99 ingest < 100ms on 1M seeded events (A15) · **MERGE BLOCKER**
- [ ] All 6 v1 adapters with golden fixtures (A1–A5 + pre-existing Claude Code)
- [ ] Server-side redaction live in ingest hot path (A6)
- [ ] Clio on-device 4-stage pipeline (A7)
- [x] ~~Embed provider chain~~ (#25 + #29 merged)
- [x] ~~Twin Finder math + nightly cluster~~ (#30 + #31 merged) — live API wire-up pending (A9)
- [~] Insight Engine H4a–H4f skeleton (#26 merged) — adversarial eval ≥ 0.7 + web wire-up pending (A10)
- [~] Anomaly detector (#27 merged) — SSE emission + hourly cron wire-up pending (A11)
- [ ] Ed25519 signed-config + 7-day cooldown (A14)
- [ ] Compliance docs complete: FR, IT, SCCs, CAIQ, SIG Lite, CycloneDX SBOM, SOC 2 prep (A13)
- [ ] E2E smoke `USE_FIXTURES=0` passes end-to-end (A17)
- [x] ~~PR #34~~ merged (reconciled D1-05 + D1-06: control-plane tables + RLS + INT9 probe + audit-log immutability trigger)
- [ ] 24-hour Bun↔ClickHouse soak (F15/INT0) initiated at the M2 tag — `apps/ingest-sidecar/` already on main; soak harness still pending

## 10. Change log

- **2026-04-17** — Jorge PRs #13–16, #24–32 merged. Retired A0 (stubs obsolete), A8 (shipped). Downgraded A9/A10/A11 to wire-up briefs. Added A0' as optional rebase-assist for #17/#18/#19. Agent count 17 → 13 (12 if Jorge rebases on his own).
- **2026-04-17 (later)** — A0' completed: #17 + #18 reconciled into **#34** (keeps Walid's `ingest_keys`/`policies`/`git_events` shapes; adopts Jorge's 9 new tables, audit trigger, custom/ migration folder, RLS policies, INT9 probe). 554 tests pass including 5 INT9 tests. #17, #18, #19 closed. #19 closed (sidecar skeleton already on main); thin follow-up deferred. **#34 merged**. Agent count 12.
