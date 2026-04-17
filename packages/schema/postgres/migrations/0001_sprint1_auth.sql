-- SPRINT1_DRAFT_NEEDS_JORGE_REVIEW
-- Creates the ingest_keys table used by apps/ingest/src/auth/verifyIngestKey.ts.
-- Bearer format: dm_<orgId>_<keyId>_<secret> → row lookup by (org_id, id) →
-- timingSafeEqual(sha256(secret), key_sha256). See contracts/02-ingest-api.md §Auth.
--
-- Jorge: please review before M1. Column names / FK cascade behaviour are
-- candidates for rename; migration will be rebased on feedback.

CREATE TABLE IF NOT EXISTS "ingest_keys" (
	"id"           text        PRIMARY KEY,            -- format: dm_<orgId>_<rand> last segment
	"org_id"       uuid        NOT NULL,
	"engineer_id"  uuid,                                -- nullable = org-wide service key
	"name"         text        NOT NULL,
	"key_sha256"   text        NOT NULL,                -- hex-encoded SHA-256 of raw secret
	"tier_default" char(1)     NOT NULL DEFAULT 'B',    -- A|B|C; overridable per-event
	"created_at"   timestamp with time zone NOT NULL DEFAULT now(),
	"revoked_at"   timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_engineer_id_developers_id_fk" FOREIGN KEY ("engineer_id") REFERENCES "public"."developers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_keys_org_idx" ON "ingest_keys" ("org_id");
--> statement-breakpoint
ALTER TABLE "ingest_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 CREATE POLICY "org_isolation" ON "ingest_keys"
   USING ("org_id"::text = current_setting('app.current_org_id', TRUE));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
