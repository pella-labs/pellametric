-- PRD §13 Phase G1 Step 1 — GitHub integration schema.
--
-- Supersedes custom/0003_github_installations_stub.sql (deleted in this PR).
-- That stub was a minimal CREATE IF NOT EXISTS placeholder to satisfy the G0
-- boot probe. Its shape is INCOMPATIBLE with the canonical §9.1 DDL (stub
-- used `created_at` only; canonical DDL adds webhook-secret-rotation columns,
-- status, app_id, github_org_*, token_ref, etc.). We DROP and re-CREATE
-- because no real data is ever written to the stub (G0 never wired an app
-- writer; bootCheck only probes existence).
--
-- This file is IDEMPOTENT: re-running over an already-migrated DB is a no-op
-- (every DROP POLICY IF EXISTS + every CREATE uses IF NOT EXISTS or
-- guarded DO-blocks). Applied as a custom SQL file by packages/schema/postgres/
-- migrate.ts AFTER drizzle's numbered migrations.
--
-- Table set (PRD §9.1–§9.8):
--   1. github_installations        (full canonical DDL)
--   2. github_pull_requests
--   3. github_check_suites
--   4. github_deployments
--   5. github_code_owners
--   6. session_repo_links          (partitioned by RANGE on computed_at)
--   7. session_repo_eligibility
--   8. repo_id_hash_aliases
--
-- Extensions to existing tables (PRD §9.9):
--   - repos: +provider_repo_id, +default_branch, +first_seen_at,
--            +archived_at, +deleted_at, +tracking_state
--   - git_events: +branch, +repo_id_hash, +commit_sha_g1, +pr_number_g1,
--                 +author_association   (commit_sha + pr_number already exist;
--                                        we reuse — see migration notes below)
--   - orgs: +github_repo_tracking_mode
--
-- RLS policy (PRD §9.10):
--   Applied to every new table. The USING/WITH CHECK clause follows the
--   project's existing convention (tenant_id = app_current_org()), not the
--   PRD's literal `current_setting('app.tenant_id')::uuid` — `tenant_id` in
--   the PRD is an alias for `orgs.id`, and we already have an
--   `app_current_org()` helper (custom/0002_rls_org_isolation.sql) that
--   reads `app.current_org_id` defensively (returns NULL if unset). Deviating
--   here would require two RLS conventions in one codebase — avoided.
--
-- Rollback: see packages/schema/postgres/rollback/0004_github_integration_g1.down.sql
-- Invoke via `bun run db:migrate:pg -- --rollback 0004_github_integration_g1`.

-- -------------------------------------------------------------------------
-- Drop the G0 stub table so we can CREATE with the canonical shape.
-- Safe — the stub was never written to in production (bootCheck only
-- probed existence; no writers wired). Empty-table assumption validated
-- at the DB level before this migration is authored.
-- -------------------------------------------------------------------------
DROP TABLE IF EXISTS "github_installations" CASCADE;

-- -------------------------------------------------------------------------
-- §9.1 github_installations — installation metadata + webhook-secret rotation
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "github_installations" (
  "id"                            bigserial PRIMARY KEY,
  "tenant_id"                     uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "installation_id"               bigint      NOT NULL,
  "github_org_id"                 bigint      NOT NULL,
  "github_org_login"              text        NOT NULL,
  "app_id"                        bigint      NOT NULL,
  "status"                        text        NOT NULL
                                    CHECK (status IN ('active','suspended','revoked','reconnecting')),
  "token_ref"                     text        NOT NULL,
  "webhook_secret_active_ref"     text        NOT NULL,
  "webhook_secret_previous_ref"   text        NULL,
  "webhook_secret_rotated_at"     timestamptz NULL,
  "last_reconciled_at"            timestamptz NULL,
  "installed_at"                  timestamptz NOT NULL DEFAULT now(),
  "suspended_at"                  timestamptz NULL,
  "revoked_at"                    timestamptz NULL,
  "created_at"                    timestamptz NOT NULL DEFAULT now(),
  "updated_at"                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT github_installations_tenant_install_uniq UNIQUE (tenant_id, installation_id),
  CONSTRAINT github_installations_install_global_uniq UNIQUE (installation_id)
);

