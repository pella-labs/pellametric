-- Phase 1 (T1.13): GIN index on pr_commit.ai_sources, which drizzle-kit cannot express.
-- Run once after `bun run db:push`.
CREATE INDEX IF NOT EXISTS pr_commit_ai_sources_gin
  ON pr_commit USING gin (ai_sources);
