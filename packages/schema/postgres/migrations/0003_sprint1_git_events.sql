-- SPRINT1_DRAFT_NEEDS_JORGE_REVIEW
-- Creates the `git_events` table populated by apps/ingest/src/webhooks/router.ts
-- (GitHub/GitLab/Bitbucket webhooks) and apps/ingest/src/github-app/reconcile.ts
-- (daily PR reconciliation cron). Per D-S1-17, `pr_node_id` UNIQUE is the
-- second dedup layer — transport dedup on `X-GitHub-Delivery` via Redis SETNX
-- is the first. Push / workflow_run rows have `pr_node_id=NULL` and bypass the
-- unique constraint (NULLs are not "equal" in standard SQL).
--
-- Also extends the `policies` table with `webhook_secrets` (jsonb map of
-- source→shared-secret) and `webhook_source_ip_allowlist` (jsonb string array
-- for the GitLab plaintext-token IP check).
--
-- Jorge: please review before M1. Specific asks:
--   1. Column names match the in-memory `GitEventRow` shape — rename freely.
--   2. Should `payload` be compressed (`jsonb` is already TOAST-compressed but
--      explicit `SET STORAGE EXTERNAL` may help query patterns)?
--   3. `pr_node_id` UNIQUE is currently global; should it be scoped per-org
--      to tolerate cross-tenant PR node-id collisions? GitHub node IDs are
--      globally unique so this is moot for github, but GitLab numeric IDs are
--      per-project and could collide across tenants. Proposal: compound
--      UNIQUE (org_id, source, pr_node_id).

-- policies additions ---------------------------------------------------------
ALTER TABLE "policies"
  ADD COLUMN IF NOT EXISTS "webhook_secrets" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "policies"
  ADD COLUMN IF NOT EXISTS "webhook_source_ip_allowlist" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- git_events -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "git_events" (
	"id"          uuid                      PRIMARY KEY DEFAULT gen_random_uuid(),
	"org_id"      uuid                      NOT NULL,
	"source"      text                      NOT NULL,
	"event_kind"  text                      NOT NULL,
	"pr_node_id"  text,
	"repo_id"     text                      NOT NULL,
	"pr_number"   integer,
	"commit_sha"  text,
	"merged_at"   timestamp with time zone,
	"payload"     jsonb                     NOT NULL,
	"received_at" timestamp with time zone  NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "git_events" ADD CONSTRAINT "git_events_org_id_orgs_id_fk"
   FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "git_events" ADD CONSTRAINT "git_events_source_check"
   CHECK ("source" IN ('github','gitlab','bitbucket'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "git_events_pr_node_id_key" ON "git_events" ("pr_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_events_org_idx" ON "git_events" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_events_repo_idx" ON "git_events" ("repo_id");
--> statement-breakpoint
ALTER TABLE "git_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 CREATE POLICY "org_isolation" ON "git_events"
   USING ("org_id"::text = current_setting('app.current_org_id', TRUE));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
