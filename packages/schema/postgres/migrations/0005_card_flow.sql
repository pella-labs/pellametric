-- 0005_card_flow.sql
-- /card flow migration from Firebase (Firestore) to Better Auth (Postgres).
--
-- Two tables replace two Firestore collections:
--   api_tokens (Firestore) → card_tokens (Postgres)
--     One-shot, 1h-TTL bearer tokens minted by /api/card/token (signed-in
--     OAuth) or /api/card/token-by-star (public-star-gated). The CLI
--     (grammata) trades a token at /api/card/submit for a permanent card URL.
--     subject_kind distinguishes "better_auth_user" (OAuth) from
--     "github_star" (star-gate, subject_id = 'gh_<login>').
--     Single-use is enforced atomically via
--       UPDATE card_tokens SET used_at=now() WHERE token_hash=$1
--         AND used_at IS NULL AND expires_at > now() RETURNING ...
--     — one DB round-trip, no read-then-write race.
--
--   cards (Firestore) → cards (Postgres)
--     Permanent public artifacts; card_id = subject_id of the token that
--     minted them. Stats are stored as jsonb (~30KB each; grammata's
--     UsageSummary shape is validated by the strict zod schema at
--     /api/card/submit before insert). Display metadata (name, avatar,
--     github_username) is denormalized on the row so the public render
--     doesn't need a join into Better Auth — and so deleting the Better
--     Auth user doesn't break an already-shared card URL.
--
-- Rollback: DROP TABLE cards; DROP TABLE card_tokens. No other tables
-- reference these (owner_user_id is ON DELETE SET NULL).

CREATE TABLE IF NOT EXISTS "card_tokens" (
  "token_hash"      text        PRIMARY KEY,
  "subject_kind"    text        NOT NULL,
  "subject_id"      text        NOT NULL,
  "github_username" text,
  "expires_at"      timestamp with time zone NOT NULL,
  "used_at"         timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "card_tokens_subject_idx"
  ON "card_tokens" ("subject_kind", "subject_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cards" (
  "card_id"          text        PRIMARY KEY,
  "owner_user_id"    text        REFERENCES "better_auth_user"("id") ON DELETE SET NULL,
  "github_username"  text,
  "display_name"     text,
  "avatar_url"       text,
  "stats"            jsonb       NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cards_owner_user_id_idx"
  ON "cards" ("owner_user_id");
