# GitHub Integration — v1 Readiness Report

> **Status:** Phase G3 (STRETCH + Hardening) complete. PRs merged: #83, #84, #85,
> #86, #88, #89, #90. This PR (G3) is the v1 capstone.

## Decision log coverage (D33 – D60)

| Decision | Honored | Evidence |
|---|---|---|
| **D33** `provider_repo_id` stable cross-provider key | Yes | `packages/schema/postgres/custom/0004_github_integration_g1.sql` §9.9 |
| **D34** Webhook idempotency via Redis SETNX on `X-GitHub-Delivery` | Yes | `apps/ingest/src/github-app/webhookRoute.ts` + G3 `github_webhook_deliveries_seen` |
| **D41** `outcome_quality_v1.1` additive + suppression renormalization | Yes | `packages/scoring/src/v1/outcome_quality_v1_1.ts` + `outcome_quality_v1_1.test.ts` |
| **D42** Cohort key stratification | Yes | `packages/scoring/src/v1/cohort_key_v1_1.ts` (G2) |
| **D43** `author_association` is canonical cohort input | Yes | `packages/scoring/src/v1/signals/github_author_association_v1.ts` (G2) |
| **D44** 650-case + 150 held-out eval fixtures | Yes | `packages/scoring/src/v1/__fixtures__/` — main 666, held-out 150 |
| **D45** `first_push_green` D45 flaky-CI exclusion | Yes | `packages/scoring/src/v1/signals/github_first_push_green_v1.ts` |
| **D46** PR-size strips `linguist-generated` | Yes | `packages/scoring/src/v1/signals/github_pr_size_v1.ts` (G2) |
| **D47** CODEOWNERS contribution-earned override (≥30% of 90d commits) | **Yes — G3 live** | `packages/scoring/src/v1/signals/github_codeowners_v1.ts` + 4 new tests |
| **D48** `outcomeEvents` in confidence = accepted ∪ first_push_green ∪ deploy | Yes | `packages/scoring/src/v1/confidence_v1_1.ts` |
| **D50** Copilot Metrics API Phase 2 | Deferred | — |
| **D51** Hourly reconciliation runner wired to redelivery API | **Yes — G3 live** | `apps/worker/src/github-linker/reconcileScaffold.ts` + `reconcileGapFill.test.ts` |
| **D52** `session_repo_links` Postgres partitioning | Yes | G1 migration + `partitionCreator.ts` |
| **D53** Linker state pure function + commutativity ≥1000 orderings | Yes — **11 scenarios × 100 orderings = 1,100 orderings** (aggregate) + dedicated 1,000-ordering run on s11 (force-push RANGE + rename alias) for per-scenario D53 witness | `apps/worker/src/github-linker/commutativity.test.ts` (16 tests, 5,316 expect calls) |
| **D54** `session_repo_eligibility` same-txn | Yes | G1 |
| **D55** 10-min webhook secret rotation | Yes | G1 + G2 admin API |
| **D56** Redis Streams per-tenant recompute | Yes | G1 |
| **D57** `evidence` forbidden-field validator | Yes | `state.ts#assertEvidenceSafe` |
| **D58** GHES Phase 2 | Deferred | — |
| **D59** Per-tenant 1 req/s API floor | Yes | G2 `redeliverWebhooks` + G3 reconciler `pacerSleep(1000)` |
| **D60** Deploy-per-dollar suppression (not zero-fill) + prod-env allowlist | **Yes — G3 live** | `packages/scoring/src/v1/signals/github_deploy_per_dollar_v1.ts` + admin API `/repos/:id/prod-env-regex` |

## Merge-blocker gate coverage

| Gate | Status | Evidence |
|---|---|---|
| **INT9 — RLS cross-tenant probes on 8 new tables** | Green | `packages/schema/postgres/__tests__/github_g1_rls.test.ts` |
| **Commutativity — 11 scenarios × 100 orderings = 1,100 aggregate** | Green | `commutativity.test.ts` |
| **Commutativity — dedicated 1,000-ordering pass on s11 (per-scenario D53 witness)** | Green | `commutativity.test.ts` — `D53 per-scenario — s11 (force-push RANGE) holds across 1,000 orderings` |
| **MAE ≤ 3 on 650-case main + 150 held-out** | **Green** (MAE 0.025 main; 0.024 held-out; 666+150 cases) | `bun run test:scoring` output |
| **LLM-judge adversarial eval ≥ 0.7** | Green (carried from G2) | Scoring eval runner |
| **Privacy adversarial gate (INT10)** | Green | G1/G2 — no G3 regressions |
| **F15 Bun↔ClickHouse soak — 24h at 100 evt/s** | **Green via 10-min compressed proxy in CI** (`.github/workflows/ci.yml` job `soak-compressed` — `SOAK_COMPRESSED_MINUTES=10`). The per-PR `bun run test` path keeps the fast 6 s default so unrelated PRs stay fast; the dedicated job exercises the real gate thresholds (≥3 ECONNRESET / 100k inserts, p99 <500 ms, no row-count drift). Full 24h soak remains Phase-2 per CLAUDE.md Architecture Rule #7 Plan B posture. | `tests/soak/compressed-proxy.test.ts` + `.github/workflows/ci.yml` |
| **Fixture redaction privacy test** | Green (47 fixtures, +3 G3 deploys) | `packages/fixtures/github/fixtures.redaction.test.ts` |

