-- 0004_better_auth_tables.sql
-- M4 PR 1: Better Auth GitHub OAuth signup / signin / signout.
--
-- Decision: Option (a) from the M4 plan — Better Auth owns its own tables
-- (`better_auth_user`, `better_auth_session`, `better_auth_account`,
-- `better_auth_verification`) and we link them to `users` via a nullable
-- `better_auth_user_id` FK on `users`. Keeps the existing RLS, `developers`
-- and ingest-key schema intact; makes rollback a one-table drop.
--
-- Why option (a) over (b):
--   1. `users` already has NOT NULL `org_id` + `sso_subject` + RLS plumbing.
--      Better Auth's user table has `id text`, `email`, `name`, `image` —
--      different shape, no tenant binding. Conflating them forces either a
--      breaking schema change or awkward nullable compromises. Keeping them
--      separate is the clean split: Better Auth handles identity, `users`
--      handles tenant-scoped authorization.
--   2. Rollback is a `DROP TABLE better_auth_*` plus `ALTER TABLE users
--      DROP COLUMN better_auth_user_id, DROP COLUMN role` — our data model
--      survives.
--   3. Better Auth's `drizzleAdapter` expects its own snake_case tables by
--      default when `usePlural=false, camelCase=false`. Matching that
--      keeps the adapter config trivial; no column remapping required.
--
-- Bootstrap rule: the first user in a given `org_id` lands with `role='admin'`;
-- subsequent users default to `role='ic'`. Enforced in Better Auth
-- `databaseHooks.user.create.after` (see apps/web/lib/auth.ts). This column is
-- a safety net so `getSessionCtx` never returns undefined role.

CREATE TABLE IF NOT EXISTS "better_auth_user" (
  "id"             text        PRIMARY KEY,
  "name"           text        NOT NULL,
  "email"          text        NOT NULL UNIQUE,
  "email_verified" boolean     NOT NULL DEFAULT false,
  "image"          text,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "better_auth_session" (
  "id"         text        PRIMARY KEY,
  "user_id"    text        NOT NULL REFERENCES "better_auth_user"("id") ON DELETE CASCADE,
  "token"      text        NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "better_auth_session_user_id_idx"
  ON "better_auth_session" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "better_auth_session_token_idx"
  ON "better_auth_session" ("token");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "better_auth_account" (
  "id"                        text        PRIMARY KEY,
  "user_id"                   text        NOT NULL REFERENCES "better_auth_user"("id") ON DELETE CASCADE,
  "account_id"                text        NOT NULL,
  "provider_id"               text        NOT NULL,
  "access_token"              text,
  "refresh_token"             text,
  "id_token"                  text,
  "access_token_expires_at"   timestamp with time zone,
  "refresh_token_expires_at"  timestamp with time zone,
  "scope"                     text,
  "password"                  text,
  "created_at"                timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "better_auth_account_provider_account_uniq"
  ON "better_auth_account" ("provider_id", "account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "better_auth_account_user_id_idx"
  ON "better_auth_account" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "better_auth_verification" (
  "id"         text        PRIMARY KEY,
  "identifier" text        NOT NULL,
  "value"      text        NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "better_auth_verification_identifier_idx"
  ON "better_auth_verification" ("identifier");
--> statement-breakpoint

-- Bridge: link our internal `users` row (org_id-scoped, RLS-enabled) to the
-- Better Auth identity. Nullable so existing seeded users (no Better Auth
-- row yet) still work; the Better Auth `databaseHooks.user.create.after`
-- back-fills it on first OAuth callback.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "better_auth_user_id" text UNIQUE;
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'ic';
--> statement-breakpoint

-- Constraint name would need a DO block on existing tables to be idempotent
-- across re-runs; use IF NOT EXISTS-equivalent via a pg_catalog check.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_better_auth_user_id_fk'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_better_auth_user_id_fk"
      FOREIGN KEY ("better_auth_user_id")
      REFERENCES "better_auth_user"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_better_auth_user_id_idx"
  ON "users" ("better_auth_user_id");
