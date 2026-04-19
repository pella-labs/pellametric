-- -------------------------------------------------------------------------
-- M1 — repos.full_name column + text-pattern index
-- -------------------------------------------------------------------------
-- Why: the admin UI + search path at `/admin/github/repos` needs a
--      human-readable identifier for a repo (e.g. "acme/widget"). Prior
--      code relied on `provider_repo_id` (a numeric string) which made
--      the admin search surface impossible to use. The existing
--      `repo_id_hash` is internal / HMAC and never search-exposed.
--
-- Wire-up: populated by initial sync (`GET /installation/repositories`)
-- and kept in-sync on `repository.renamed` / `repository.transferred`
-- webhooks. Nullable — a repo that predates M1 has NULL and falls back
-- to `provider_repo_id` in the UI until a webhook or sync refresh
-- populates it.
-- -------------------------------------------------------------------------

ALTER TABLE "repos"
  ADD COLUMN IF NOT EXISTS "full_name" text NULL;

-- Text-pattern index so `full_name ILIKE 'acme/%'` can use the index.
-- `text_pattern_ops` is the canonical choice for leading-anchor LIKE /
-- ILIKE prefix scans; trailing-% queries still fall back to seq scan,
-- which is acceptable at our repo cardinality (<100k per tenant).
CREATE INDEX IF NOT EXISTS "repos_full_name_pattern_idx"
  ON "repos" (lower("full_name") text_pattern_ops)
  WHERE "full_name" IS NOT NULL;
