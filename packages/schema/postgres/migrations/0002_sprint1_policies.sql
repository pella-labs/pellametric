-- SPRINT1_DRAFT_NEEDS_JORGE_REVIEW
-- Creates the `policies` table used by apps/ingest/src/tier/enforceTier.ts
-- and the `orgs_insert_default_policy()` trigger that auto-inserts a default
-- (Tier B, tier_c_managed_cloud_optin=false) policy row for every new org.
--
-- Contract source: contracts/08-redaction.md §Per-org rule overrides +
-- PRD Sprint-1 Phase-2 F.3 ("orgs insert trigger fires and produces matching
-- policies row"). Works-council default per CLAUDE.md §Security Rules (Tier B
-- is the default — Tier C requires explicit opt-in per D7 + D20).
--
-- Jorge: please review before M1. RLS policy needs confirmation (does
-- `current_setting('app.current_org_id')` cover the ingest read path? If we go
-- read-side JWT claim instead, revisit.

CREATE TABLE IF NOT EXISTS "policies" (
	"org_id"                       uuid        PRIMARY KEY,
	"tier_c_managed_cloud_optin"   boolean     NOT NULL DEFAULT FALSE,
	"tier_default"                 char(1)     NOT NULL DEFAULT 'B',
	"raw_attrs_allowlist_extra"    jsonb       NOT NULL DEFAULT '[]'::jsonb,
	"presidio_recognizers_extra"   jsonb       NOT NULL DEFAULT '[]'::jsonb,
	"trufflehog_rules_disabled"    jsonb       NOT NULL DEFAULT '[]'::jsonb,
	"created_at"                   timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at"                   timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policies" ADD CONSTRAINT "policies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policies" ADD CONSTRAINT "policies_tier_default_check" CHECK ("tier_default" IN ('A','B','C'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 CREATE POLICY "org_isolation" ON "policies"
   USING ("org_id"::text = current_setting('app.current_org_id', TRUE));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Auto-provision a default policy row for every newly inserted orgs row.
-- Default matches CLAUDE.md §Security Rules D7: Tier B + Tier-C opt-in off.
CREATE OR REPLACE FUNCTION orgs_insert_default_policy() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "policies" (
		"org_id",
		"tier_c_managed_cloud_optin",
		"tier_default"
	) VALUES (
		NEW."id",
		FALSE,
		'B'
	)
	ON CONFLICT ("org_id") DO NOTHING;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TRIGGER trg_orgs_insert_default_policy
   AFTER INSERT ON "orgs"
   FOR EACH ROW
   EXECUTE FUNCTION orgs_insert_default_policy();
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
