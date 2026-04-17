-- D1-02: additive columns used by repo_weekly_rollup and cluster_assignment_mv.
-- Assumed by contract 09 §MVs but missing from §events — closes the gap.
ALTER TABLE events ADD COLUMN IF NOT EXISTS repo_id_hash      Nullable(String) DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS prompt_cluster_id Nullable(String) DEFAULT NULL;