CREATE INDEX IF NOT EXISTS "gh_inst_tenant_status_idx"
  ON "github_installations" ("tenant_id", "status");

-- Partial index feeds the eviction cron (shipped by G1-webhook-ingest):
-- quickly enumerate installations whose previous_ref is still honored.
CREATE INDEX IF NOT EXISTS "gh_inst_prev_secret_idx"
  ON "github_installations" ("webhook_secret_rotated_at")
  WHERE "webhook_secret_previous_ref" IS NOT NULL;

-- -------------------------------------------------------------------------
-- §9.2 github_pull_requests
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "github_pull_requests" (
  "tenant_id"            uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "provider"             text        NOT NULL DEFAULT 'github'
                           CHECK (provider = 'github'),
  "provider_repo_id"     varchar(32) NOT NULL,
  "pr_number"            integer     NOT NULL,
  "pr_node_id"           text        NOT NULL,
  "state"                text        NOT NULL
                           CHECK (state IN ('open','closed','merged')),
  "draft"                boolean     NOT NULL DEFAULT false,
  "title_hash"           bytea       NOT NULL,
  "base_ref"             text        NOT NULL,
  "head_ref"             text        NOT NULL,
  "head_sha"             char(40)    NOT NULL,
  "merge_commit_sha"     char(40)    NULL,
  "author_login_hash"    bytea       NOT NULL,
  "author_association"   text        NULL,
  "additions"            integer     NOT NULL DEFAULT 0,
  "deletions"            integer     NOT NULL DEFAULT 0,
  "changed_files"        integer     NOT NULL DEFAULT 0,
  "commits_count"        integer     NOT NULL DEFAULT 0,
  "opened_at"            timestamptz NOT NULL,
  "closed_at"            timestamptz NULL,
  "merged_at"            timestamptz NULL,
  "ingested_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, pr_number)
);
CREATE INDEX IF NOT EXISTS "gh_pr_head_sha_idx"
  ON "github_pull_requests" ("tenant_id", "head_sha");
CREATE INDEX IF NOT EXISTS "gh_pr_merged_idx"
  ON "github_pull_requests" ("tenant_id", "merged_at" DESC)
  WHERE "merged_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "gh_pr_repo_state_idx"
  ON "github_pull_requests" ("tenant_id", "provider_repo_id", "state", "opened_at" DESC);

-- -------------------------------------------------------------------------
-- §9.3 github_check_suites
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "github_check_suites" (
  "tenant_id"         uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "provider_repo_id"  varchar(32) NOT NULL,
  "head_sha"          char(40)    NOT NULL,
  "suite_id"          bigint      NOT NULL,
  "status"            text        NOT NULL
                        CHECK (status IN ('queued','in_progress','completed')),
  "conclusion"        text        NULL
                        CHECK (conclusion IN ('success','failure','neutral','cancelled','skipped','timed_out','action_required','stale')),
  "runs_count"        integer     NOT NULL DEFAULT 0,
  "failed_runs_count" integer     NOT NULL DEFAULT 0,
  "started_at"        timestamptz NULL,
  "completed_at"      timestamptz NULL,
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, head_sha, suite_id)
);
CREATE INDEX IF NOT EXISTS "gh_cs_repo_conclusion_idx"
  ON "github_check_suites" ("tenant_id", "provider_repo_id", "conclusion", "completed_at" DESC)
  WHERE "conclusion" IS NOT NULL;

-- -------------------------------------------------------------------------
-- §9.4 github_deployments
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "github_deployments" (
  "tenant_id"         uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "provider_repo_id"  varchar(32) NOT NULL,
  "deployment_id"     bigint      NOT NULL,
  "environment"       text        NOT NULL,
  "sha"               char(40)    NOT NULL,
  "ref"               text        NOT NULL,
  "status"            text        NOT NULL
                        CHECK (status IN ('pending','queued','in_progress','success','failure','error','inactive')),
  "first_success_at"  timestamptz NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_repo_id, deployment_id)
);
CREATE INDEX IF NOT EXISTS "gh_dep_sha_idx"
  ON "github_deployments" ("tenant_id", "sha");
