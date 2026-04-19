-- B1 — github_pending_installations: holding pen for installation.created
-- webhooks whose tenant binding is not yet established.
--
-- D61 amendment (flag for PRD): this is the first global-admin-scoped table
-- in the github_* family. Unlike every other github_* table that uses
-- `tenant_id = app_current_org()` RLS, pending rows EXIST BEFORE a tenant
-- binding — by definition they cannot be filtered on tenant_id. RLS is
-- therefore keyed on a separate `users.role = 'global_admin'` check via a
-- custom setting `app.is_global_admin`. Dashboard admins running
-- `claimPendingInstallation(pendingId)` must resolve their role via Better
-- Auth and set that config var in the same txn.
--
-- Retention: pending rows older than 7 days are garbage-collected by the
-- weekly GDPR partition-drop cron (harmless to delete; GitHub re-sends
-- installation.created on any subsequent app-install webhook for the
-- same installation_id).

CREATE TABLE IF NOT EXISTS "github_pending_installations" (
  "id"                         bigserial PRIMARY KEY,
  "installation_id"            bigint      NOT NULL UNIQUE,
  "github_org_id"              bigint      NOT NULL,
  "github_org_login"           text        NOT NULL,
  "app_id"                     bigint      NOT NULL,
  "target_type"                text        NOT NULL,
  "repositories_selected_count" integer    NOT NULL DEFAULT 0,
  "received_at"                timestamptz NOT NULL DEFAULT now(),
  "claimed_at"                 timestamptz NULL,
  "claimed_by_tenant_id"       uuid        NULL REFERENCES orgs(id) ON DELETE SET NULL,
  "updated_at"                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "gh_pending_unclaimed_idx"
  ON "github_pending_installations" ("received_at" DESC)
  WHERE "claimed_at" IS NULL;

-- RLS: deny by default. Claim flow runs under a global-admin context that
-- sets `app.is_global_admin = 'true'` for the txn; other accesses see 0 rows.
ALTER TABLE "github_pending_installations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "github_pending_installations" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_admin_only" ON "github_pending_installations";
CREATE POLICY "global_admin_only" ON "github_pending_installations"
  USING (current_setting('app.is_global_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_global_admin', true) = 'true');

GRANT SELECT, INSERT, UPDATE, DELETE ON "github_pending_installations" TO app_bematist;
GRANT USAGE, SELECT ON SEQUENCE github_pending_installations_id_seq TO app_bematist;
