# GitHub Integration Product Plan

> **Status.** Interim plan. A full `/research-and-plan` pass is recommended to ratify scope, score the outcome-signal upgrades by effort, and land D-numbers in `dev-docs/PRD.md`. This doc is the sharp brief that pass should consume — not a replacement for it.
>
> **Doctrine.** Test-Driven throughout. Every surface listed below follows the loop: webhook fixture committed → failing test → implementation → green → integration test → ship. No surface merges without its contract test (per CLAUDE.md Testing Rules + Adapter Matrix "per-adapter contract tests pinned to golden fixtures").
>
> **Market focus: US only.** All GitHub signals default ON. EU/works-council compliance surface is owned by a separate workstream and being put behind env flags; this plan does not implement EU-specific defaults, per-signal capture flags, or jurisdictional retention policies.

## Summary

GitHub becomes Bematist's first authoritative repo-attribution backend AND the primary outcome-signal source for manager-facing analytics. The plan is not only "persist repo identity and gate reads" — it captures the high-value GitHub signals (CI green-on-first-push, deployments, PR size, review timing, security alerts, CODEOWNERS ownership) that move Bematist from spend analytics to outcome analytics.

Scope: full v1 feature set. Demo-path scaffolding exists to prove wire-up today, but demo-path stubs are **never** shipped to production — production paths fail closed.

## Goals

1. Persist real GitHub installations, repos, PRs, commits, workflow runs, check suites, deployments, and review events in Postgres.
2. Stable repo identity keyed on GitHub `provider_repo_id` that survives rename/transfer.
3. One derived linkage surface authoritative for manager-facing repo-scoped reads.
4. Capture outcome signals GitHub already broadcasts — CI, deploy, review, size, security — and wire them into the scoring layer (`@bematist/scoring` v1 signals + v2 roadmap).
5. Branch is evidence (long-running-branch insight), never eligibility.
6. Production fails closed on missing persistence; demo stubs never survive to prod.

## Non-goals (v1)