CREATE INDEX IF NOT EXISTS "gh_dep_env_idx"
  ON "github_deployments" ("tenant_id", "provider_repo_id", "environment", "first_success_at" DESC);

-- -------------------------------------------------------------------------
-- §9.5 github_code_owners — CODEOWNERS parse results (D47 input)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "github_code_owners" (
  "tenant_id"        uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "provider_repo_id" varchar(32) NOT NULL,
  "ref"              text        NOT NULL,
  "content_sha256"   bytea       NOT NULL,
  "rules"            jsonb       NOT NULL,
  "parsed_at"        timestamptz NOT NULL DEFAULT now(),
  "superseded_at"    timestamptz NULL,
  PRIMARY KEY (tenant_id, provider_repo_id, ref, content_sha256)
);
CREATE INDEX IF NOT EXISTS "gh_co_active_idx"
  ON "github_code_owners" ("tenant_id", "provider_repo_id", "ref")
  WHERE "superseded_at" IS NULL;

-- -------------------------------------------------------------------------
-- §9.6 session_repo_links — PARTITIONED by RANGE (computed_at), monthly.
-- Seed current-month + next-month partitions inline. The cron that
-- auto-creates T-7d partitions ahead lands in G1-linker, not here.
-- Retention: 180d via DROP PARTITION (never DELETE, never TTL — CLAUDE.md
-- Architecture Rule #9).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session_repo_links" (
  "tenant_id"        uuid        NOT NULL,
  "session_id"       uuid        NOT NULL,
  "repo_id_hash"     bytea       NOT NULL,
  "match_reason"     text        NOT NULL
                       CHECK (match_reason IN ('direct_repo','commit_link','pr_link','deployment_link')),
  "provider_repo_id" varchar(32) NOT NULL,
  "evidence"         jsonb       NOT NULL,
  "confidence"       smallint    NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  "inputs_sha256"    bytea       NOT NULL,
  "computed_at"      timestamptz NOT NULL,
  "stale_at"         timestamptz NULL,
  PRIMARY KEY (tenant_id, session_id, repo_id_hash, match_reason, computed_at)
) PARTITION BY RANGE (computed_at);

-- Seed partitions: current month (2026-04) + next month (2026-05).
-- IF NOT EXISTS is not supported for CREATE TABLE ... PARTITION OF in all
-- PG versions, so we use a DO-block guarded on pg_class lookup.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'session_repo_links_2026_04') THEN
    EXECUTE $ddl$
      CREATE TABLE session_repo_links_2026_04 PARTITION OF session_repo_links
        FOR VALUES FROM ('2026-04-01') TO ('2026-05-01')
    $ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'session_repo_links_2026_05') THEN
    EXECUTE $ddl$
      CREATE TABLE session_repo_links_2026_05 PARTITION OF session_repo_links
        FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')
    $ddl$;
  END IF;
END $$;

-- Per-partition indexes (Postgres requires indexes to be defined per
-- partition when not declared on the partitioned parent; some indexes
-- like unique-with-partial-predicate are only partition-local). We keep
-- them partition-local for parity with the PRD's literal DDL.
CREATE UNIQUE INDEX IF NOT EXISTS "srl_2026_04_unique_idx"
  ON "session_repo_links_2026_04" ("tenant_id", "session_id", "repo_id_hash", "match_reason");
CREATE INDEX IF NOT EXISTS "srl_2026_04_repo_computed_idx"
  ON "session_repo_links_2026_04" ("tenant_id", "repo_id_hash", "computed_at" DESC);
CREATE INDEX IF NOT EXISTS "srl_2026_04_session_idx"
  ON "session_repo_links_2026_04" ("tenant_id", "session_id");
