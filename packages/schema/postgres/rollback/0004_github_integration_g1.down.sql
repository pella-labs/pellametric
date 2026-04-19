-- Rollback for custom/0004_github_integration_g1.sql.
-- Invoke via `bun run db:migrate:pg -- --rollback 0004_github_integration_g1`.
-- See packages/schema/postgres/rollback.ts for the runner.
--
-- Strategy: drop in reverse dependency order. Every statement uses IF EXISTS
-- so partial / already-rolled-back states succeed. Policies are dropped via
-- DROP POLICY IF EXISTS; RLS can be disabled implicitly by the DROP TABLE.
--
-- After rollback, the schema is restored to the pre-G1 state — EXCEPT the
-- G0 stub table is NOT recreated (G1 is the only owner of the
-- `github_installations` table now; the stub file was deleted in the same PR).
-- If a deployment needs to fall back before G1 landed at all, revert the PR.

-- -------------------------------------------------------------------------
-- 1. Drop all new tables (CASCADE catches indexes, FKs, partitions, policies)
-- -------------------------------------------------------------------------
DROP TABLE IF EXISTS "session_repo_links_2026_05" CASCADE;
DROP TABLE IF EXISTS "session_repo_links_2026_04" CASCADE;
DROP TABLE IF EXISTS "session_repo_links"         CASCADE;

DROP TABLE IF EXISTS "repo_id_hash_aliases"       CASCADE;
DROP TABLE IF EXISTS "session_repo_eligibility"   CASCADE;
DROP TABLE IF EXISTS "github_code_owners"         CASCADE;
DROP TABLE IF EXISTS "github_deployments"         CASCADE;
DROP TABLE IF EXISTS "github_check_suites"        CASCADE;
DROP TABLE IF EXISTS "github_pull_requests"       CASCADE;
DROP TABLE IF EXISTS "github_installations"       CASCADE;

-- -------------------------------------------------------------------------
-- 2. Drop added indexes on pre-existing tables.
-- -------------------------------------------------------------------------
DROP INDEX IF EXISTS "git_events_repo_hash_idx";
DROP INDEX IF EXISTS "repos_provider_unique";

-- -------------------------------------------------------------------------
-- 3. Drop added constraints on pre-existing tables.
-- -------------------------------------------------------------------------
ALTER TABLE "repos"
  DROP CONSTRAINT IF EXISTS "repos_github_provider_id_required",
  DROP CONSTRAINT IF EXISTS "repos_tracking_state_check";

ALTER TABLE "orgs"
  DROP CONSTRAINT IF EXISTS "orgs_github_repo_tracking_mode_check";

-- -------------------------------------------------------------------------
-- 4. Drop added columns on pre-existing tables.
-- -------------------------------------------------------------------------
ALTER TABLE "repos"
  DROP COLUMN IF EXISTS "tracking_state",
  DROP COLUMN IF EXISTS "deleted_at",
  DROP COLUMN IF EXISTS "archived_at",
  DROP COLUMN IF EXISTS "first_seen_at",
  DROP COLUMN IF EXISTS "default_branch",
  DROP COLUMN IF EXISTS "provider_repo_id";

ALTER TABLE "git_events"
  DROP COLUMN IF EXISTS "author_association",
  DROP COLUMN IF EXISTS "repo_id_hash",
  DROP COLUMN IF EXISTS "branch";

ALTER TABLE "orgs"
  DROP COLUMN IF EXISTS "github_repo_tracking_mode";
