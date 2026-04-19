-- PRD §13 Phase G3 — STRETCH + Hardening. Additive migration over G1/G2.
--
-- Lands five schema additions in one transaction:
--
--   1. repos.prod_env_allowlist_regex — per-repo admin-editable regex for
--      the deploy-per-dollar scoring module's prod-env filter (D60).
--
--   2. repos.merge_commit_allowed / repos.squash_merge_allowed — carried
--      from GitHub's repo settings so the admin UI can warn when a tracked
--      repo's squash-only setting will drop the AI-Assisted trailer
--      (PRD §17 risk #1).
--
--   3. github_webhook_deliveries_seen — one row per successfully-processed
--      X-GitHub-Delivery UUID. The hourly reconciler scans this against
--      GitHub's `/app/hook/deliveries` list to detect missed webhooks and
--      trigger redelivery (D51, §11.3).
--
--   4. admin_dismissed_banners — per-(tenant, user, banner_key) record of
--      which admin banners the user has dismissed. Simple opt-out state so
--      the squash-merge warning doesn't nag.
--
--   5. repo_path_commit_counts_90d — materialized view holding (tenant,
--      provider_repo_id, author_login_hash, path_prefix, commits_90d) for
--      D47 CODEOWNERS contribution-earned override. Refreshed daily via
--      PgBoss cron.
--
-- RLS: steps 3 + 4 + (indirectly) 5 follow the `app_current_org` policy.
-- Idempotent. No .down — roll forward only; green-field tables + columns.

-- 1. prod_env_allowlist_regex on repos.
-- Nullable text; NULL = use global default `^(prod|production|live|main)$`.
-- The scoring module compiles this to a RegExp; we validate at the API
-- boundary, not here.
ALTER TABLE "repos"
  ADD COLUMN IF NOT EXISTS "prod_env_allowlist_regex" text NULL;

-- 2. merge_commit_allowed / squash_merge_allowed on repos.
-- Both default NULL (= "unknown") so repos synced before G3 don't assert a
-- false setting. Filled in by the initial sync + repository.edited webhook
-- (handler extension TBD in Phase 2 — the banner logic here falls back to
-- "suppressed" when both are NULL).
ALTER TABLE "repos"
  ADD COLUMN IF NOT EXISTS "merge_commit_allowed" boolean NULL,
  ADD COLUMN IF NOT EXISTS "squash_merge_allowed" boolean NULL;

-- 3. github_webhook_deliveries_seen — idempotency ledger for reconcile gap
-- detection. (tenant_id, delivery_id) PRIMARY KEY. `event` + `received_at`
-- carried for auditability and for the reconciler's "is this in a 7-day
-- window?" check. No payload body — Redis SETNX already authoritatively
-- deduped; this row only records "yes we saw delivery X."
CREATE TABLE IF NOT EXISTS "github_webhook_deliveries_seen" (
  "tenant_id"      uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "installation_id" bigint     NOT NULL,
  "delivery_id"    text        NOT NULL,
  "event"          text        NOT NULL,
  "received_at"    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS "gh_deliv_seen_tenant_recent_idx"
  ON "github_webhook_deliveries_seen" ("tenant_id", "installation_id", "received_at" DESC);

ALTER TABLE "github_webhook_deliveries_seen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "github_webhook_deliveries_seen" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "github_webhook_deliveries_seen";
CREATE POLICY org_isolation ON "github_webhook_deliveries_seen"
  USING (tenant_id = app_current_org())
  WITH CHECK (tenant_id = app_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "github_webhook_deliveries_seen" TO app_bematist;

-- 4. admin_dismissed_banners — one row per (tenant, user, banner_key).
-- Keeps things simple — no explicit expiry; callers may re-enable a
-- banner by DELETEing the row (not exposed in UI yet).
CREATE TABLE IF NOT EXISTS "admin_dismissed_banners" (
  "tenant_id"    uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "user_id"      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "banner_key"   text        NOT NULL,
  "dismissed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, banner_key)
);
ALTER TABLE "admin_dismissed_banners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_dismissed_banners" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "admin_dismissed_banners";
CREATE POLICY org_isolation ON "admin_dismissed_banners"
  USING (tenant_id = app_current_org())
  WITH CHECK (tenant_id = app_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "admin_dismissed_banners" TO app_bematist;

-- 5. repo_path_commit_counts_90d — D47 contribution-earned override input.
-- We implement this as a regular table (NOT a Postgres MATERIALIZED VIEW)
-- because:
--   • path_prefix is derived from the git_events payload shape and we may
--     want to extend the derivation logic without REFRESH cycles;
--   • Postgres MATERIALIZED VIEW refresh is not cascade-safe under RLS
--     without SECURITY DEFINER gymnastics;
--   • a simple UPSERT cron (daily) is mundane operational code.
-- The PgBoss cron in apps/worker/src/github-linker/index.ts owns the write
-- path. The scoring module reads via `SELECT` with RLS.
CREATE TABLE IF NOT EXISTS "repo_path_commit_counts_90d" (
  "tenant_id"         uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "provider_repo_id"  varchar(32) NOT NULL,
  "author_login_hash" bytea       NOT NULL,
  "path_prefix"       text        NOT NULL,
  "commits_90d"       integer     NOT NULL,
  "computed_at"       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, author_login_hash, path_prefix)
);
CREATE INDEX IF NOT EXISTS "rpcc90d_repo_path_idx"
  ON "repo_path_commit_counts_90d" ("tenant_id", "provider_repo_id", "path_prefix");

ALTER TABLE "repo_path_commit_counts_90d" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "repo_path_commit_counts_90d" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "repo_path_commit_counts_90d";
CREATE POLICY org_isolation ON "repo_path_commit_counts_90d"
  USING (tenant_id = app_current_org())
  WITH CHECK (tenant_id = app_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "repo_path_commit_counts_90d" TO app_bematist;