CREATE INDEX IF NOT EXISTS "srl_2026_04_inputs_idx"
  ON "session_repo_links_2026_04" ("tenant_id", "inputs_sha256");
CREATE INDEX IF NOT EXISTS "srl_2026_04_stale_idx"
  ON "session_repo_links_2026_04" ("tenant_id", "stale_at")
  WHERE "stale_at" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "srl_2026_05_unique_idx"
  ON "session_repo_links_2026_05" ("tenant_id", "session_id", "repo_id_hash", "match_reason");
CREATE INDEX IF NOT EXISTS "srl_2026_05_repo_computed_idx"
  ON "session_repo_links_2026_05" ("tenant_id", "repo_id_hash", "computed_at" DESC);
CREATE INDEX IF NOT EXISTS "srl_2026_05_session_idx"
  ON "session_repo_links_2026_05" ("tenant_id", "session_id");
CREATE INDEX IF NOT EXISTS "srl_2026_05_inputs_idx"
  ON "session_repo_links_2026_05" ("tenant_id", "inputs_sha256");
CREATE INDEX IF NOT EXISTS "srl_2026_05_stale_idx"
  ON "session_repo_links_2026_05" ("tenant_id", "stale_at")
  WHERE "stale_at" IS NOT NULL;

-- -------------------------------------------------------------------------
-- §9.7 session_repo_eligibility — physical table (D54)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session_repo_eligibility" (
  "tenant_id"           uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "session_id"          uuid        NOT NULL,
  "effective_at"        timestamptz NOT NULL,
  "eligibility_reasons" jsonb       NOT NULL,
  "eligible"            boolean     NOT NULL,
  "inputs_sha256"       bytea       NOT NULL,
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id)
);
CREATE INDEX IF NOT EXISTS "sre_tenant_eligible_idx"
  ON "session_repo_eligibility" ("tenant_id", "eligible", "effective_at" DESC);

-- -------------------------------------------------------------------------
-- §9.8 repo_id_hash_aliases — rename/transfer/salt-rotation provenance
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "repo_id_hash_aliases" (
  "tenant_id"   uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "old_hash"    bytea       NOT NULL,
  "new_hash"    bytea       NOT NULL,
  "reason"      text        NOT NULL
                  CHECK (reason IN ('rename','transfer','salt_rotation','provider_change')),
  "migrated_at" timestamptz NOT NULL DEFAULT now(),
  "retires_at"  timestamptz NOT NULL,
  "archived_at" timestamptz NULL,
  PRIMARY KEY (tenant_id, old_hash, new_hash)
);
CREATE INDEX IF NOT EXISTS "rha_retires_idx"
  ON "repo_id_hash_aliases" ("retires_at")
  WHERE "archived_at" IS NULL;
CREATE INDEX IF NOT EXISTS "rha_new_idx"
  ON "repo_id_hash_aliases" ("tenant_id", "new_hash");

-- -------------------------------------------------------------------------
-- §9.9 Extensions to existing tables
-- -------------------------------------------------------------------------
-- repos: provider_repo_id + companions (NOT VALID — validated post-backfill)
ALTER TABLE "repos"
  ADD COLUMN IF NOT EXISTS "provider_repo_id" varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS "default_branch"   text         NULL,
  ADD COLUMN IF NOT EXISTS "first_seen_at"    timestamptz  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "archived_at"      timestamptz  NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at"       timestamptz  NULL,
  ADD COLUMN IF NOT EXISTS "tracking_state"   text         NOT NULL DEFAULT 'inherit';

