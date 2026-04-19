-- PRD §13 Phase G0 — minimal stub for the `github_installations` table.
--
-- The full canonical DDL (with webhook-secret rotation columns, app_id FK,
-- status CHECK, RLS policy, indexes) lands in G1 per PRD §9.1. This stub is
-- intentionally minimal: it exists only to satisfy the G0 boot-fail-closed
-- probe (`BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING`, see
-- apps/ingest/src/github-app/bootCheck.ts) so the ingest process doesn't
-- refuse to start before G1 has authored the full Drizzle migration.
--
-- Idempotent — safe to re-run; G1's Drizzle migration runs BEFORE this file
-- on any fresh install because drizzle migrations apply first and the custom
-- folder adds idempotent supplements. If G1's table already exists with more
-- columns, `CREATE TABLE IF NOT EXISTS` is a no-op.
--
-- This stub is removed in G1 once the authoritative table ships.

CREATE TABLE IF NOT EXISTS "github_installations" (
  "id"              bigserial                 PRIMARY KEY,
  "tenant_id"       uuid                      NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  "installation_id" bigint                    NOT NULL,
  "created_at"      timestamp with time zone  NOT NULL DEFAULT now()
);

-- Index for the hourly reconciliation worker's per-tenant query.
CREATE INDEX IF NOT EXISTS "github_installations_tenant_idx"
  ON "github_installations"("tenant_id");

-- Unique per-tenant installation pairing. The global-unique constraint comes
-- with the full DDL in G1 (GitHub installation_ids are globally unique but
-- that invariant belongs with the full schema).
CREATE UNIQUE INDEX IF NOT EXISTS "github_installations_tenant_install_uniq"
  ON "github_installations"("tenant_id", "installation_id");

-- RLS — org isolation, matching the pattern on every other control-plane table.
ALTER TABLE "github_installations" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "org_isolation" ON "github_installations"
    USING ("tenant_id"::text = current_setting('app.current_org_id', TRUE));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