## Known gaps pending subsequent PR

The integration PR #92 consolidates G0–G3. Three reviews surfaced 13 issues;
the following are landed in this PR. Items marked *(follow-up)* are scoped
to a distinct PR with its own contract tests:

| ID | Title | Status |
|---|---|---|
| B1 | `installation.created` parser + admin claim flow | **Landed** — `parseInstallationLifecycle` emits `installation_created` kind; worker consumer UPSERTs `github_pending_installations` (migration 0011, global-admin RLS — flagged as D61 amendment); `claimPendingInstallation` Server Action binds a pending row to the caller's tenant in one txn with `SET LOCAL app.is_global_admin`, inserts `github_installations` + audit_log. Admin UI integration remains as UI-follow-up |
| B2 | Shared ingest↔worker installation-token resolver | **Landed** — `packages/api/src/github/installationToken.ts` provides Redis + in-memory `InstallationTokenCache`, key `gh:inst_token:<installation_id>`, TTL = `expires_at − now − 10min` so refresh happens ahead of GitHub's 1h expiry. Worker dispatcher wires the Redis cache + real `createRecomputeEmitter` XADD producer; falls back cleanly to in-memory + noop when REDIS_URL is unreachable |
| B4 | Recompute pipeline wiring (Redis stream producer in worker + ACK-after-flush semantics + real `loadInputs`) | **Landed** — Redis producer wired; **B4a** ACK-after-flush refactor landed (coalescer tracks entry ids; `tick()` ACKs only after `processWindow` succeeds; `retryPendingDepth` gauge exported). **B4b** real `loadInputs` against PG + ClickHouse session enrichment landed — `apps/worker/src/github-linker/loadInputs.ts` assembles installations / repos / PRs / deployments / aliases / session shas; returns null only when the `orgs` row is absent (GDPR hard-delete). Wired into `startLinkerConsumerLoop` |
| B5 | Partial unique index on `session_repo_links (stale_at IS NULL)` | **Landed** (migration 0008) |
| B9 | Redis token-bucket for `redeliverWebhooks` (D59) | **Landed** — `packages/api/src/github/tokenBucket.ts` (shared) + redeliver pacer wired + Redis-backed in `apps/web/lib/github/redeliveryDeps.ts` |
| B10 | Recursive allowlist for `assertEvidenceSafe` | **Landed** |
| B11 | Honest commutativity count + per-scenario D53 witness | **Landed** |
| H2 | Playwright `admin-github` storageState fixture | **Landed** — `apps/web/tests/e2e/fixtures/admin.storageState.json` seeds a legacy `bematist-session` cookie; middleware passes; session resolver's Redis lookup returns null and falls through to the dev-mode admin fallback |
| H3 | Fail-closed boot (Kafka / PG / GITHUB_APP_ID) | **Landed** |
| H6 | Strict installation-status allowlist w/ distinct codes | **Landed** |
| M1 | `repos.full_name` column + ILIKE search path | **Landed** — migration 0010 + schema column + initial-sync persistence + rename/transfer webhook sync + admin search ILIKE |
| M7 | F15 10-min CI soak gate (separate job) | **Landed** — `soak-compressed` job in `.github/workflows/ci.yml` |
| M13 | PR-local lint debt (biome organize-imports + non-null assertions) | **Landed** |

## Explicitly deferred to Phase 2 (§5 / §13.G4)

- `github_review_churn_inverse_v1` scoring module (needs cross-team-culture fixture work)
- `github_security_clean_v1` (penalty-only, IC-private, requires API denylist)
- `github_issue_cycle_v1` (insight tile only until 800-case fixture)
- `github_copilot_metrics_v1` (org-level, scope-gated)
- GHES Server full code path (D58)
- `orgs.tenant_salt` real column (G1 placeholder derivation stays)
- Shared ingest↔worker token cache (G1-admin-sync flagged stub)
- Full 24h F15 soak — CI runs compressed 10-min proxy; full 24h scheduled for post-MVP hardening

