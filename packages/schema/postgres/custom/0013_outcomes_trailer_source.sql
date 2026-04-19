-- -------------------------------------------------------------------------
-- D29 — outcomes.trailer_source + UNIQUE(org, commit_sha, session_id)
-- -------------------------------------------------------------------------
-- Why: the GitHub webhook + reconcile cron now parse the opt-in
--   `AI-Assisted: bematist-<sessionId>` commit trailer (CLAUDE.md §Outcome
--   Attribution, Layer 2) and write outcome rows joining the session to the
--   landed commit / merged PR. Three things are needed at the DB layer:
--
--     1. A `trailer_source` column so dashboards can distinguish a row that
--        came from a live `push` webhook vs. a `pull_request.closed`
--        webhook vs. the daily reconcile cron (catch-all for missed
--        deliveries). Nullable because pre-D29 rows are Layer-1
--        (code_edit_tool.decision=accept) attribution and carry no source.
--        Constraint limits new writes to the three known values.
--
--     2. A composite UNIQUE(org_id, commit_sha, COALESCE(session_id, ''))
--        constraint so the webhook handler's `INSERT ... ON CONFLICT DO
--        NOTHING` is an atomic idempotency gate. The COALESCE form lets
--        legacy Layer-1 rows (session_id NULL) coexist without collision
--        against Layer-2 rows (session_id set) on the same commit.
--
--     3. An `(org_id, session_id)` index so the manager dashboard's
--        session-detail page can pivot from `/me/sessions/<id>` straight
--        to "did this session land?" without a full scan.
--
-- Forward-compatible: everything is additive. Existing rows retain
-- `trailer_source = NULL` and the UNIQUE constraint allows at most one
-- legacy (session_id NULL) row per (org, commit_sha) — which is what the
-- pre-D29 code already did implicitly via app-level dedup.
--
-- Rollback: drop the index + unique constraint + column. Preserve data.
-- -------------------------------------------------------------------------

ALTER TABLE "outcomes"
  ADD COLUMN IF NOT EXISTS "trailer_source" text NULL;

-- D29: trailer-derived outcome rows arrive BEFORE the worker has resolved
-- `commit.author.email` → engineer_id via Better Auth + the email→engineer
-- mapping table. The original DDL marked engineer_id NOT NULL; loosen it
-- to NULL-permitted so ingest can record the landed commit / merged PR
-- immediately and the worker backfills engineer_id asynchronously via
-- weekly batched reconciliation. NULL is semantically equivalent to
-- "unresolved contributor" — dashboards render "anonymous" for these.
ALTER TABLE "outcomes"
  ALTER COLUMN "engineer_id" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "outcomes"
    ADD CONSTRAINT "outcomes_trailer_source_check"
    CHECK (trailer_source IS NULL OR trailer_source IN ('push', 'pull_request', 'reconcile'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Partial-unique index (rather than a table-level UNIQUE constraint) so the
-- COALESCE expression can be used. Postgres requires a functional unique
-- index for expression-based uniqueness — a plain UNIQUE(col, col, expr) is
-- not valid syntax.
CREATE UNIQUE INDEX IF NOT EXISTS "outcomes_org_commit_session_uidx"
  ON "outcomes" ("org_id", "commit_sha", (COALESCE("session_id", '')));

CREATE INDEX IF NOT EXISTS "outcomes_org_session_idx"
  ON "outcomes" ("org_id", "session_id")
  WHERE "session_id" IS NOT NULL;
