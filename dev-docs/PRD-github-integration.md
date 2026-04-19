# PRD — Bematist GitHub Integration v1

> **Status.** Consolidated PRD. Extends `dev-docs/PRD.md` (main) without overriding. Decisions D33–D60 extend the existing D1–D32 series. Produced by `/research-and-plan` on 2026-04-18 and hardened in-session to strip EU/works-council scope (owned by a separate workstream being moved behind env flags) and demo-mode flags (local-dev-first, no tunneling).
>
> **Non-negotiable.** GitHub Integration v1 is an **enhancement**, not a replacement. It does not touch the canonical ClickHouse `events` schema, the collector wire contract, the Clio pipeline, GitLab/Bitbucket support, or the locked `ai_leverage_v1` math. It adds a new attribution + outcome-signal path that other layers consume.
>
> **Market focus: US only.** All GitHub signals default ON. EU/works-council compliance is owned by a separate workstream via env-flag kill-switches; this PRD does not build jurisdictional profiles, per-signal capture-flag plumbing, or bespoke retention policies.

---

## 1. Executive Summary

GitHub becomes Bematist's first authoritative repo-attribution backend AND the primary outcome-signal source that turns session spend into outcome quality. This PRD:

1. Ratifies the brief at `docs/github.md` as the v1 design with numbered decisions D33–D60.
2. Resolves all open questions from the brief (§4).
3. Scores the 8 outcome-signal upgrades by implementation effort and manager value, and assigns each to CORE / STRETCH / PHASE-2 (§5).
4. Locks **GHE Server → Phase 2** (no v1 code path, no orphan columns).
5. Confirms `session_repo_links` → **Postgres** at v1 scale with worked capacity model (§11).
6. Sequences implementation across Sprint 0 → Sprint 3 (4-week MVP cadence) in lockstep with CLAUDE.md §10.
7. Flags contradictions with the main PRD and resolves each explicitly (§15).

**Size target:** GitHub Integration v1 = **L** in aggregate (webhook receiver + schema + scoring + manager surfaces), composed of phases that each size **S / M / L** — no **XL** phase.

**What ships at MVP:** GitHub App install/webhook pipeline, HMAC-validated ingest, Postgres persistence for 6 GitHub-domain tables, `session_repo_links` derived linkage surface, `session_repo_eligibility` physical table, and CORE scoring signals (first-push-green, PR size, CODEOWNERS, author_association, review-churn-inverse, security-clean). STRETCH = deploy-per-dollar (Sprint 3 if F15 soak is clean). Issue-cycle-time + Copilot Metrics + GHES → Phase 2.

---

## 2. Brief (verbatim)

See `docs/github.md`. Not re-pasted to keep this file navigable — that file is the canonical brief and this PRD is the ratified answer to it.

---

## 3. Assumptions (defaults the team chose to unblock itself)

| # | Assumption | Reason |
|---|------------|--------|
| A1 | **No launch customer currently requires GHE Server at v1.** 100% of known design-partner pipeline is on github.com. | No forcing customer; Phase-2 deferral unlocks Sprint 1–3 focus. |
| A2 | Managed-cloud scale target = **500 tenants, 10k devs total, 8M evt-day**. | CLAUDE.md LOCKED key constraint; inherited unchanged. |
| A3 | Enterprise rate-limit lift (Enterprise Cloud 15k/hr) is **not assumed** — plan lives within GitHub App 5k/hr base quota. | Conservative; tenant self-upgrade doesn't require code change. |
| A4 | `FIRST_TIME_CONTRIBUTOR` / `CONTRIBUTOR` → **JUNIOR** tier; `COLLABORATOR` → MID; `OWNER` / `MEMBER` → SENIOR; `NONE` → EXTERNAL. | No HR integration at v1; `author_association` is the canonical seniority proxy. |
| A5 | 5000-repo initial-sync is the p99 tenant; median tenant = ~50 repos. | Budgeting at the p99 for UI progress; median sync <5 min. |
| A6 | Industry webhook-arrival baseline: **17.5 webhooks/dev-day** (DORA 2023 + Octoverse 2023 blended enterprise weight). | Capacity-math input; headroom accommodates 3× peak. |
| A7 | Recompute churn for `session_repo_links`: **20% of links rewritten within 7d of insert; past 7d stable.** | Enrichment-arrival assumption; autovacuum tuned accordingly. |
| A8 | All signals default ON. Any jurisdictional kill-switch (EU workstream) lands later as an env-flag or tenant attribute owned outside this plan. | US-market focus; no compliance plumbing in this PRD's code surface. |
| A9 | Squash-merge trailer loss is **mitigated at the customer layer** — admin banner + `bematist policy set ai-assisted-trailer=on` retain D29 posture. No alternative attribution path introduced. | Brief open-q #3 is surveyable, not forcing; mitigation exists. |

---

## 4. Open Questions — Resolved

All open questions from `docs/github.md §Open questions` are closed. No open questions land in the final PRD.

| # | Question | Resolution | D-number |
|---|----------|-----------|----------|
| 1 | GHE Server compatibility at v1? | **Phase 2.** No code path, no orphan schema columns. `github_installations.provider = 'github.com'` is the only legal value at v1. GHES shape revisited when a customer forces it. | D58 |
| 2 | Copilot Metrics API scope stability? | **Phase 2.** Org-aggregated, `copilot` scope gated. Default OFF; when enabled feeds `adoption_depth_v1` at org grain. | D50 |
| 3 | Squash-merge trailer preservation in the wild? | Retain D29 as primary attribution. Tracked repos with incompatible squash settings surface an admin banner warning. No alternative trailer path. | — |
| 4 | Rate-limit posture for 10k-dev orgs? | 500 tenants × hourly reconcile × 80 calls ≈ 40k calls/hr across **500 separate** installation quotas (≤1.6% of 5k/hr each). Per-tenant floor 1 req/s with exponential backoff. | D59 |
| 5 | ~~Works-council default profile?~~ | **Dropped.** US-market focus; EU compliance owned by a separate workstream via env flags. | — |
| 6 | CODEOWNERS multi-owner resolution? | **Non-exclusive set attribution** — all matching teams credited; session deduped by `session_id` at org rollup. | D47 |
| 7 | Deployment provider diversity? | `HAS_DEPLOYMENT_SIGNAL(repo) := COUNT(deployment webhooks in 30d) ≥ 3 AND distinct environments ≥ 1`. When false, deploy tiles render `insufficient data` (never zero-fill). | D60 |
| 8 | Secret-scanning cost on high-volume orgs? | 30-day retention; IC-private drill + manager aggregate-only at team grain (k≥10). No per-repo throttle at v1 scale (~500 alerts/day at 10k devs). | D38 |
| 9 | `session_repo_links` storage at scale? | **Postgres confirmed.** Monthly RANGE partition on `computed_at`, 180-day retention, DROP PARTITION GC. Plan B (ClickHouse dictionary) triggered on measured p95 IN-list join >500ms for 3 consecutive days OR >100M rows. | D52 |
| 10 | Alias map retirement SLO? | **180d active + 365d cold archive + hard delete.** | D55 |

---

## 5. Outcome Signal — Effort × Value Scoring

Effort bands per the PRD size rubric. Manager value scored against moving Bematist from spend analytics to outcome analytics.

| # | Signal | Feeds | Effort | Mgr Value | v1 Tier | Gate |
|---|--------|-------|--------|-----------|---------|------|
| 1 | **first-push-green** | outcome_quality_v1.1 (0.25) | **M** | **High** — cleanest "did AI ship green" proxy | **CORE** | MAE≤3 on 650-case fixture |
| 2 | **deployment-as-outcome** | outcome_quality_v1.1 (0.15) | **L** | **High** — closest to business value / $ without 2nd-order LLM | **STRETCH** (Sprint 3 if F15 clean) | Prod-env allowlist per repo |
| 3 | **PR size denominator** | efficiency_v1 (secondary) | **S** | **Med** — normalizes backend vs frontend cohorts | **CORE** | `linguist-generated` stripper tested |
| 4 | **review churn inverse** | outcome_quality_v1.1 (0.10) | **M** | **Med** — rework signal; time-to-approval never ranked (D49) | **CORE** | Bot-reviewer exclusion test |
| 5 | **issue-to-merge cycle** | insight tile only | **M** | **Med** — narrative tile; too noisy for subscore at v1 | **PHASE 2** | `closes #N` regex + link resolution tests |
| 6 | **CODEOWNERS ownership** | cohort stratifier (step-2) | **M** | **High** — kills backend-vs-frontend Goodhart | **CORE** | Multi-owner set rule (D47) |
| 7 | **security-clean (penalty)** | outcome_quality_v1.1 (−0.05, penalty-only) | **M** | **High** — trust/safety signal; IC-private drill | **CORE** | Never per-IC manager view (D38) |
| 8 | **Copilot Metrics API** | adoption_depth_v1 (org-level) | **S** | **Low (v1)** — baseline, not per-IC | **PHASE 2** | `copilot` scope granted |
| 9 | **author_association** | cohort stratifier (step-2) | **S** | **High** — junior/senior apples-to-apples | **CORE** | A4 tier mapping locked |