- Replacing provider-agnostic schema (GitLab/Bitbucket schema stays; they simply don't have the upgraded outcome-signal capture in v1).
- Rewriting the collector wire contract.
- Rewriting historical ClickHouse `events` rows in place.
- Collector-side GitHub auth — the GitHub App lives on the server side of the trust perimeter.
- Public per-repo leaderboards (CLAUDE.md Non-goals §2.3 still applies).

## V1 Guardrails

- Tracked-repo scope applies to manager/team-facing surfaces: Sessions, Outcomes, Insights, Clusters, `/repos/:id`.
- IC-private `/me` and direct session detail are NOT auto-filtered by tracked-repo scope (by design — engineer sees their own work end-to-end).
- `branch` is stored and shown; branch-only never makes a session eligible.
- "Connected GitHub org" = an active GitHub App installation persisted against a Bematist org; never an in-memory token cache.
- Repo identity survives rename/transfer; `full_name` is display-only.
- Production boot fails closed if any GitHub persistence wiring is missing (Postgres-backed stores, installation state, repo registry resolver, reconciliation runner).
- Webhook HMAC (`X-Hub-Signature-256`) validation is mandatory; a missing/invalid signature → 401 + audit log entry. CLAUDE.md Outcome Attribution §8.5 is load-bearing here.
- Dollar-value surfaces remain gated on D17 (Phase 0 correctness). GitHub integration must not regress D17.

## Local-first → production cutover (no tunneling)

We are not standing up a tunnel for a one-off demo. Path is: build and validate locally against captured fixtures, then deploy the same code to the production ingest URL that already has public HTTPS.

**Existing scaffolding (already on `main`)** — pick up where this left off, do not rebuild:

- `apps/ingest/src/github-app/jwt.ts` + `token-cache.ts` — App JWT minting and installation token cache.
- `apps/ingest/src/github-app/reconcile.ts` — reconciliation runner.
- `apps/ingest/src/webhooks/verify.ts` — `X-Hub-Signature-256` HMAC validation.
- `apps/ingest/src/webhooks/github.ts` + `router.ts` + `parse.test.ts` — webhook parser + dispatch.
- `apps/ingest/src/webhooks/gitEventsStore.ts` — store interface; verify the Postgres-backed impl is wired in non-test boot.

**Local development loop (no public URL, no tunnel):**

1. Capture a real webhook payload once per event type — `gh api` or copy from a real install's "Recent Deliveries" panel — and commit to `packages/fixtures/github/<event>/<scenario>.json`.
2. TDD per surface: red parser test against fixture → green parser → red persistence integration test against a real local Postgres → green persistence → red scoring-signal test → green signal → Playwright E2E that POSTs the fixture to `localhost:8000/v1/webhooks/github` with a correctly computed `X-Hub-Signature-256` and asserts the dashboard tile updates.
3. Run with `bun run dev` against the local Postgres + ClickHouse + Redis from `docker-compose.dev.yml`. No GitHub network calls in the test loop — the App JWT path is exercised separately by `github-app/jwt.test.ts` and friends.
4. For the rare case we need to exercise the live App API end-to-end locally (token minting, `GET /installation/repositories`, reconciliation pulls), use a personal-org GitHub App pointed at a sandbox repo and run those calls outbound from localhost. No inbound webhook needed — those are pulls, not pushes.

**Production cutover (same code, no demo flag):**

1. Deploy the branch to the production ingest URL (already has public HTTPS — that is the only "tunnel" we need).
2. Register the production GitHub App against the real Bematist GitHub org with scopes: `pull_request`, `pull_request_review`, `push`, `check_suite`, `workflow_run`, `deployment`, `deployment_status`, `repository`, read-only metadata, read-only contents (CODEOWNERS), read-only workflows, read-only secret-scanning-alerts.
3. Point the App's webhook URL at the production ingest endpoint; store webhook secret in the platform secrets store (never in `.env` for prod).
4. Install on the dev org's repos. Fail-closed boot guarantees persistence is healthy before traffic arrives; the initial `GET /installation/repositories` sync populates the registry; webhooks start landing.
5. Watch `bematist_github_webhook_received_total{status}` and `bematist_github_reconciliation_gap_seconds` for the first 24h. Replay any missed deliveries with `POST /api/admin/github/redeliver`.

**No demo-path stubs.** No `BEMATIST_DEMO_MODE` flag, no hard-coded repo hash, no HMAC bypass, no in-memory store fallback. Local dev uses real Postgres + captured fixtures; production uses real Postgres + real webhooks. Same code, same paths, no special-casing.

## Existing Baseline To Preserve

- ClickHouse `events` carries `pr_number`, `commit_sha`, `branch`, `repo_id_hash`.
- Repo / PR / commit rollups in ClickHouse.
- Collector wire contract unchanged.
- GitLab and Bitbucket schema/support intact.
- Contract 02 ingest-api and contract 09 storage-schema are the source of truth for field names; this plan extends, doesn't redesign.

## Implementation Changes

### Product model

- First-class GitHub connection per Bematist org (1:N — one Bematist org can connect multiple GitHub installations; one GitHub installation belongs to exactly one Bematist org).
- Tracked-repo scope at org level with two modes:
  - `all`: every discovered repo in every connected installation is in scope.
  - `selected`: only explicitly included repos are in scope.
- Per-repo `tracking_state ∈ {inherit, included, excluded}`. Resolution table (makes `inherit` unambiguous):

  | org mode | repo state | effective |
  |---|---|---|
  | `all` | `inherit` | included |
  | `all` | `included` | included |
  | `all` | `excluded` | excluded |
  | `selected` | `inherit` | excluded |
  | `selected` | `included` | included |
  | `selected` | `excluded` | excluded |

- First-class "long-running branch / no PR yet" insight theme with the concrete v1 rule:
  - non-default branch
  - branch first seen more than 7 days ago
  - session already repo-relevant through direct repo / commit / PR linkage
  - no linked open or merged PR exists for that branch

### GitHub tenancy and repo registry

- Persist GitHub installation metadata in a new org-scoped control-plane table `github_installations`:
  - `bematist_org_id`, `installation_id`, `github_org_id`, `github_org_login`, `status` (`active` | `suspended` | `uninstalled`), `installed_at`, `suspended_at`, `uninstalled_at`, `last_repo_sync_at`, `webhook_secret_ref` (pointer into the secrets store, never plaintext), `app_id`, `permissions_snapshot` (JSON).
- Persisted installation record IS the definition of "connected GitHub org". No in-memory token cache survives restart.
- Installation lifecycle:
  - `installation.created` → upsert + initial repo sync (see below)
  - `installation.suspend` → flip status, stop accepting webhooks (but keep record)
  - `installation.unsuspend` → flip back, run reconciliation for the gap window
  - `installation.deleted` → mark uninstalled, retain history for audit, surface "reconnect to resume" in UI
- **Initial repo sync on install** is explicit: `GET /installation/repositories` paginated. Budget for 5000-repo orgs: rate-limit-aware with exponential backoff, run as a PgBoss cron job, surfaced in admin UI as progress. Not webhook-driven.
- Token lifecycle: GitHub App JWT signed per-request from App ID + private key; installation tokens cached in Redis with 50-minute TTL (actual lifetime 60 min) and re-minted on miss. Plaintext private key never on disk outside the secrets store.
- Webhook secret rotation: admin-triggered, atomic, dual-accept window of 10 minutes where both old and new secret verify.

### Postgres schema

- Extend `repos`:
  - `provider` (existing, enforced to `github`/`gitlab`/`bitbucket`)
  - `provider_repo_id` (new, NOT NULL for `github` rows)
  - `full_name`
  - `default_branch` (nullable)
  - `archived_at`, `deleted_at` (soft lifecycle)
  - `tracking_state ∈ {inherit, included, excluded}` default `inherit`
  - `first_seen_at`
  - UNIQUE on `(provider, provider_repo_id)` — enforces rename-safe identity.
- Org-scoped settings (existing `orgs` or `org_settings`):
  - `github_repo_tracking_mode` default `all`
- `git_events` extensions:
  - `branch` (nullable)
  - `repo_id_hash` (nullable)
  - `commit_sha` (nullable — already in ClickHouse, mirror here for join convenience)
  - `pr_number` (nullable)
  - `author_association` (nullable — `MEMBER` / `FIRST_TIME_CONTRIBUTOR` / etc.; useful cohort signal)
- Legacy `git_events.repo_id`: normalize to `provider_repo_id`. If a safe rename can't happen in v1, keep `repo_id` as an alias column with a view and schedule retirement — alias map MUST have a retirement date in the migration comment, not "TBD".
- Stable hash semantics:
  - `repo_id_hash = HMAC(provider + ":" + provider_repo_id, tenant_salt)`
  - `full_name` is display-only.
- One-time backfill / cutover:
  - Historical rows with name-derived hashes get an alias mapping `(old_hash → new_hash)` stored in `repo_id_hash_aliases` with `retires_at = migration_date + 90 days`.
  - All read queries join through the alias view until retirement.
  - Post-retirement: alias table is archived; any orphan rows are reported and either re-hashed or deleted per `bematist erase` semantics.
- New tables:
  - `github_installations` (above).
  - `github_pull_requests` — PR metadata cache keyed on `(provider_repo_id, pr_number)`: `head_ref`, `base_ref`, `head_sha`, `merge_commit_sha`, `state`, `merged_at`, `is_fork`, `additions`, `deletions`, `changed_files`, `author_login_hash`, `first_review_at`, `first_approval_at`, `changes_requested_count`.
  - `github_check_suites` — `(provider_repo_id, head_sha)` keyed; `conclusion`, `first_completed_at`, `runs_count`, `failed_runs_count`.
  - `github_deployments` — `(provider_repo_id, deployment_id)`; `environment`, `sha`, `status`, `created_at`, `first_success_at`.
  - `github_code_owners` — parsed CODEOWNERS per repo + ref, cached with a content-hash invalidation key.
  - `github_security_alerts` — secret-scanning + CodeQL + Dependabot; `alert_id`, `rule_id`, `state`, `resolved_at`, `linked_commit_sha`, `linked_pr_number`.
  - `session_repo_links` — the **derived linkage surface**, explicit table (Postgres, not a ClickHouse MV — see "Storage engine choice" below).

### Storage engine choice for the linkage surface

The derived linkage surface lives in **Postgres**, not ClickHouse. Reasons:

- Recompute triggers are event-driven and small-batch (webhook arrival, reconciliation run, enrichment arrival, tracked-repo toggle). Postgres is the right primitive for stateful materialization.
- Manager dashboard filters join this table to ClickHouse queries via an IN-list of `session_id` — the set is small (thousands, not millions, per rendered page).
- Row-level deletes for tenant offboarding are simpler in Postgres than in ClickHouse MVs.
- At 8M evt/day, linkage cardinality is session-count not event-count — well within Postgres reach.

If profiling shows the IN-list join is slow, we introduce a ClickHouse dictionary synced from Postgres — additive, not replacing.

### Ingest and GitHub normalization

- `GitEventRow` extended with `branch`, `repo_id_hash`, `commit_sha`, `pr_number`, `author_association`.
- Webhook HMAC validation is the first gate. `X-Hub-Signature-256` verified against the persisted webhook secret for the installation before the payload is parsed. Failures return 401 and write `audit_log`.
- Webhook idempotency: GitHub sends `X-GitHub-Delivery` as UUID; stored in Redis `SETNX` with 7-day TTL (mirrors the event idempotency pattern in CLAUDE.md Architecture Rule #2).
- Parsers produce branch from:
  - `pull_request.pull_request.head.ref`
  - `pull_request_review.pull_request.head.ref`
  - `push.ref` (stripped of `refs/heads/`)
  - `workflow_run.workflow_run.head_branch`
  - `check_suite.check_suite.head_branch`
  - `deployment.deployment.ref`
- Repo identity resolution through the canonical registry:
  - `provider_repo_id` → `repo_id_hash`
  - upsert unknown repos into `repos`
  - stamp `repo_id_hash` onto every `git_events` row at write time.
- Out-of-order delivery handling: linkage surface recompute is idempotent and commutative per `session_id` — PR-before-push and push-before-PR produce identical final state.
- Force-push handling: `push.forced=true` recorded; any `commit_sha` rows now orphaned are tombstoned (`force_pushed_out_at`), join keys are not deleted (needed for audit), but excluded from eligibility.
- Squash-merge handling: PR webhook carries both `merge_commit_sha` and the original branch-head `head.sha`. Both are recorded. The `AI-Assisted:` trailer (D29) is preserved in the squashed commit only if GitHub's "default squash commit message" setting is set to "pull request title and description" or "pull request title and commit details" — documented as a per-repo admin recommendation with a warning banner when a tracked repo has an incompatible squash setting.
- Rebase-merge handling: individual commit SHAs preserved in PR commits endpoint; fallback join path uses the commits list, not `merge_commit_sha`.
- Fork PRs: `pull_request.head.repo.id ≠ pull_request.base.repo.id`. PR is attributed to the base repo for tracking; head repo is not auto-tracked.
- Reconciliation runner (PgBoss cron, hourly): scans last 24h of webhooks for gaps against GitHub's delivery log, requests redelivery for missing IDs, and re-fetches PR/check/deployment state where the local cache is stale. Distinct from the daily PR reconciliation mentioned in CLAUDE.md §8.5 — that one becomes a no-op when the hourly loop is healthy.
- Postgres-backed `gitEventsStore` replaces the in-memory default. Non-test boot fails closed on wiring failure.

### Outcome signal capture (the core upgrade)

These signals are what turn Bematist from "spend analytics" into "outcome analytics." Each is its own parser + Postgres cache + scoring-layer feed. All signals default ON — US market focus, no per-signal capture-flag plumbing in v1. (If/when an EU customer surfaces, an env-flagged kill-switch can be layered in without schema change; the EU compliance surface is being managed by a separate workstream.)

1. **First-push-green-rate** — from `check_suite.conclusion` joined to `push.head_commit.id`. Metric: of AI-assisted sessions that produced a push, what fraction had all check suites green on the first completion? Feeds `outcome_quality_v1` sub-score. `bematist outcomes` CLI surfaces this per-session.
2. **Deployment-as-outcome** — from `deployment` + `deployment_status` events. Metric: deployed-per-dollar, time-to-first-deploy after merge, deploy success rate. Feeds `outcome_quality_v1`. Many orgs deploy via GitHub Environments; for those that don't, the signal is absent and the metric is suppressed (never zero-filled).
3. **PR size denominator** — from `pull_request.additions / deletions / changed_files`. Metric: accepted-code-edits-per-PR-line-changed, a productivity denominator independent of token cost. Feeds `efficiency_v1` as a secondary signal (primary remains token-cost).
4. **Review timing + churn** — from `pull_request_review` events. Metrics: time-to-first-review, time-to-first-approval, `changes_requested` count per PR. Earlier cleaner signal than the 24h revert penalty in `useful_output_v1` (D12). Feeds `outcome_quality_v1`.
5. **Issue-to-merge cycle time** — parse `closes #123` / `fixes #456` / `resolves #789` from PR body on `pull_request.opened` and `pull_request.edited`. No separate issue-tracker adapter needed. Feeds a new `issue_cycle_time` insight tile.
6. **CODEOWNERS-derived ownership** — parse `.github/CODEOWNERS` (or `CODEOWNERS` / `docs/CODEOWNERS`) on `push` to the default branch. Gives automatic team/directory ownership without manager configuration. Feeds the 2×2 manager view's cohort stratification.
7. **Security-alert correlation** — from `secret_scanning_alert`, `code_scanning_alert`, `dependabot_alert` events. Metric: did an AI-assisted session introduce a flagged finding? Direct trust/safety signal that reinforces Bematist's privacy posture. Suppressed for orgs without alert scope granted.
8. **Copilot Metrics API** (if `copilot` scope granted) — pulls org-level Copilot usage data on a daily cron. Gives an upper-bound baseline for the Copilot adapter that's scheduled for Phase 2 in CLAUDE.md — Phase 2 implementation replaces this but doesn't invalidate it.

Each signal has a contract test against a captured webhook fixture in `packages/fixtures/github/<event>/`. Each feeds scoring via an additive `packages/scoring/src/v1/signals/github_*.ts` module with a versioned `_v1` name.

**Author cohort signal:** `pull_request.author_association` stratifies junior vs senior contribution without HR integration. Stored on `git_events`, referenced from `outcome_quality_v1` cohort normalization step.

### Direct repo attribution and late enrichment

- Direct repo attribution on raw product events is not assumed. V1 direct repo matches come from:
  - local git-context enrichment in the collector (maps active worktree remote → `provider_repo_id` / `repo_id_hash`), or
  - additive enrichment rows already carrying repo identity.
- Raw ClickHouse `events.repo_id_hash`, `pr_number`, `commit_sha`, `branch` remain best-effort acceleration/evidence fields. Not the sole source of truth.
- Any future safe backfill into ClickHouse raw events is documented as a separate mutation strategy (not assumed here).

### Derived linkage surface (`session_repo_links`)

- Keyed by `(bematist_org_id, session_id, repo_id_hash, match_reason)`.
- `match_reason ∈ {direct_repo, commit_link, pr_link, deployment_link}`.
- Optional evidence fields: `commit_sha`, `pr_number`, `deployment_id`, `branch`.
- `computed_at`, `stale_at` (null = fresh).
- Recompute triggers:
  - GitHub webhook inserts/updates
  - reconciliation writes
  - direct repo-enrichment arrival
  - tracked-repo mode or per-repo state changes
  - repo rename/transfer cutover
  - installation reconnect/resync
  - force-push tombstoning
- Tracked-repo changes invalidate caches for Sessions, Outcomes, Insights, Clusters, repo pages for the affected org.
- Recompute is idempotent and commutative — safe to replay out-of-order webhooks.

### Repo-scoped eligibility

- One canonical inclusion rule for manager-facing repo-scoped surfaces:
  - include a session if any `session_repo_links` row matches a tracked repo by `direct_repo`, `commit_link`, `pr_link`, or `deployment_link`.
- Branch-only excluded from v1 eligibility (but branch still surfaces as evidence).
- Eligibility is materialized on `session_repo_eligibility(bematist_org_id, session_id, effective_at)`, recomputed from `session_repo_links` on trigger, not on every read.

### Read path and settings APIs

- Manager/team-facing Sessions, Outcomes, Insights, Clusters, repo pages consume the same repo-eligibility model. No ad-hoc per-page repo filter.
- IC-private `/me` and direct session detail are NOT auto-filtered (guardrail).
- Manager cannot use `/me?user=<other>` as a backdoor — explicit authz check + audit_events row (D30 already mandates this; restated here).
- Admin-only GitHub settings APIs (per contract 07):
  - `GET /api/admin/github/connection` — status + sync progress
  - `GET /api/admin/github/repos` — list with `full_name`, `default_branch`, effective tracked status, `first_seen_at`, `archived_at`
  - `PATCH /api/admin/github/tracking-mode` — `all` | `selected`
  - `PATCH /api/admin/github/repos/:provider_repo_id/tracking` — `inherit` | `included` | `excluded`
  - `POST /api/admin/github/sync` — trigger reconciliation
  - `POST /api/admin/github/webhook-secret/rotate` — dual-accept window rotation
  - `GET /api/admin/github/tracking-preview` — dry-run ("this would move 47 sessions in/out of scope")
  - `POST /api/admin/github/redeliver` — replay webhooks for a date range
- RBAC: admin-only for writes. "Org leader" terminology is out unless RBAC is expanded (no v1 expansion).
- `/outcomes` continues consuming existing repo rollups where already-present; tracked-repo correctness resolves through the linkage model.
- `/clusters` and `/insights` consume repo scope via session linkage.
- No collector wire-contract redesign; direct repo / git-context data is additive enrichment.

### Boot and operational requirements

- Production boot fails if any of these is missing or unreachable:
  - Postgres-backed `gitEventsStore`
  - persisted GitHub installation state
  - repo registry resolver
  - reconciliation runner dependencies
  - webhook secrets reference backend
  - `BEMATIST_DEMO_MODE=1` is present (demo mode is rejected in prod builds)
- Runtime health: separate liveness check for webhook-processor lag (alert if `MAX(now() - webhook.received_at) > 5min` with a backlog > 100).
- Logging makes the failure mode explicit: missing-config errors are structured, redacted of secrets, and distinct from runtime errors.
- Metrics (Prometheus): `bematist_github_webhook_received_total{event,status}`, `bematist_github_reconciliation_gap_seconds`, `bematist_github_token_refresh_failures_total`, `bematist_github_installation_status{status}`.

## Edge cases and invariants

Enumerated so `/research-and-plan` can validate coverage.

- **Out-of-order webhooks** → linkage recompute is idempotent + commutative.
- **Force-push** → commit SHAs tombstoned, not deleted; eligibility excludes tombstoned rows.
- **Squash-merge** → `AI-Assisted:` trailer preservation documented; tracked repos with incompatible squash settings surface an admin banner.
- **Rebase-merge** → join path uses PR commits endpoint, not `merge_commit_sha`.
- **Fork PRs** → base repo is tracked; head repo is not auto-tracked.
- **Installation suspension** vs **uninstall** vs **deleted** — three distinct webhooks, three distinct states.
- **Webhook secret rotation** — dual-accept 10-min window.
- **Repo transfer across GitHub orgs** — `provider_repo_id` stable; `github_org_id` changes; Bematist `org_id` binding re-evaluated with admin confirmation.
- **Repo rename** — `full_name` changes, `provider_repo_id` stable, `repo_id_hash` stable, history intact.
- **Repo archive** / **delete** / **restore** — lifecycle fields capture all three; restored repos re-enter eligibility.
- **5000-repo initial sync** — paginated, rate-limit-aware, backgrounded, surfaced in UI.
- **GitHub Enterprise Server (GHE)** — delta from github.com: webhook endpoint format, rate limits, API URL prefix. Flagged as a Phase-2 compatibility pass unless a customer needs it at v1 launch; tracked as an open question.
- **Tenant offboarding / data deletion** — `bematist erase --org` drops Postgres rows in `github_*`, `session_repo_links`, `session_repo_eligibility`. Same code path as existing tenant deletion; no special EU SLA.
- **Tenant isolation** — RLS on every new Postgres table; cross-tenant probe (INT9) extended with GitHub tables; merge-blocker.

## Test Plan — TDD workflow

Per-surface loop:
1. Capture a real GitHub webhook payload for that event. Commit to `packages/fixtures/github/<event>/<scenario>.json`.
2. Write parser + contract test. Red.
3. Implement parser. Green.
4. Write integration test against Postgres (real DB per CLAUDE.md user preference — never mock). Red.
5. Implement persistence. Green.
6. Write scoring-integration test against the relevant `packages/scoring/src/v1/signals/github_*.ts`. Red.
7. Implement signal. Green.
8. E2E test drives a Playwright flow end-to-end (webhook in → dashboard tile updates).

Fixture inventory (minimum for v1 to ship):

- `pull_request`: opened, synchronize, closed-merged (squash), closed-merged (rebase), closed-unmerged, opened-from-fork, edited-with-closes-keyword
- `pull_request_review`: approved, changes_requested, commented
- `push`: regular, force-push, to-default-branch, to-non-default, with-multiple-commits
- `workflow_run`: completed-success, completed-failure, in-progress
- `check_suite`: completed-success, completed-failure, first-push-green
- `deployment` + `deployment_status`: created, success, failure
- `installation`: created, suspend, unsuspend, deleted
- `repository`: renamed, transferred, archived, deleted
- `secret_scanning_alert`: created, resolved
- `code_scanning_alert`: created, fixed
- `dependabot_alert`: created, dismissed

Required merge-blocking tests (CLAUDE.md Testing Rules):

- Per-adapter contract test per event parser — pinned to golden fixture.
- Privacy adversarial: forbidden-field fuzzer on ingest (restated from existing).
- RLS cross-tenant probe extended to GitHub tables — 0 rows across tenants.
- Tenant-deletion E2E extended: `bematist erase --org <id>` removes all `github_*` rows.
- Webhook HMAC validation: seeded bad signatures return 401 + audit log entry; 100% rejection.
- Boot-fail-closed: test harness removes each required config and asserts startup failure with distinct error codes.
- Linkage surface commutativity: apply webhooks in random order, assert final state identical.
- Repo rename preserves `repo_id_hash`, tracked membership, and history (captured fixture from a real rename).
- Squash-merge trailer preservation: test both compatible and incompatible repo squash settings.
- Force-push tombstoning: eligibility excludes force-pushed-out commits.
- Alias map retirement: post-retirement-date orphan report generator returns expected rows.

Test coverage minimums (CLAUDE.md §10 Phase 1): Workstream I ≥5 means at least 5 integration tests; this plan adds ~20 to I. Split:
- 8 webhook parser contract tests (the top-8 events above)
- 4 linkage-surface tests (add/remove/rename/force-push)
- 3 eligibility tests (mode=all, mode=selected, inherit resolution)
- 2 outcome-signal tests (first-push-green, deploy-per-dollar)
- 2 settings-API auth tests (admin allowed, non-admin denied with audit)
- 1 boot-fail-closed test

## Scoring integration points

- `packages/scoring/src/v1/signals/` gets new additive modules:
  - `github_first_push_green_v1.ts` → feeds `outcome_quality_v1`
  - `github_deploy_per_dollar_v1.ts` → feeds `outcome_quality_v1`
  - `github_pr_size_v1.ts` → feeds `efficiency_v1` (secondary)
  - `github_review_timing_v1.ts` → feeds `outcome_quality_v1`
  - `github_author_association_v1.ts` → feeds cohort normalization in step 2 of the locked math (CLAUDE.md Scoring Rules)
- All modules follow the locked `ai_leverage_v1` math — signals are inputs, not replacements for the formula.
- 500-case synthetic dev-month eval (`bun run test:scoring`) must pass with the new signals included (MAE ≤ 3). Any drift is merge-blocking.
- New metrics get `_v1` suffixes (CLAUDE.md D13).

## Security and compliance

- Webhook HMAC validation mandatory (CLAUDE.md Outcome Attribution §8.5, restated).
- GitHub App private key lives in the platform secrets store (AWS Secrets Manager / Vault / sealed-secret in self-host). Never on disk outside; never in env vars in managed cloud. Self-host writes to `${BEMATIST_DATA_DIR}/secrets/` with 0600.
- Installation tokens cached in Redis with TTL; never persisted to Postgres.
- All GitHub signals default ON for the US market. No per-signal capture flags in v1.
- RLS on every new table; cross-tenant probe extended (multi-tenant isolation, not jurisdictional compliance).
- EU/works-council compliance surface is owned by a separate workstream and is being moved behind env flags. This plan does not implement EU-specific defaults.
- No per-engineer GitHub leaderboard. No "who reviewed fastest" public ranking. CLAUDE.md §2.3 non-goals reaffirmed.

## Open questions — prioritized queue for `/research-and-plan`

Ordered by expected impact on v1.

1. **GHE Server compatibility at v1** — is there a launch customer forcing it? If yes, webhook endpoint format and rate-limit deltas land in v1, not Phase 2.
2. **Copilot Metrics API scope stability** — has GitHub changed the scope requirements since 2025-Q4? Affects whether this is v1 or Phase 2.
3. **Squash-merge trailer preservation in the wild** — survey: what fraction of real orgs have "pull request title and description" set? If low, we need an alternative attribution path beyond the `AI-Assisted:` trailer.
4. **Rate-limit posture for 10k-dev orgs** — primary endpoint is webhooks (no rate limit), but reconciliation + initial sync + Copilot Metrics hit the REST/GraphQL quotas. Needs a worked capacity model.
5. ~~Works-council default profile~~ — **dropped.** US market focus; EU surface is a separate workstream behind env flags.
6. **CODEOWNERS ambiguity resolution** — real repos have multi-owner glob patterns. What's the rule when a session touches files owned by two teams?
7. **Deployment provider diversity** — GitHub Environments vs external CD (Vercel, Spinnaker, ArgoCD with webhooks). Worth profiling real dev orgs; the signal is weak if most deploys bypass GitHub's deployment API.
8. **Secret-scanning cost on high-volume orgs** — do we throttle? Skip on repos with > N alerts/day?
9. **Storage engine choice confirmation** — does Postgres linkage surface hold up at 10k-dev / 8M-evt-day? Run a worked soak spec before coding.
10. **Alias map retirement** — what's the right SLO? 90 days assumed; may need extension if customer rows older than cutoff are material.

## Assumptions

- GitHub-first attribution/settings pass, not a removal of existing provider-agnostic schema.
- Admin-only writes for tracked-repo settings; RBAC unchanged.
- Stable GitHub repo identity = provider repo ID, not repo full name.
- "Connected GitHub org" = active persisted GitHub App installation bound to a Bematist org.
- Direct repo attribution may require additive local git-context enrichment.
- Raw ClickHouse event columns remain best-effort acceleration/evidence fields; `session_repo_links` is authoritative for manager-facing repo relevance.
- `/research-and-plan` will ratify scope and score upgrades by effort before significant coding begins. Demo-path and red-green test infrastructure can start in parallel.
