-- 0005_policies_default_provision.sql
-- Auto-provision a default `policies` row for every new org.
--
-- Every ingest bearer check resolves the org's `policies.tier_default`; a
-- missing row returns HTTP 500 ORG_POLICY_MISSING and blocks all events
-- from the org. The row was supposed to be created by a trigger from
-- `migrations/0002_sprint1_policies.sql`, but that file is NOT in the
-- Drizzle journal and was never applied — this custom migration recovers.
--
-- Defaults per CLAUDE.md §Security Rules D7: Tier B + Tier-C opt-in off.

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

DROP TRIGGER IF EXISTS trg_orgs_insert_default_policy ON "orgs";
CREATE TRIGGER trg_orgs_insert_default_policy
  AFTER INSERT ON "orgs"
  FOR EACH ROW
  EXECUTE FUNCTION orgs_insert_default_policy();

-- Backfill any orgs that already exist without a policy row.
INSERT INTO "policies" ("org_id", "tier_c_managed_cloud_optin", "tier_default")
SELECT o.id, FALSE, 'B'
FROM "orgs" o
LEFT JOIN "policies" p ON p.org_id = o.id
WHERE p.org_id IS NULL;