**CORE = signals 1, 3, 4, 6, 7, 9.** All either cohort-normalization inputs or single additive terms in `outcome_quality_v1.1`. STRETCH = deploy-per-dollar (introduces a new outcome event type that shifts MAE, require fixture expansion to 650 cases). PHASE-2 = issue-cycle + Copilot Metrics (each needs NLP or enterprise-only scope).

---

## 6. Current State (Revision context)

- ClickHouse `events` already carries `pr_number`, `commit_sha`, `branch`, `repo_id_hash`, `prompt_cluster_id`. MVs `pr_outcome_rollup` and `commit_outcome_rollup` exist (contract `09-storage-schema.md`).
- Postgres control plane has `orgs`, `users`, `developers`, `repos`, `git_events`, `audit_log`, `audit_events`, `erasure_requests`, `outcomes` with RLS enforced universally.
- Redis SETNX idempotency pattern locked for ingest (D14) — template for webhook `X-GitHub-Delivery` dedup.
- PgBoss is for crons only (Architecture Rule #4). Per-event work goes to ClickHouse MVs or Redis Streams.
- Redpanda gateway queue: 7-day, partition-by-tenant.
- `packages/scoring/src/v1/` holds frozen `ai_leverage_v1` math. 500-case fixture gates merges with MAE ≤ 3.
- `packages/fixtures/` holds per-IDE contract fixtures.
- Existing GitHub scaffolding on main: `apps/ingest/src/github-app/{jwt,token-cache,reconcile}.ts`, `apps/ingest/src/webhooks/{verify,router,github,gitEventsStore}.ts`. Pick up from there; do not rebuild.

This PRD adds: 9 new Postgres tables + derived linkage surface + 6 CORE scoring modules + fixture capture tool + admin UI for GitHub connection.

---

## 7. Architecture

### 7.1 Ingest flow

```
GitHub webhook → Envoy (TLS termination, ext_authz JWT issuance) →
  Bun ingest POST /v1/webhooks/github/{installation_id}
    ├─ HMAC verify X-Hub-Signature-256 against webhook_secret_active
    │   (10-min fallback to webhook_secret_previous during rotation)
    ├─ Redis SETNX wh:<X-GitHub-Delivery> EX 604800
    ├─ emit to Redpanda topic github.webhooks (key = tenant_id + ':' + installation_id, 32 partitions)
    └─ 200 OK to GitHub (p99 target <500ms; GitHub hard timeout 10s)

Bun worker (apps/worker/github) consumer group:
  parse → UPSERT Postgres domain table (git_events + github_*) →
    emit coalescing message to Redis Stream session_repo_recompute:{tenant_id} →
      linker worker → INSERT session_repo_links + UPSERT session_repo_eligibility (same txn)
```

**Back-pressure:** Redpanda 7-day retention absorbs a full week of Postgres outage. When consumer lag >10k msgs or oldest-unprocessed >5 min, ingest-lag banner surfaces; reconciler elevates to 15-min cadence post-drain.

**Liveness alert:** `github_webhook_oldest_unprocessed_age_seconds > 300 AND github_webhook_backlog_depth > 100` → page on-call.

### 7.2 Topology diagram (extends main PRD §5.1)

```
                 ┌──────────────────────────────┐
                 │        GitHub.com             │
                 │  App install / webhooks       │
                 └──────────────┬───────────────┘
                                │ HTTPS (HMAC-signed)
                 ┌──────────────▼───────────────┐
                 │   Envoy (ext_authz, JWT)     │
                 └──────────────┬───────────────┘
                                │
                 ┌──────────────▼───────────────┐
                 │   Bun ingest :8000            │
                 │   /v1/webhooks/github         │
                 └──┬────────┬──────────┬────────┘
                    │        │          │
           ┌────────▼──┐  ┌──▼───────┐  │  wh SETNX
           │  Redpanda │  │  Redis   │◄─┘
           │ github.*  │  │ wh:<uid> │
           └────┬──────┘  └──────────┘
                │
      ┌─────────▼────────────┐    ┌──────────────────────┐
      │  Bun worker          │    │  PgBoss cron         │
      │  apps/worker/github  │    │  - reconcile (1h)    │
      │  (parse + UPSERT)    │    │  - initial sync      │
      └────┬──────────┬──────┘    │  - partition create  │
           │          │           │  - alias retirement  │
   ┌───────▼──┐   ┌──▼──────────┐ └────┬─────────────────┘
   │ Postgres │   │ Redis Stream│      │
   │ gh_* +   │   │ recompute   │      │
   │ git_ev   │   └──┬──────────┘      │
   └──────────┘      │                 │
                 ┌───▼─────────────┐   │
                 │  Linker worker   ├──┘
                 │ session_repo_*   │
                 └───┬──────────────┘
                     │
            ┌────────▼─────────┐
            │   Postgres       │
            │ session_repo_*   │
            └──────────────────┘
```

### 7.3 Data model summary

**New Postgres tables** (full DDL §9):
- `github_installations` — auth + lifecycle + webhook-secret state + rotation window
- `github_pull_requests` — PR cache keyed on `(tenant_id, provider_repo_id, pr_number)`
- `github_check_suites` — CI state keyed on `(tenant_id, provider_repo_id, head_sha, suite_id)`
- `github_deployments` — keyed on `(tenant_id, provider_repo_id, deployment_id)`
- `github_code_owners` — parsed CODEOWNERS, content-hash invalidation
- `github_security_alerts` — secret_scanning + code_scanning + dependabot union (IC-private drill — D38)
- `session_repo_links` — derived linkage, monthly RANGE partition, 180-d retention
- `session_repo_eligibility` — physical table (not MV), same-txn co-write
- `repo_id_hash_aliases` — `migrated_at + 180d + 365d cold archive + delete` SLO

**Extensions to existing tables:**
- `repos` — +`provider_repo_id`, `default_branch`, `tracking_state`, `first_seen_at`, `archived_at`, `deleted_at`, UNIQUE(provider, provider_repo_id)
- `git_events` — +`branch`, `repo_id_hash`, `commit_sha`, `pr_number`, `author_association`
- `orgs` — +`github_repo_tracking_mode` (`all` | `selected`)

---

## 8. US Market Privacy Posture

Not compliance. Product correctness — these are the Goodhart-defense and trust guards that apply regardless of jurisdiction, kept because they make the product better, not because any regulator requires them.

### 8.1 Product-level guards (US defaults)

| Guard | Rule | Why |
|---|---|---|
| k≥5 team cohort floor | Manager-facing team tiles render "insufficient cohort" below k=5 | CLAUDE.md §6.4 already locked; prevents re-identification in small teams |
| Manager-view audit (D30) | Every manager drill into an IC page writes `audit_events`; IC gets daily digest by default | Already locked in main PRD; not renegotiated here |
| `/me?user=<other>` backdoor | Manager hitting another IC's `/me` returns 403 + `audit_events` row | Explicit authz check + E2E merge-blocker test |
| Security-alert drill (D38) | IC-private by default. Manager aggregate-only at team grain with k≥10 (tighter than general k≥5). NEVER feeds `ai_leverage_v1` — hard exclusion in `packages/scoring` with a CI fixture that fails if a future commit wires it in. | Prevents "who caused CVE-2026-X" becoming a disciplinary-proxy surface. Simple product rule; no ritual, no cooldown. |
| Review timing | `changes_requested / total_reviews` is the only visible metric (D49). Time-to-approval never ranked, never per-IC. | Non-goal in CLAUDE.md §2.3 (no review-speed ranking) |
| No per-engineer leaderboard | Non-goal reaffirmed. 2×2 manager view shows cohort scatter with identity hidden unless IC opts in. | Main PRD non-goal unchanged |

### 8.2 Tenant erasure

`bematist erase --org <id>` drops all new Postgres rows via cascading FK from `orgs(id)`. Same code path as existing; no new SLA. Worker runs ≤15 min for 10k-dev tenant. E2E coverage: `bun run test:e2e -- erase-org-github`.

No `bematist erase --user` path in this PRD — individual-engineer erasure is a feature of the broader workstream, not this integration.

### 8.3 EU / jurisdictional profiles

Out of scope here. If an EU customer surfaces, an env-flagged kill-switch can disable individual signal writes at the ingest router without schema changes. That workstream is owned separately.

---

## 9. Data Schema — Canonical DDL

All tables: `tenant_id` = `orgs.id`. RLS enabled on every table. Timestamps `timestamptz` (UTC).

### 9.1 `github_installations`

```sql
CREATE TABLE github_installations (
  id                              bigserial PRIMARY KEY,
  tenant_id                       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  installation_id                 bigint NOT NULL,
  github_org_id                   bigint NOT NULL,
  github_org_login                text   NOT NULL,
  app_id                          bigint NOT NULL,
  status                          text   NOT NULL
                                    CHECK (status IN ('active','suspended','revoked','reconnecting')),
  token_ref                       text   NOT NULL,             -- pointer into secrets store
  webhook_secret_active_ref       text   NOT NULL,
  webhook_secret_previous_ref     text   NULL,
  webhook_secret_rotated_at       timestamptz NULL,
  last_reconciled_at              timestamptz NULL,
  installed_at                    timestamptz NOT NULL DEFAULT now(),
  suspended_at                    timestamptz NULL,
  revoked_at                      timestamptz NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, installation_id),
  UNIQUE (installation_id)
);
CREATE INDEX gh_inst_tenant_status_idx ON github_installations(tenant_id, status);
CREATE INDEX gh_inst_prev_secret_idx
  ON github_installations(webhook_secret_rotated_at)
  WHERE webhook_secret_previous_ref IS NOT NULL;
```

### 9.2 `github_pull_requests`

```sql
CREATE TABLE github_pull_requests (
  tenant_id                 uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider                  text        NOT NULL DEFAULT 'github' CHECK (provider = 'github'),
  provider_repo_id          varchar(32) NOT NULL,
  pr_number                 integer     NOT NULL,
  pr_node_id                text        NOT NULL,
  state                     text        NOT NULL CHECK (state IN ('open','closed','merged')),
  draft                     boolean     NOT NULL DEFAULT false,
  title_hash                bytea       NOT NULL,   -- sha256(title); never raw title
  base_ref                  text        NOT NULL,
  head_ref                  text        NOT NULL,
  head_sha                  char(40)    NOT NULL,
  merge_commit_sha          char(40)    NULL,
  author_login_hash         bytea       NOT NULL,   -- hmac(tenant_salt, login)
  author_association        text        NULL,
  additions                 integer     NOT NULL DEFAULT 0,
  deletions                 integer     NOT NULL DEFAULT 0,
  changed_files             integer     NOT NULL DEFAULT 0,
  commits_count             integer     NOT NULL DEFAULT 0,
  first_review_at           timestamptz NULL,
  first_approval_at         timestamptz NULL,
  changes_requested_count   integer     NOT NULL DEFAULT 0,
  opened_at                 timestamptz NOT NULL,
  closed_at                 timestamptz NULL,
  merged_at                 timestamptz NULL,
  ingested_at               timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, pr_number)
);
CREATE INDEX gh_pr_head_sha_idx   ON github_pull_requests(tenant_id, head_sha);
CREATE INDEX gh_pr_merged_idx     ON github_pull_requests(tenant_id, merged_at DESC) WHERE merged_at IS NOT NULL;
CREATE INDEX gh_pr_repo_state_idx ON github_pull_requests(tenant_id, provider_repo_id, state, opened_at DESC);
```

### 9.3 `github_check_suites`

```sql
CREATE TABLE github_check_suites (
  tenant_id          uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider_repo_id   varchar(32) NOT NULL,
  head_sha           char(40)    NOT NULL,
  suite_id           bigint      NOT NULL,
  status             text        NOT NULL CHECK (status IN ('queued','in_progress','completed')),
  conclusion         text        NULL
                       CHECK (conclusion IN ('success','failure','neutral','cancelled','skipped','timed_out','action_required','stale')),
  runs_count         integer     NOT NULL DEFAULT 0,
  failed_runs_count  integer     NOT NULL DEFAULT 0,
  started_at         timestamptz NULL,
  completed_at       timestamptz NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, head_sha, suite_id)
);
CREATE INDEX gh_cs_repo_conclusion_idx
  ON github_check_suites(tenant_id, provider_repo_id, conclusion, completed_at DESC)
  WHERE conclusion IS NOT NULL;
```

### 9.4 `github_deployments`

```sql
CREATE TABLE github_deployments (
  tenant_id          uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider_repo_id   varchar(32) NOT NULL,
  deployment_id      bigint      NOT NULL,
  environment        text        NOT NULL,
  sha                char(40)    NOT NULL,
  ref                text        NOT NULL,
  status             text        NOT NULL
                       CHECK (status IN ('pending','queued','in_progress','success','failure','error','inactive')),
  first_success_at   timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, deployment_id)
);
CREATE INDEX gh_dep_sha_idx ON github_deployments(tenant_id, sha);
CREATE INDEX gh_dep_env_idx ON github_deployments(tenant_id, provider_repo_id, environment, first_success_at DESC);
```

### 9.5 `github_code_owners`

```sql
CREATE TABLE github_code_owners (
  tenant_id          uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider_repo_id   varchar(32) NOT NULL,
  ref                text        NOT NULL,
  content_sha256     bytea       NOT NULL,
  rules              jsonb       NOT NULL,        -- [{pattern, owners:[{type:'team'|'user', id_hash}]}]
  parsed_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at      timestamptz NULL,
  PRIMARY KEY (tenant_id, provider_repo_id, ref, content_sha256)
);
CREATE INDEX gh_co_active_idx
  ON github_code_owners(tenant_id, provider_repo_id, ref)
  WHERE superseded_at IS NULL;
```

### 9.6 `github_security_alerts`

```sql
CREATE TABLE github_security_alerts (
  tenant_id            uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider_repo_id     varchar(32) NOT NULL,
  alert_id             bigint      NOT NULL,
  kind                 text        NOT NULL CHECK (kind IN ('code_scanning','secret_scanning','dependabot')),
  rule_id              text        NOT NULL,
  severity             text        NULL,
  state                text        NOT NULL
                         CHECK (state IN ('open','dismissed','fixed','resolved','auto_dismissed')),
  linked_commit_sha    char(40)    NULL,
  linked_pr_number     integer     NULL,
  opened_at            timestamptz NOT NULL,
  resolved_at          timestamptz NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, kind, alert_id)
);
CREATE INDEX gh_sec_linked_sha_idx ON github_security_alerts(tenant_id, linked_commit_sha)
  WHERE linked_commit_sha IS NOT NULL;
CREATE INDEX gh_sec_linked_pr_idx  ON github_security_alerts(tenant_id, provider_repo_id, linked_pr_number)
  WHERE linked_pr_number IS NOT NULL;
```

### 9.7 `session_repo_links` (partitioned, critical path)

```sql
CREATE TABLE session_repo_links (
  tenant_id        uuid        NOT NULL,
  session_id       uuid        NOT NULL,
  repo_id_hash     bytea       NOT NULL,
  match_reason     text        NOT NULL
                     CHECK (match_reason IN ('direct_repo','commit_link','pr_link','deployment_link')),
  provider_repo_id varchar(32) NOT NULL,
  evidence         jsonb       NOT NULL,             -- only hashes + structural counts (D57)
  confidence       smallint    NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  inputs_sha256    bytea       NOT NULL,             -- idempotency key
  computed_at      timestamptz NOT NULL,
  stale_at         timestamptz NULL,
  PRIMARY KEY (tenant_id, session_id, repo_id_hash, match_reason, computed_at)
) PARTITION BY RANGE (computed_at);

-- Monthly partition, managed by pg_partman / PgBoss cron (T-7d)
CREATE TABLE session_repo_links_2026_04 PARTITION OF session_repo_links
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE UNIQUE INDEX ON session_repo_links_2026_04 (tenant_id, session_id, repo_id_hash, match_reason);
CREATE INDEX        ON session_repo_links_2026_04 (tenant_id, repo_id_hash, computed_at DESC);
CREATE INDEX        ON session_repo_links_2026_04 (tenant_id, session_id);
CREATE INDEX        ON session_repo_links_2026_04 (tenant_id, inputs_sha256);
CREATE INDEX        ON session_repo_links_2026_04 (tenant_id, stale_at) WHERE stale_at IS NOT NULL;
```

**Retention:** 180 days, DROP PARTITION (not DELETE, not TTL).

### 9.8 `session_repo_eligibility` (physical table, D54)

```sql
CREATE TABLE session_repo_eligibility (
  tenant_id             uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  session_id            uuid        NOT NULL,
  effective_at          timestamptz NOT NULL,
  eligibility_reasons   jsonb       NOT NULL,
  eligible              boolean     NOT NULL,
  inputs_sha256         bytea       NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id)
);
CREATE INDEX sre_tenant_eligible_idx ON session_repo_eligibility(tenant_id, eligible, effective_at DESC);
```

### 9.9 `repo_id_hash_aliases`

```sql
CREATE TABLE repo_id_hash_aliases (
  tenant_id       uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  old_hash        bytea       NOT NULL,
  new_hash        bytea       NOT NULL,
  reason          text        NOT NULL
                    CHECK (reason IN ('rename','transfer','salt_rotation','provider_change')),
  migrated_at     timestamptz NOT NULL DEFAULT now(),
  retires_at      timestamptz NOT NULL,                    -- migrated_at + 180d
  archived_at     timestamptz NULL,
  PRIMARY KEY (tenant_id, old_hash, new_hash)
);
CREATE INDEX rha_retires_idx ON repo_id_hash_aliases(retires_at) WHERE archived_at IS NULL;
CREATE INDEX rha_new_idx     ON repo_id_hash_aliases(tenant_id, new_hash);
```

**Retirement worker** (daily): after `retires_at`, export row to S3-equivalent (HMAC'd parquet), set `archived_at`. After `retires_at + 365d`, hard delete. **D55.**

### 9.10 Extensions to existing tables

```sql
ALTER TABLE repos
  ADD COLUMN provider_repo_id varchar(32)  NULL,
  ADD COLUMN default_branch   text         NULL,
  ADD COLUMN first_seen_at    timestamptz  NOT NULL DEFAULT now(),
  ADD COLUMN archived_at      timestamptz  NULL,
  ADD COLUMN deleted_at       timestamptz  NULL,
  ADD COLUMN tracking_state   text         NOT NULL DEFAULT 'inherit'
               CHECK (tracking_state IN ('inherit','included','excluded'));
CREATE UNIQUE INDEX repos_provider_unique
  ON repos(provider, provider_repo_id)
  WHERE provider_repo_id IS NOT NULL;
ALTER TABLE repos
  ADD CONSTRAINT repos_github_provider_id_required
  CHECK (provider <> 'github' OR provider_repo_id IS NOT NULL) NOT VALID;
-- post-backfill: ALTER TABLE repos VALIDATE CONSTRAINT repos_github_provider_id_required;

ALTER TABLE git_events
  ADD COLUMN branch              text        NULL,
  ADD COLUMN repo_id_hash        bytea       NULL,
  ADD COLUMN commit_sha          char(40)    NULL,
  ADD COLUMN pr_number           integer     NULL,
  ADD COLUMN author_association  text        NULL;
CREATE INDEX git_events_repo_hash_idx ON git_events(tenant_id, repo_id_hash, occurred_at DESC)
  WHERE repo_id_hash IS NOT NULL;

ALTER TABLE orgs
  ADD COLUMN github_repo_tracking_mode text NOT NULL DEFAULT 'all'
    CHECK (github_repo_tracking_mode IN ('all','selected'));
```

**Backfill plan:**
1. `ALTER ... NOT VALID` + app writes populate new columns.
2. Worker streams through `repos` / `git_events` in 10k chunks writing new columns from existing data (`repo_id_hash := hmac(tenant_salt, provider || ':' || provider_repo_id)`).
3. `VALIDATE CONSTRAINT` once scan completes.
4. Rollback rehearsed in `db:migrate:pg -- --rollback 20260418_github_schema`.

### 9.11 RLS policy template

Applied to every new table:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

INT9 probe (merge blocker): seed tenant A, `SET app.tenant_id = B`, every SELECT/UPDATE/DELETE on every new table returns/affects 0 rows. CI fails on any non-zero.

---

## 10. Recompute pipeline (`session_repo_links`)

**Queue:** Redis Streams per-tenant (`session_repo_recompute:{tenant_id}`). PgBoss is for crons only (Architecture Rule #4) — per-event load breaks it at 8M evt/day. **D56.**

**Six triggers → single normalized message:**

| # | Trigger | Producer |
|---|---|---|
| 1 | GH webhook insert/update (PR, push, check, deploy, security) | ingest webhook handler |
| 2 | Reconciliation cron write | `worker:reconcile-github` |
| 3 | Direct-repo enrichment arrival (session says "repo=X") | ClickHouse CDC → Redis Stream |
| 4 | Tracked-repo mode/state change | org-settings Server Action |
| 5 | Repo rename/transfer (new alias row) | webhook `repository` event |
| 6 | Installation reconnect / force-push tombstone | webhook handler |

**Coalescer:** 30-second tumbling window per `(tenant_id, session_id)` collapses duplicates, materializes input set, writes one recompute task.

**Installation-lifecycle state rule:** `installation.suspend` / `installation.revoke` / `installation.deleted` webhooks write a synthetic recompute message for every live `session_id` with links to that installation. Linker marks those rows `stale_at = now()` but **retains them** (audit trail); no new links written for this installation until `unsuspend` / reconnect. On `unsuspend`, a reconciliation pass re-resolves state and clears `stale_at` for unchanged rows. On `installation.deleted` with no reconnect within 30 days, partition cleanup lets the rows age out naturally.

**Commutativity invariant (D53):** Output state is a pure function of

```
State = f(
  installations(tenant).active,
  repos(tenant).tracking_state + tracking_mode,
  session.enrichment(session_id),
  pull_requests ∩ head_sha|merge_sha ∩ commit_shas(session),
  deployments   ∩ sha ∩ commit_shas(session),
  aliases(tenant).applicable,
  tombstones(tenant).force_push
)
```

Event order does not affect output. Proof obligation: golden-replay commutativity test in `apps/worker/test/linker.commutativity.test.ts` — same input set, 1000 random orderings, identical `inputs_sha256`. **Merge-blocking.**

**Idempotency:** `inputs_sha256 = sha256(canonical_json(State))`. Skip write if unchanged.

**Same-transaction cascade to `session_repo_eligibility`:**

```sql
BEGIN;
  INSERT INTO session_repo_links (...) VALUES (...) ON CONFLICT DO NOTHING;
  UPDATE session_repo_links SET stale_at = now()
    WHERE tenant_id=$1 AND session_id=$2 AND inputs_sha256 <> $3;
  INSERT INTO session_repo_eligibility
         (tenant_id, session_id, effective_at, eligibility_reasons, eligible, inputs_sha256)
  VALUES ($1, $2, now(), $4::jsonb, $5, $3)
  ON CONFLICT (tenant_id, session_id) DO UPDATE
    SET effective_at = EXCLUDED.effective_at,
        eligibility_reasons = EXCLUDED.eligibility_reasons,
        eligible = EXCLUDED.eligible,
        inputs_sha256 = EXCLUDED.inputs_sha256,
        updated_at = now()
    WHERE session_repo_eligibility.inputs_sha256 <> EXCLUDED.inputs_sha256;
COMMIT;
```

Downstream ClickHouse rollups read `session_repo_eligibility.eligible` via a daily Postgres → CH dictionary sync (`session_repo_eligibility_dict`) — dict lookup, not JOIN. Respects "no cross-DB JOIN" rule.

---

## 11. Infrastructure & Capacity

### 11.1 Worked capacity model (10k devs / 500 tenants / 8M evt-day)

Event baseline (Octoverse 2023 + DORA 2023 blended):

| Event type | Per dev/day | 10k devs/day | Monthly |
|---|---|---|---|
| push | 3.0 | 30,000 | 900k |
| pull_request | 1.2 | 12,000 | 360k |
| pull_request_review + comment | 1.8 | 18,000 | 540k |
| check_suite + check_run | 6.0 | 60,000 | 1.8M |
| workflow_run + workflow_job | 5.0 | 50,000 | 1.5M |
| deployment + deployment_status | 0.4 | 4,000 | 120k |
| security alerts | 0.05 | 500 | 15k |
| **Total webhooks** | **17.45** | **174,500/day** | **5.23M/month** |

Avg: **2.0 req/s** webhook rate. Peak 09:00 PT × 3× = **6.1 req/s** sustained 90 min. Monorepo burst: up to **20 req/s** on 400-job CI matrix completing.

**Year-1 storage footprint** (Postgres, 2.2× index factor):

| Table | Rows Y1 | GB Y1 |
|---|---|---|
| git_events | 63M | 38 |
| github_pull_requests | 7.2M | 5 |
| github_check_suites | 11M | 7 |
| github_deployments | 1.4M | 1 |
| session_repo_links | 36.5M | 22 |
| **Total GitHub domain** | **119M** | **~73 GB** |

**Redis idempotency memory:** 174.5k/day × 7d × (~40B key + ~80B overhead) = **~150 MB**. Allocated 256 MB dedicated hash slot.

### 11.2 GitHub API rate-limit posture

| Quota | Value |
|---|---|
| GitHub App primary | **5,000 req/hr/installation** |
| Org-wide scaling bonus | +50/hr/user, capped 12,500 (if ≥20 users/repos) |
| Enterprise Cloud lift (paid) | 15,000 req/hr |
| GraphQL node cost | 5,000 points/hr |
| Secondary — concurrent | 100 req/installation |
| Secondary — creates | 80 content-creating req/min |

**Reconciliation headroom (hourly, 500 tenants):** Per tenant/hour = ~80 REST calls. 500 × 80 = 40k calls/hr distributed across 500 **separate** installation quotas. Each uses ≤1.6% of its 5k/hr. Headroom: **98%**.

**Initial-sync concurrency guard:** 5000-repo tenant (A5 p99) = 50 calls at 100 repos/page. Onboarding waves: **cap concurrent initial syncs at 5 tenants per worker node**; spread pagination of a single 5000-repo tenant over a 2-hour window (50 pages at 1 req/s floor).

**Copilot Metrics:** Phase 2 only. 1 call/tenant/day when enabled.

**Backoff strategy (D59):**
- 1 req/s/tenant floor (Redis token bucket, `rl:<installation_id>`, refill 1/s, burst 10).
- Primary throttle: `X-RateLimit-Remaining < 100` → pause tenant reconciler until `X-RateLimit-Reset + 5s jitter`.
- 429: exponential `min(60s × 2^n, 900s)` ±20% jitter, max 5 retries, then DLQ.
- 403 secondary: honor `Retry-After`, 30s floor + 30% jitter.
- GraphQL: pre-pause if `rateLimit.remaining < cost × 10`.

### 11.3 Reconciliation cadence — hourly (D51)

Webhook is the freshness path; reconcile is a gap-filler. GitHub's webhook delivery SLO is ≥99.5%; 30-min worst-case miss affects 0.5% of events; hourly reconciler closes those within 60 min. 15-min upgrade gated on measured gap-rate >1% over 7 days.

### 11.4 Storage engine for `session_repo_links` — Postgres confirmed (D52)

- 10k devs × 5 sessions/day × 2 avg matches = 100k inserts/day = 36.5M rows/year.
- Recompute churn: 20%/week within first 7d, steady after.
- Monthly RANGE partition on `computed_at`; 4-month hot window (180-d retention = 6 partitions).
- Autovacuum: per-table override `autovacuum_vacuum_scale_factor=0.02`.
- Recommended `shared_buffers ≥ 8 GB` dedicated on the cluster.

**Plan B trigger:** p95 of Postgres IN-list (1k session_ids) join-driver query >500ms for **3 consecutive days** OR `session_repo_links > 100M rows`. Migration: `clickhouse-postgresql` dictionary refreshed every 60s. Deferred until signal fires.

### 11.5 Webhook secret rotation (D55)

Two-column atomic swap on `github_installations`. Parser verifies against `active` first; on mismatch, if `now() - rotated_at < interval '10 min'`, retry against `previous`. Log `github.webhook.secret_fallback_used` metric (trends to zero before window ends). Eviction cron (PgBoss, 1-minute) nulls `webhook_secret_previous_ref` once window closes.

### 11.6 GHES Server — Phase 2 (D58)

Deferred in full. No v1 code path, no orphan schema columns. `github_installations.provider` does not exist at v1; added only when the Phase-2 implementation lands. Revisit when a customer forces it.

### 11.7 Deployment provider diversity (D60)

Auto-supported: any provider writing to GitHub Deployments API — GitHub Environments, Vercel, Render, Fly.io, ArgoCD (with `argocd-notifications`), Spinnaker (github-deployment stage).

**Detection:**
```
HAS_DEPLOYMENT_SIGNAL(repo) :=
  COUNT(deployment webhooks in last 30d) >= 3
  AND distinct environments >= 1
```

If false: "Deploy frequency" and "MTTR" tiles render `insufficient data`. Never zero-fill.

### 11.8 Prometheus metrics

| Metric | Type | Rationale |
|---|---|---|
| `github_webhook_lag_seconds{tenant,event_type}` p95/p99 | Histogram | Per-tenant SLO |
| `github_reconciliation_duration_seconds{tenant}` | Histogram | Hourly cron drift |
| `github_webhook_redelivery_requests_total{reason}` | Counter | Miss-rate triage |
| `github_token_refresh_failures_total{installation}` | Counter | Silent-revoke detector |
| `session_repo_links_recompute_queue_depth` | Gauge | Back-pressure from enrichment |
| `github_api_rate_limit_remaining{installation}` | Gauge | Pre-throttle awareness |
| `github_api_secondary_rate_limit_hits_total{installation}` | Counter | Backoff-tuning health |
| `postgres_session_repo_links_in_list_join_seconds` p95 | Histogram | **Plan B trigger sensor** |
| `github_webhook_signature_fallback_used_total` | Counter | Rotation health (→ 0 in 10 min) |
| `github_webhook_signature_reject_total{reason}` | Counter | Spoof attempt detector |

---

## 12. AI / Scoring Integration

### 12.1 New scoring modules (`packages/scoring/src/v1/signals/`)

| Module | Feeds | Formula | Guard rails |
|---|---|---|---|
| `github_first_push_green_v1.ts` | outcome_quality_v1.1 (0.25) | `count(push where matching check_suite.conclusion='success' within 30min) / count(push with ≥1 check_suite)` | k≥5 team; ≥3 pushes with CI in window; suppress repo <2 check_suites/7d; **exclude commit_sha's that pass on re-run within 24h** (flaky-CI filter, D45); require ≥1 non-config file changed per push |
| `github_deploy_per_dollar_v1.ts` | outcome_quality_v1.1 (0.15) | `count(deployment_status.state='success' joined to merged PR within 24h) / sum(cost_usd of sessions joined to that PR)` | k≥5; suppress repo <1 deploy/week; prod-env allowlist (`^(prod\|production\|live\|main)$` or repo-admin allowlist); 24h revert penalty |
| `github_pr_size_v1.ts` | efficiency_v1 (secondary) | `accepted_and_retained_edits_per_dollar` unchanged; denominator PR (additions+deletions) | Strip `.gitattributes linguist-generated`; PRs <10 LOC excluded; winsorize p5/p95; test_loc/prod_loc companion (D46) |
| `github_review_churn_inverse_v1.ts` | outcome_quality_v1.1 (0.10) | `1 - (changes_requested_count / total_reviews)` per PR | k≥5; exclude self-review; exclude `type=Bot`; min 3 reviewed PRs per IC tile; time-to-approval **never ranked, never per-IC** (D49) |
| `github_codeowners_v1.ts` | cohort stratifier (step-2) | Set-valued: teams touched in session's commits | Contribution-earned override: owner if ≥30% of last-90d commits to path (D47) |
| `github_author_association_v1.ts` | cohort stratifier (step-2) | Enum → tier (A4) | Never standalone label (D43) |
| `github_security_clean_v1.ts` | outcome_quality_v1.1 (−0.05, **penalty-only negative**) | `−count(alerts introduced) / count(sessions)` | IC-private drill; manager aggregate k≥10; never positive; never per-IC view (D38) |

**Phase 2 modules:** `github_issue_cycle_v1.ts` (insight tile only until 800-case fixture), `github_copilot_metrics_v1.ts` (org-level, scope-gated).

### 12.2 `outcome_quality_v1.1` composition (D41)

```
outcome_quality_v1.1 =
    0.40 · useful_output_retained_v1        // unchanged anchor (D12)
  + 0.25 · first_push_green_rate_v1         // CORE
  + 0.15 · deploy_success_per_dollar_v1     // STRETCH; suppressed if HAS_DEPLOYMENT_SIGNAL=false
  + 0.10 · review_churn_inverse_v1          // CORE; suppressed if <3 reviewed PRs
  − 0.05 · security_clean_v1                // CORE; penalty-only negative term

Per-term normalization: raw → winsorize p5/p95 → percentile-rank within cohort.
```

**Suppression rule (D41):** When a term is suppressed (no data), weight redistributes proportionally across surviving terms. NEVER default-to-zero (would penalize no-deploy repos). Re-normalization is versioned — `v1.1` re-norm rule is locked; `v1.2` would re-version per D13.

**Confidence formula update (D48):** `outcomeEvents` in `confidence = min(1, √(outcomeEvents/10)) · min(1, √(activeDays/10))` now counts `{accepted_hunks ∪ first_push_green ∪ deploy_success}`. `activeDays` unchanged.

### 12.3 Cohort stratification (D42)

```
cohort_key = (task_category, author_association_tier, codeowner_domain, org_tenure_bucket)

author_association_tier (D43):
  SENIOR   = {OWNER, MEMBER}
  MID      = {COLLABORATOR}
  JUNIOR   = {CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR}
  EXTERNAL = {NONE}

codeowner_domain = top-level path of IC's primary CODEOWNERS match
    (e.g. "frontend", "backend", "infra", "ml")
  IC with no ownership → "generalist"

org_tenure_bucket = {≤30d, 31–180d, 181–730d, >730d}
  from first-commit date in org's repos
```

Fallback ladder when k<5: drop `org_tenure_bucket` → drop `codeowner_domain` → drop `author_association_tier`. Log cohort fallback in `audit_log`.

### 12.4 Eval fixture expansion (D44)

500-case fixture → **650 cases** before `v1.1` merges. Add 150 GitHub-signal cases. Held-out 100 → **150** cases (50 new GitHub-specific). MAE ≤ 3 gate unchanged. 12 new adversarial personas:

1. LOC-padding gamer (×10)
2. CI-off repo (×10)
3. Empty-push spammer (×10)
4. Junior in senior cohort mis-stratified (×15)
5. Backend vs frontend apples-to-oranges (×15)
6. Deploy-spam staging gamer (×10)
7. CI-flakiness-blamed-on-dev (×15)
8. Approval-stamping team (×10)
9. Revert-heavy high-LOC (×15)
10. Security-alert injector (×10)
11. No-CODEOWNERS generalist (×10)
12. Cross-boundary 3-domain contributor (×10)

Merge-blocking on any scoring-math change.

### 12.5 Gameability posture

Per CLAUDE.md §Non-goals: **no per-engineer public leaderboard, no review-speed ranking surface, no second-order LLM coaching (D10).** These signals feed team tiles, IC-private `/me`, and the 2×2 cohort scatter — nowhere else. Manager drill into IC page writes `audit_events` (D30).

---

## 13. Phased Implementation (4-week MVP cadence, CLAUDE.md §10 compatible)

Each phase is **TDD per surface, strict red-green ordering:**

```
1. Capture webhook fixture (gh api / Recent Deliveries copy) → commit to packages/fixtures/github/<event>/<scenario>.json
2. Write fixture-redaction test → green (no real TLDs/PEM/@ in fixture)
3. Write parser contract test against fixture → RED
4. Implement parser → GREEN
5. Write persistence integration test against real local Postgres → RED
6. Implement UPSERT + linker hook → GREEN
7. Write scoring-integration test against signal module → RED
8. Implement signal module → GREEN
9. Write Playwright E2E: POST fixture to localhost:8000 with valid X-Hub-Signature-256 → assert dashboard tile updates
```

No surface merges without all nine steps green. No fixture-less tests. No mocked databases — real Postgres + ClickHouse + Redis from `docker-compose.dev.yml`.

### Phase G0 — Sprint 0 (Foundations + Local Dev Path)

**Size: S.** Ships alongside Sprint-0 M0 in the main PRD.

**Prerequisites:** docker-compose.dev.yml up; `apps/ingest` boots against local Postgres.

- `packages/fixtures/github/<event>/<scenario>.json` directory scaffolded.
- `bun run fixtures:github:record` tool for capturing webhook payloads from real installs.
- CI gate: fixture-redaction privacy test (fails on real TLDs, PEM blocks, `@`-symbols).
- **G0 foundation fixtures (8)** captured: `pull_request.opened`, `pull_request.synchronize`, `pull_request.closed-merged-squash`, `push.regular`, `push.forced`, `check_suite.completed-success`, `workflow_run.completed`, `installation.created`.
- Local dev validation: POST each fixture to `localhost:8000/v1/webhooks/github/:installation_id` with correctly computed `X-Hub-Signature-256`; verify HMAC path + Redpanda emit + Postgres UPSERT.

**Tests written (red first):**
1. Fixture-redaction privacy test (1 test — enforces all fixture captures are sanitized).
2. 8 parser contract tests (one per G0 fixture).
3. 4 boot-fail-closed tests with distinct error codes: missing Postgres-backed `gitEventsStore`, missing `github_installations` rows table, missing reconciliation worker, missing webhook secret reference.

**Done when:** all G0 tests green; local dev loop POST → Postgres verified; no production code paths gated on a demo-mode flag.

### Phase G1 — Sprint 1 (Schema + Receiver + Linkage)

**Size: L.** Parallel with main PRD Workstream B/C/D/E.

**Prerequisites:** G0 done. Drizzle migration runner healthy. Redpanda broker up.

- Drizzle migrations for all 9 new tables + 3 existing-table extensions (§9).
- Backfill worker for `repos.provider_repo_id`, `git_events.repo_id_hash`, `repo_id_hash_aliases` seeding.
- Webhook secret rotation (D55) with 1-min eviction cron.
- `apps/worker/github` consumer: parse → UPSERT 6 domain tables.
- Linker worker: Redis Streams consumer, 30-s coalescer, pure-function state (D53), same-txn write to `session_repo_links` + `session_repo_eligibility`.
- PgBoss cron: monthly partition creator (T-7d), alias retirement worker (daily), hourly reconciliation scaffold.
- Initial repo sync: paginated `GET /installation/repositories`, rate-limit-aware, progress surfaced in admin UI.
- Production boot fail-closed on: missing Postgres store, missing installation state, missing repo registry resolver, missing reconciliation runner.

**G1 edge-case fixtures (+12):** `pull_request.closed-merged-rebase`, `pull_request.closed-unmerged`, `pull_request.opened-from-fork`, `pull_request.edited-with-closes-keyword`, `push.to-default-branch`, `push.to-non-default`, `check_suite.completed-failure`, `installation.suspend`, `installation.unsuspend`, `installation.deleted`, `repository.renamed`, `repository.transferred`.

**Tests (red first, in order):**
1. 12 persistence integration tests (webhook parser → Postgres UPSERT, real DB).
2. 4 linker commutativity tests (1000 random orderings, identical `inputs_sha256`).
3. 3 eligibility tests (`mode=all`, `mode=selected`, `inherit` resolution table from brief).
4. 1 webhook HMAC 401 + `audit_log` test.
5. 1 webhook secret rotation test (10-min dual-accept window).
6. 1 initial sync pagination + rate-limit test.
7. 1 initial-sync-concurrency-cap test (≤5 tenants per worker).
8. 1 installation-suspend-mid-session `stale_at` test.
9. 9 RLS cross-tenant probes (one per new table).
10. 1 repo-rename-preserves-hash test (captured rename fixture).
11. 1 manager-backdoor authz E2E test (`/me?user=<other>` → 403 + `audit_events`).

**Done when:** all G1 tests green; migration applies + rolls back cleanly; linker commutativity merge-blocker CI green.

### Phase G2 — Sprint 2 (Scoring CORE)

**Size: L.** Parallel with main PRD Workstream H (Insights) + I (Evals).

**Prerequisites:** G1 done. `session_repo_eligibility` populated with at least one week of production traffic for fixture calibration.

- `github_first_push_green_v1`, `github_pr_size_v1`, `github_codeowners_v1`, `github_author_association_v1`, `github_review_churn_inverse_v1`, `github_security_clean_v1` modules in `packages/scoring/`.
- `outcome_quality_v1.1` composition with suppression re-normalization and confidence formula update.
- Cohort key (D42) wired into step-2 of `ai_leverage_v1` locked math — additive, not a math change.
- Fixture expansion: 500 → 650 cases; held-out 100 → 150; 12 adversarial personas.
- `bun run test:scoring` MAE ≤ 3 gate runs against the expanded fixture; merge-blocking.
- Admin APIs per contract 07 additions (§14): 7 new endpoints.

**Tests (red first, in order):**
1. 6 scoring-module tests (1 per CORE signal, red against the 650-case fixture, green after implementation).
2. 12 adversarial persona fixture cases (specifically stress each signal's gameability guard).
3. 1 suppression-renormalization test (no-deploy repo is not penalized to zero).
4. 1 `security_clean_v1` never-positive-weight test (hard exclusion from positive composite).
5. 1 `security_clean_v1` never-per-IC-manager-view test (API denylist + `audit_events`).
6. Existing 500-case regression holds (MAE ≤ 3 on old fixture AND new 650-case).

**Done when:** all G2 tests green; MAE ≤ 3 on 650-case fixture; per-signal gameability tests green.

### Phase G3 — Sprint 3 (STRETCH + Hardening)

**Size: M.**

**Prerequisites:** G2 done. F15 Bun↔ClickHouse soak gate passed OR Plan B Go side-car ready per main PRD Architecture Rule #7.

- `github_deploy_per_dollar_v1` scoring module (requires prod-env allowlist UI per repo).
- Hourly reconciliation runner wired to redelivery-request API.
- Force-push tombstoning path (eligibility exclusion).
- Squash-merge admin-banner warning when tracked repo has incompatible squash setting.
- CODEOWNERS parser with contribution-earned override (≥30% of last-90d commits).

**G3 deploy fixtures (+3):** `deployment.created`, `deployment_status.success`, `deployment_status.failure`.

**Tests (red first):**
1. 1 deploy-per-dollar scoring test + 2 adversarial personas (staging-spam, non-prod-env).
2. 1 reconciliation gap-detection test.
3. 1 force-push tombstone test (eligibility exclusion verified).
4. 1 squash-incompatibility banner render test.
5. 1 codeowners contribution-override test.
6. 1 prod-env allowlist rejection test.

**Done when:** STRETCH scoring merges with MAE ≤ 3 on expanded fixture; hardening tests green; deploy-tile renders `insufficient data` when `HAS_DEPLOYMENT_SIGNAL=false` (never zero-fill).

**Cumulative test coverage v1:**
- 23 webhook parser contract tests
- 4 linker commutativity (golden-replay)
- 3 eligibility resolution
- 6 CORE + 1 STRETCH scoring module tests
- 12 adversarial persona fixture tests
- 9 RLS cross-tenant probes
- 4 boot-fail-closed
- 1 webhook HMAC 401 + audit_log test
- 1 manager-backdoor authz E2E
- 1 alias retirement orphan-report test
- 1 fixture-redaction privacy test
- 1 erase-org-github E2E

Total: **~66 new tests**, well above CLAUDE.md §10 minimum for Workstream I (≥5).

### Phase G4 — Phase 2 (post-MVP)

**Size: L aggregate**, split into sub-phases of M each:
- Issue-cycle-time (`closes #` / `fixes #` regex + link resolver → insight tile; subscore gated on fixture expansion to 800 cases).
- Copilot Metrics daily cron (org-level only, `copilot` scope gated).
- GHES Server full code path (schema additions, `api_base_url` switching, delivery-log parser, rate-limit table).

Phase-2 work does not block v1 sign-off.

---

## 14. Read-path APIs (contract 07 additions)

Admin-only writes for tracked-repo settings; RBAC unchanged (CLAUDE.md API Rules).

```
GET    /api/admin/github/connection               — installation status + sync progress
GET    /api/admin/github/repos                    — list (full_name, default_branch, effective tracked status, first_seen_at, archived_at)
PATCH  /api/admin/github/tracking-mode            — { mode: 'all' | 'selected' }
PATCH  /api/admin/github/repos/:provider_repo_id/tracking
                                                  — { state: 'inherit' | 'included' | 'excluded' }
POST   /api/admin/github/sync                     — trigger reconciliation
POST   /api/admin/github/webhook-secret/rotate    — 10-min dual-accept rotation
GET    /api/admin/github/tracking-preview         — dry-run ("this would move 47 sessions in/out of scope")
POST   /api/admin/github/redeliver                — replay webhooks for date range
```

All return types + inputs live as Zod schemas in `packages/api/src/schemas/github/*.ts` — source of truth for Server Actions + Route Handlers + CLI.

---

## 15. Contradictions with Main PRD — surfaced and resolved

| # | Existing PRD rule | GitHub Integration v1 addition | Resolution |
|---|---|---|---|
| 1 | **D13** — Metric versioning mandatory; no silent redefinition. | `outcome_quality_v1.1` introduced. | **Compliant.** Additive version; old `v1` remains dashboard-selectable; new dashboards default `v1.1`. |
| 2 | **D28** — Scoring math locked; MAE ≤ 3 on 500-case fixture, merge-blocking. | 500 → 650 cases; 100 → 150 held-out. | **D44 resolves:** merge-blocking gate applies to the version the code implements. New math must pass MAE≤3 on expanded fixture. |
| 3 | **D29** — `AI-Assisted:` commit trailer is primary opt-in attribution for non-Claude-Code agents. | Squash-merge may lose trailer. | **Resolved per A9:** admin banner on tracked repos with incompatible squash settings + `bematist policy set ai-assisted-trailer=on` posture retained. No alternative trailer path. |
| 4 | **Architecture Rule #4** — PgBoss is for crons only. | Linker recompute is per-event. | **D56 applies:** Redis Streams per tenant. Compliant. |
| 5 | **Architecture Rule #9** — Partition by `(tenant_id, engineer_id, day)` in ClickHouse events. | `session_repo_links` partitioned by `computed_at` monthly in Postgres. | **No conflict — different DB.** Rule #9 is a ClickHouse constraint; `session_repo_links` is Postgres control-plane. |
| 6 | **D14** — Idempotency via Redis SETNX on `(tenant_id, session_id, event_seq)` for ingest events. | Webhook idempotency via Redis SETNX on `X-GitHub-Delivery`. | **Same pattern, different key.** D34 parallels D14 without overriding it. |
| 7 | **Rule #7** — Single-writer pattern for ClickHouse from Bun; Plan B = Go side-car on flake. | `session_repo_links` is Postgres-only, no CH writes from linker. | **No conflict.** Linker does not write ClickHouse; only daily Postgres → CH dictionary sync path writes. |
| 8 | **CLAUDE.md §Non-goals** — no per-engineer leaderboards, no real-time per-engineer feed, no second-order LLM coaching. | Review-timing / security-alert signals are sensitive. | **D38 + D49 collectively enforce:** no per-IC leaderboard surface; review-timing never ranked per-IC; security-alert correlation IC-private by default with denylist at API layer; cohort stratification hides identity at team tile. |
| 9 | **INT9** — RLS cross-tenant probe is merge-blocker. | 9 new tables. | **Extended:** §9.11 + Phase G1 adds all 9 to the probe. Merge-blocker maintained. |

**No silent override.** Every D-number additive and every rule additive.

---

## 16. Decision Log (D33 – D60)

| # | Decision | Owner | Rationale |
|---|---|---|---|
| **D33** | `provider_repo_id` (VARCHAR, GitHub's stable numeric ID) is the cross-provider key. `repo_id_hash = hmac(tenant_salt, provider \|\| ':' \|\| provider_repo_id)`. | Data | Survives repo rename + transfer; portable to GitLab/Bitbucket. |
| **D34** | Webhook idempotency: Redis SETNX on `X-GitHub-Delivery`, 7-day TTL. | Infra | Parallels D14; authoritative over any CH/PG dedup. |
| **D38** | Security-alert correlation: IC-private by default; manager aggregate-only at team grain k≥10; NEVER feeds `ai_leverage_v1` positively (penalty-only); 30-d retention (below Tier-B). No disciplinary-use clause in customer contract. Hard exclusion in `packages/scoring` with a CI fixture that fails if a future commit wires it in positively. | Product | Prevents "who caused CVE-2026-X" becoming a disciplinary-proxy surface. Product-correctness rule, not a jurisdictional compliance rule. |
| **D41** | `outcome_quality_v1.1` is additive-versioned. Suppression re-normalizes weights across surviving terms; never default-to-zero. | AI/Scoring | D13/D21 compliance; no-deploy-repo penalty avoided. |
| **D42** | Cohort key = `(task_category, author_association_tier, codeowner_domain, org_tenure_bucket)`; fallback ladder when k<5. | AI/Scoring | Fixes backend-vs-frontend + junior-vs-senior Goodhart in 2×2. |
| **D43** | `author_association` is GitHub-canonical cohort input. Never rendered as standalone per-IC label. Mapping per A4. | AI/Scoring | GitHub-sourced, not self-report; prevents seniority gameplay. |
| **D44** | Scoring fixture expands to 650 synthetic dev-months with 150 GitHub-signal cases before `v1.1` merges. Held-out 150 cases. MAE≤3 enforced on new fixture, not old. | AI/Scoring | Merge-blocking gate applies to the version the code implements. |
| **D45** | `first_push_green` excludes `commit_sha` that later pass on CI re-run within 24h (flaky-CI exclusion). | AI/Scoring | Avoid blaming devs for infra flakes. |
| **D46** | PR-size denominator strips `.gitattributes linguist-generated` paths before counting additions/deletions. | AI/Scoring | Kills lockfile/vendor/min.js LOC-padding. |
| **D47** | CODEOWNERS ownership earned if ≥30% of last-90d commits to path are IC's (static OWNERS file alone insufficient). Multi-owner = non-exclusive set attribution; no primary-owner tiebreak; session deduped by `session_id` at org rollup. | AI/Scoring + Data | Prevents claim-easy-path game; Goodhart-safe. |
| **D48** | `outcomeEvents` in confidence formula expands to `{accepted_hunks ∪ first_push_green ∪ deploy_success}`. `activeDays` unchanged. | AI/Scoring | More outcome types → meaningful confidence; `√(n/10)` curve unchanged. |
| **D49** | Review-churn = `changes_requested / total_reviews` only. Time-to-approval never ranked, never displayed per-IC. | AI/Scoring | Non-goal: no review-speed ranking (CLAUDE.md §2.3). |
| **D50** | Copilot Metrics API feeds `adoption_depth_v1` as org-level baseline only; Phase 2. | AI/Scoring | API is org-aggregated by GitHub; respects D10 (no per-session LLM judgment). |
| **D51** | Reconciliation cadence: hourly. 15-min upgrade gated on measured webhook-miss rate >1% over 7 days. | Infra | Webhook is the freshness path; reconcile is gap-filler. |
| **D52** | `session_repo_links` lives in Postgres at v1; monthly RANGE partition on `computed_at`; 180-day retention; DROP PARTITION only. Plan B (ClickHouse dictionary) triggered on measured p95 IN-list join >500ms for 3 consecutive days OR >100M rows. | Data + Infra | Matches recompute semantics; CH dictionary is additive, not replacing. |
| **D53** | Linker state is a **pure function** of input set. `inputs_sha256` is idempotency key. Commutativity test (1000 random orderings) is merge-blocking. | Data | Webhooks arrive out-of-order; ordering-dependent logic is a bug class we refuse. |
| **D54** | `session_repo_eligibility` is a physical table, written same-txn as `session_repo_links`; not a Postgres MV. | Data | MV refresh is not per-row cascade-safe; txn guarantees eligibility never lags links. |
| **D55** | `repo_id_hash_aliases` SLO = `migrated_at + 180d` active, `+365d` cold archive (HMAC'd parquet to S3-equivalent), then hard delete. Webhook secret rotation = 10-minute dual-accept via two-column atomic UPDATE. | Data + Infra | Retention parity + zero-downtime secret rotation. |
| **D56** | Recompute queue = Redis Streams per-tenant (`session_repo_recompute:{tenant_id}`). NOT PgBoss. | Data | Architecture Rule #4 (PgBoss is crons only); per-event load breaks PgBoss at 8M evt/day. |
| **D57** | `session_repo_links.evidence` JSONB contains only hashes and structural counts — never raw PR titles, commit messages, or CODEOWNERS logins. Forbidden-field validator extended. | Data | Enforces §Security "server-side forbidden-field reject" on new linkage surface. |
| **D58** | GHE Server: Phase 2. No v1 code path, no orphan schema columns. Revisit when a customer forces it. | Infra | No currently-signed launch customer requires GHES. |
| **D59** | Per-tenant API floor: 1 req/sec/installation. Envoy ext_authz token bucket. Exponential backoff on 429; honor `Retry-After` on 403 secondary. | Infra | Conservative within 5k/hr base quota; prevents 429 storms across 500 tenants. |
| **D60** | Deployment metrics suppress (NOT zero-fill) when `<3` GitHub Deployments webhooks in 30 days. | Infra | False absence beats false precision. |

(Gaps D35–D37, D39–D40 intentional — numbers reserved for future revision if EU/compliance workstream lands decisions that need PRD-series slots.)

---

## 17. Risks & Non-Goals

### 17.1 Top risks (ranked severity × likelihood)

| # | Risk | Mitigation | Detected by |
|---|---|---|---|
| 1 | Squash-merge wipes `AI-Assisted:` trailer, attribution silently falls back to weaker path | Admin banner on incompatible squash-setting repos; D29 posture retained; alt path is CODEOWNERS + commit_sha join | Weekly attribution-coverage report per tenant |
| 2 | Recompute storm from 5000-repo initial sync + active PRs floods linker | Per-tenant Redis Stream partition (D56) + 30-s coalescer + back-pressure banner | `session_repo_links_recompute_queue_depth` metric |
| 3 | `session_repo_links` bloat exceeds 100M rows faster than expected | Monthly partition DROP (D52) + Plan B ClickHouse dictionary trigger | `postgres_session_repo_links_in_list_join_seconds` p95 |
| 4 | GitHub changes webhook payload shape (new required field, deprecation) | Fixture-versioned parsers; contract tests against pinned fixtures (CLAUDE.md Testing Rules) | CI fails on drift; fixture recorder catches diff |
| 5 | Manager discovers backdoor via `/me?user=<other>` | Explicit authz check + `audit_events` row (D30); E2E test: "manager as IC" returns 403 | E2E test, merge-blocker |
| 6 | Security-alert correlation accidentally surfaces to manager view via query-builder | Denylist at API layer (not just RLS); scoring-fixture test asserts `security_clean_v1` NEVER positive-weight in composite | Test fails in CI |
| 7 | Rate-limit exhaustion for one aggressive tenant takes down reconciliation for neighbors | Per-installation quota is GitHub-side isolated; token bucket is per-tenant, not shared; Envoy back-pressure on 429 | `github_api_rate_limit_remaining{installation}` |
| 8 | MAE regression on expanded 650-case fixture blocks `v1.1` merge | Fixture built during G2; gate enforced pre-merge; signal weights tunable to restore MAE | `bun run test:scoring` CI |
| 9 | Force-push tombstoning misses a race with concurrent session enrichment | Commutativity test (D53) covers random orderings; `force_pushed_out_at` is additive (not delete) | Golden-replay test, merge-blocker |
| 10 | Local-dev fixture captures accidentally include real secrets | Fixture-redaction privacy test fails build on real TLDs/PEM/@-symbols; merge-blocker on fixture PRs | CI fails in G0 gate |

### 17.2 Non-goals (reaffirmed from CLAUDE.md §2.3)

- No per-engineer public leaderboards. No "fastest reviewer" / "most deploys" rankings.
- No per-engineer real-time feed.
- No second-order LLM coaching (D10).
- No collector-side GitHub auth — App lives server-side.
- No replacing GitLab/Bitbucket schema — they retain existing support without upgraded outcome signals in v1.
- No rewriting historical ClickHouse `events` rows in place.
- No cross-tenant benchmarking.
- No EU-specific signal profiles (separate workstream via env flags).
- No `bematist erase --user` path in this PRD (broader workstream).
- No GHES support at v1 (Phase 2).
- No demo-mode flags or tunneling — local dev runs against captured fixtures + local Postgres.

---

## 18. MVP Validation Checklist

Every requirement in `docs/github.md` maps to a specific phase and test:

| Brief requirement | Phase | Primary test |
|---|---|---|
| §Goals 1: persist installations, repos, PRs, commits, workflow runs, check suites, deployments, reviews | G1 | Integration test per parser (12 tests) |
| §Goals 2: stable repo identity on provider_repo_id | G1 | Rename-preserves-hash test from captured fixture |
| §Goals 3: one derived linkage surface authoritative for manager-facing | G1 | Eligibility resolution test × 3 |
| §Goals 4: outcome signals wired to scoring | G2 (CORE 1,3,4,6,7,9), G3 (STRETCH 2) | Scoring module tests |
| §Goals 5: branch is evidence, never eligibility | G1 | Branch-only session returns NOT eligible |
| §Goals 6: fail closed on missing persistence | G0/G1 | Boot-fail-closed test × 4 |
| §V1 Guardrails (all 9 bullets) | G1/G2 | Per-guardrail test |
| §Local-first demo path | G0 | Fixture POST → Postgres verified; no tunnel |
| §Installation lifecycle (created/suspend/unsuspend/deleted) | G1 | 4 fixture tests |
| §Initial repo sync 5000-repo | G1 | Pagination + rate-limit test |
| §Webhook secret rotation | G1 | Dual-accept 10-min window test (D55) |
| §Out-of-order, force-push, squash, rebase, fork handling | G1/G3 | 6 edge-case fixture tests |
| §Outcome signals 1–8 | G2 (CORE 1,3,4,6,7,9), G3 (STRETCH 2), G4 (PHASE-2 5,8) | Module + persona tests |
| §Admin APIs (8) | G2 | API auth + audit tests |
| §Boot and operational requirements | G0/G1 | Fail-closed + metric exposure test |
| §Edge cases | G1/G3 | Per-case fixture test |

---

## 19. Appendix: Environment variables (extends CLAUDE.md)

```
# GitHub integration (server-side)
GITHUB_APP_ID                      # integer
GITHUB_APP_PRIVATE_KEY_REF         # secrets-store pointer; never plaintext env in managed cloud
GITHUB_APP_WEBHOOK_SECRET_REF      # secrets-store pointer
GITHUB_WEBHOOK_IDEMPOTENCY_TTL_SEC # default 604800 (7d)
GITHUB_RECONCILE_CADENCE_SEC       # default 3600 (hourly; D51)
GITHUB_PLAN_B_CH_DICT_ENABLED      # default false; flipped by D52 trigger
```

---

*Status:* **Ready for TDD implementation.** No open questions, no TBDs, no unresolved contradictions. Phase G0 can begin in parallel with Sprint-0 M0 of the main PRD; Phases G1–G3 align with Sprints 1–3.
