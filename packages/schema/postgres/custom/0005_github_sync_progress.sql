-- PRD §13 Phase G1 Step 2b — initial-repo-sync progress tracking.
--
-- One row per (tenant_id, installation_id). The initial-sync worker writes
-- here so the admin UI can render `{total_repos, fetched_repos, eta_seconds,
-- started_at, completed_at}`. Resumability: `next_page_cursor` carries the
-- next GitHub pagination URL so a killed worker can pick up mid-sync.
--
-- RLS follows the same org_isolation convention as custom/0004.
-- Idempotent — safe to re-run.
--
-- Rollback: no .down.sql — this table is green-field; dropping the feature
-- means DROP TABLE IF EXISTS. Kept simple on purpose.

CREATE TABLE IF NOT EXISTS "github_sync_progress" (
  "tenant_id"          uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "installation_id"    bigint      NOT NULL,
  "status"             text        NOT NULL
                         CHECK (status IN ('queued','running','completed','failed','cancelled')),
  "total_repos"        integer     NULL,
  "fetched_repos"      integer     NOT NULL DEFAULT 0,
  "pages_fetched"      integer     NOT NULL DEFAULT 0,
  "next_page_cursor"   text        NULL,
  "started_at"         timestamptz NULL,
  "completed_at"       timestamptz NULL,
  "last_progress_at"   timestamptz NOT NULL DEFAULT now(),
  "last_error"         text        NULL,
  "retry_count"        integer     NOT NULL DEFAULT 0,
  "requested_by"       uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, installation_id)
);

CREATE INDEX IF NOT EXISTS "gh_sync_status_idx"
  ON "github_sync_progress" ("status", "last_progress_at" DESC);

-- RLS + org_isolation policy + app_bematist grants.
ALTER TABLE "github_sync_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "github_sync_progress" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON "github_sync_progress";
CREATE POLICY org_isolation ON "github_sync_progress"
  USING (tenant_id = app_current_org())
  WITH CHECK (tenant_id = app_current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON "github_sync_progress" TO app_bematist;