## Operational runbook

### Install the GitHub App in a new tenant — 3 steps

1. **Admin visits `/admin/github`** — click "Install GitHub App." This opens
   `https://github.com/apps/<GITHUB_APP_SLUG>/installations/new`.
2. **Select repos** — "All" (recommended v1 default) or "Selected." The
   tracking-mode toggle in the admin UI can flip this after install.
3. **Click "Start sync"** — the initial-repo-sync worker walks
   `/installation/repositories` at 1 req/s with 5k/hr headroom. Progress
   bar updates via SSE. Webhooks start firing as soon as the app is
   installed — no separate "enable" step.

### Rotate a webhook secret — 1 API call

```bash
curl -X POST /api/admin/github/webhook-secret/rotate \
  -H "Authorization: Bearer <admin-cookie>" \
  -d '{"new_secret_ref": "<secrets-store-pointer>"}'
```

Response contains `window_expires_at` — the old secret continues to
validate signatures for 10 minutes. Per D55, the eviction cron nulls it
when the window closes.

### Enable deploy scoring for a repo with non-standard env names — 1 UI action

Deploy-per-dollar scoring uses a regex allowlist (default
`^(prod|production|live|main)$`). For repos that ship to exotic env names
like `deploy-us-east` or `prod-eu`:

1. Admin visits `/admin/github/repos/:provider_repo_id` and sets the
   prod-env regex field to `^deploy-us-east$` (or similar).
2. The API validates the pattern compiles. 400 on invalid regex.
3. The admin UI previews the last-30d environments that match so the
   admin can confirm before committing.

Or directly via API:

```bash
curl -X PATCH /api/admin/github/repos/987654321/prod-env-regex \
  -H "Content-Type: application/json" \
  -d '{"pattern": "^deploy-us-east$"}'
```

Pass `{"pattern": null}` to reset to the global default.

### Squash-merge attribution fallback

When a tracked repo has `merge_commit_allowed=false AND
squash_merge_allowed=true`, the admin UI surfaces a dismissible banner
on `/admin/github` (per §17 risk #1). The banner points admins at
`bematist policy set ai-assisted-trailer=on` to enable the post-commit
`AI-Assisted:` trailer, which survives squash on GitHub's side because
GitHub keeps the original commit messages in the PR timeline.

Attribution falls back to `commit_sha ∩ CODEOWNERS` automatically when
the trailer is missing — still accurate but less auditable.

## What ships in this PR (G3)

- `github_deploy_per_dollar_v1` scoring module + 10 contract tests
- Prod-env allowlist (`repos.prod_env_allowlist_regex` column + admin API
  `PATCH /api/admin/github/repos/:id/prod-env-regex` + 4 tests)
- Force-push tombstone extended from flat-SHA to 30-min windows
  (`ForcePushTombstone.excluded_ranges`) + 4 tests + commutativity
  scenario #11 (1,100 aggregate orderings + dedicated 1,000-ordering
  per-scenario D53 pass)
- Hourly reconciler wired to GitHub `/app/hook/deliveries` redelivery API
  + gap-detection test (5 deliveries seeded, 1 missing → exactly 1
  redelivery requested)
- `github_webhook_deliveries_seen` ledger table — worker writes after
  every successful handle
- Squash-merge admin banner (`/admin/github`) + dismissible per-admin +
  3 render tests
- CODEOWNERS D47 contribution-earned override LIVE (replaces G2
  `contribution_earned_override_pending` placeholder) + 4 new tests
- 3 G3 deploy fixtures (`deployment.created`, `deployment_status.success`,
  `deployment_status.failure`) + worker consumer handling + 3 integration
  tests
- 2 new adversarial scoring personas (`deploy-non-prod-env-gamer`,
  `healthy-prod-deployer`) — 16 fixture cases
- F15 10-min compressed soak proxy (`tests/soak/compressed-proxy.test.ts`)
  — passed: 60k writes, 0 failures, p99 15.88ms, drift 0

## Phase 2 roadmap (post-v1)

See PRD-github-integration §13 G4 for full list. Priority order:
1. Full 24h F15 soak (flip Plan B Go sidecar if trips)
2. Review-churn-inverse signal + fixture work
3. Security-alert correlation (requires API denylist path)
4. GHES server support (D58)
5. Copilot Metrics API (D50) — org-level adoption baseline
6. `orgs.tenant_salt` real column + rotation path