-- Check constraint on tracking_state — idempotent via guarded DO-block.
DO $$ BEGIN
  ALTER TABLE "repos"
    ADD CONSTRAINT "repos_tracking_state_check"
    CHECK ("tracking_state" IN ('inherit','included','excluded'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Partial unique index so rows missing provider_repo_id don't collide.
-- Index name matches PRD §9.9.
CREATE UNIQUE INDEX IF NOT EXISTS "repos_provider_unique"
  ON "repos" ("provider", "provider_repo_id")
  WHERE "provider_repo_id" IS NOT NULL;

-- NOT VALID constraint — does NOT scan existing rows. Validated in a
-- FOLLOW-UP migration after the backfill worker completes production scan.
-- Follow-up migration docs:
--   packages/schema/postgres/followups/0005_github_integration_g1_validate.md
-- (Deliberately NOT in custom/ so the migrate.ts loader doesn't run it
-- every migrate; operator invokes the VALIDATE step explicitly.)
DO $$ BEGIN
  ALTER TABLE "repos"
    ADD CONSTRAINT "repos_github_provider_id_required"
    CHECK ("provider" <> 'github' OR "provider_repo_id" IS NOT NULL) NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- git_events extensions. Note: `commit_sha` and `pr_number` already exist
-- on git_events (migration 0003_sprint1_git_events). We ADD the three new
-- columns and a partial index keyed on the new repo_id_hash column.
ALTER TABLE "git_events"
  ADD COLUMN IF NOT EXISTS "branch"             text        NULL,
  ADD COLUMN IF NOT EXISTS "repo_id_hash"       bytea       NULL,
  ADD COLUMN IF NOT EXISTS "author_association" text        NULL;

CREATE INDEX IF NOT EXISTS "git_events_repo_hash_idx"
  ON "git_events" ("org_id", "repo_id_hash", "received_at" DESC)
  WHERE "repo_id_hash" IS NOT NULL;

-- orgs: tracking-mode default per PRD assumption A8.
ALTER TABLE "orgs"
  ADD COLUMN IF NOT EXISTS "github_repo_tracking_mode" text NOT NULL DEFAULT 'all';

DO $$ BEGIN
  ALTER TABLE "orgs"
    ADD CONSTRAINT "orgs_github_repo_tracking_mode_check"
    CHECK ("github_repo_tracking_mode" IN ('all','selected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -------------------------------------------------------------------------
-- §9.10 RLS — enable + force + attach `org_isolation` policy on every new
-- table. Uses the same helper (`app_current_org()`) and policy name
-- (`org_isolation`) as custom/0002_rls_org_isolation.sql so INT9 probes are
-- uniform. RLS on partitioned parent propagates to PARTITION OF children
-- on Postgres 15+ (dev + prod runs PG 16 per docker-compose.dev.yml).
--
-- `session_repo_links` has no FK to orgs (partitioned parent, no inline
-- REFERENCES allowed on partition keys + FK combinations) — RLS still
-- enforces tenant_id isolation.
--
-- Grant app_bematist DML on every new table so the NOBYPASSRLS app role
-- can actually reach them when the `app.current_org_id` setting is wired.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  new_tables text[] := ARRAY[
    'github_installations',
    'github_pull_requests',
    'github_check_suites',
    'github_deployments',
    'github_code_owners',
    'session_repo_links',
    'session_repo_eligibility',
    'repo_id_hash_aliases'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY new_tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I
         USING (tenant_id = app_current_org())
         WITH CHECK (tenant_id = app_current_org())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_bematist', t);
  END LOOP;
END $$;

-- Sequence grant for github_installations.id (bigserial).
GRANT USAGE, SELECT ON SEQUENCE github_installations_id_seq TO app_bematist;

-- Partitions inherit RLS from the partitioned parent on PG 15+. Defensive
-- belt-and-suspenders: enable + force on each seeded partition too, so a
-- future PG major bump won't silently loosen enforcement. Per-partition
-- policy creation is unnecessary — policies attach to the partitioned
-- parent and PG 15+ applies them to every partition when the partition
-- is accessed through the parent OR directly.
DO $$
DECLARE
  srl_partitions text[] := ARRAY[
    'session_repo_links_2026_04',
    'session_repo_links_2026_05'
  ];
  p text;
BEGIN
  FOREACH p IN ARRAY srl_partitions
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_bematist', p);
  END LOOP;
END $$;
