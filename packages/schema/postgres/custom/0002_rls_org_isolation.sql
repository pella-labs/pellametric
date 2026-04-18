-- D1-06: Row-Level Security on every org-scoped table.
-- Contract 09 invariant 4: RLS on every org-scoped Postgres table; cross-tenant
-- probe (INT9) = 0 rows. CLAUDE.md Security Rules: app code MUST NOT bypass RLS
-- without explicit SET ROLE.
--
-- Strategy:
--   1. Create `app_bematist` role (NOBYPASSRLS, NOSUPERUSER) for application
--      connections. Migrations still run as postgres (superuser — bypasses RLS).
--   2. ENABLE + FORCE RLS on every org-scoped table.
--   3. Attach `org_isolation` policy using `app_current_org()`.
--   4. Grant SELECT/INSERT/UPDATE/DELETE on all tables to app_bematist.
--
-- Not enabled on:
--   - `orgs` (it IS the tenant table, no row-level filtering needed)
--   - `embedding_cache` (shared by design per contract 05 — cache key is content-hashed)

-- App role
DO $$ BEGIN
  CREATE ROLE app_bematist NOBYPASSRLS NOSUPERUSER LOGIN PASSWORD 'app_bematist_dev';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO app_bematist;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_bematist;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_bematist;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_bematist;

-- Helper: returns the current org_id setting or NULL if unset.
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

-- Enable + force + policy per table. Most use `org_id` column;
-- `erasure_requests` uses `target_org_id`.
DO $$
DECLARE
  t text;
  col text;
  org_tables text[][] := ARRAY[
    ARRAY['users',           'org_id'],
    ARRAY['teams',           'org_id'],
    ARRAY['developers',      'org_id'],
    ARRAY['repos',           'org_id'],
    ARRAY['policies',        'org_id'],
    ARRAY['git_events',      'org_id'],
    ARRAY['ingest_keys',     'org_id'],
    ARRAY['prompt_clusters', 'org_id'],
    ARRAY['playbooks',       'org_id'],
    ARRAY['audit_log',       'org_id'],
    ARRAY['audit_events',    'org_id'],
    ARRAY['erasure_requests','target_org_id'],
    ARRAY['alerts',          'org_id'],
    ARRAY['insights',        'org_id'],
    ARRAY['outcomes',        'org_id']
  ];
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY org_tables
  LOOP
    t := pair[1];
    col := pair[2];
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (%I = app_current_org())', t, col);
  END LOOP;
END $$;
