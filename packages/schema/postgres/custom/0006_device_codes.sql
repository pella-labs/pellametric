-- 0006_device_codes.sql
-- Backs the OAuth 2.0 Device Authorization Grant (RFC 8628) flow used by
-- `bematist login`. The CLI creates a row, the user visits /auth/device and
-- approves it with their signed-in session, and the CLI polls until the row
-- carries an ingest-key id it can resolve to a plaintext bearer.
--
-- The `device_code` plaintext is returned exactly once in the /code response
-- and never stored — only its SHA-256 lives in `device_code_hash`, mirroring
-- how `ingest_keys.key_sha256` is handled. The short `user_code` (8 chars,
-- ABCD-1234 shape) is stored in cleartext because it's the thing the human
-- visually confirms in their browser; 32^8 ≈ 1.1e12 entropy combined with
-- 10-min TTL makes active collisions vanishingly rare.
--
-- Privacy / security:
--   * `device_code_hash` column is SHA-256(plaintext); plaintext never lands.
--   * Rows auto-expire via `expires_at` (10 min default — RFC 8628 §3.2
--     suggests 5-15 min). A nightly worker purges rows where
--     `expires_at < now() - interval '1 day'` so stale metadata doesn't
--     accumulate.
--   * RLS is NOT enabled on this table. The security property is "only the
--     holder of the 256-bit device_code plaintext can poll the row"; there
--     is no cross-tenant read path to protect because the row isn't tenant-
--     scoped until approval lands. Admins can still see approved rows for
--     their own org via the approved `ingest_key_id` FK.
--
-- One-shot claim semantics: `claimed_at` flips from NULL to a timestamp the
-- first time the CLI successfully polls an approved row. Subsequent polls
-- return "denied" so a leaked poll response can't be re-used.
--
-- Rollback = `DROP TABLE device_codes;` — no dependent views or FKs point
-- at this table from elsewhere.

CREATE TABLE IF NOT EXISTS "device_codes" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_code_hash"  text NOT NULL,
  "user_code"         text NOT NULL,
  "user_id"           uuid REFERENCES "users"("id")       ON DELETE SET NULL,
  "org_id"            uuid REFERENCES "orgs"("id")        ON DELETE CASCADE,
  "ingest_key_id"     text REFERENCES "ingest_keys"("id") ON DELETE SET NULL,
  "approved_at"       timestamp with time zone,
  "denied_at"         timestamp with time zone,
  "claimed_at"        timestamp with time zone,
  "expires_at"        timestamp with time zone NOT NULL,
  "user_agent"        text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now()
);

-- Hash is the primary lookup key on poll. Must be unique across all time
-- (collisions across unclaimed TTL windows are astronomically improbable at
-- 256 bits but the constraint makes "never duplicate a hash" explicit).
CREATE UNIQUE INDEX IF NOT EXISTS "device_codes_device_code_hash_idx"
  ON "device_codes" ("device_code_hash");

-- The approve page resolves by user_code. We query
--   WHERE user_code = $1 AND denied_at IS NULL AND claimed_at IS NULL
--         AND expires_at > now()
-- so a partial unique index on "active" rows enforces the human-facing
-- invariant (no two outstanding codes share the same display string) while
-- allowing cleanup jobs to purge historical rows without violating it.
CREATE UNIQUE INDEX IF NOT EXISTS "device_codes_user_code_active_idx"
  ON "device_codes" ("user_code")
  WHERE "claimed_at" IS NULL AND "denied_at" IS NULL;

-- Sweep index for the nightly cleanup worker.
CREATE INDEX IF NOT EXISTS "device_codes_expires_at_idx"
  ON "device_codes" ("expires_at");

-- Keep updated_at fresh on any row mutation (approve / deny / claim).
CREATE OR REPLACE FUNCTION device_codes_set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updated_at" = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_codes_updated_at ON "device_codes";
CREATE TRIGGER trg_device_codes_updated_at
  BEFORE UPDATE ON "device_codes"
  FOR EACH ROW
  EXECUTE FUNCTION device_codes_set_updated_at();

-- Grant app role write access (RLS is off on this table; app writes directly).
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE ON "device_codes" TO app_bematist;
EXCEPTION WHEN undefined_object THEN
  -- app_bematist role only exists in environments where 0002_rls_org_isolation
  -- has been applied. Dev-mode Postgres without that role is a no-op.
  NULL;
END $$;
