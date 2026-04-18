-- M3 perf: session_lookup projection on events.
--
-- Covers:
--   1. `getSession` real-branch — filter by (org_id, session_id) for detail view.
--   2. `listSessions` real-branch — GROUP BY session_id is cheaper when rows
--      for each session are already co-located on disk.
--
-- Additive — does not change the primary ORDER BY (contract 09 invariant 1).
-- Paired with 0008/0009 pattern: projection stores a sorted copy; CH optimizer
-- picks it when the query's filter/group pattern matches better than the base
-- ORDER BY (org_id, ts, engineer_id).
--
-- deduplicate_merge_projection_mode is already set to 'rebuild' by migration
-- 0008; we inherit that setting (the session projection has the same RMT
-- safety requirement).
ALTER TABLE events ADD PROJECTION IF NOT EXISTS session_lookup (
  SELECT *
  ORDER BY (org_id, session_id, ts)
);
ALTER TABLE events MATERIALIZE PROJECTION session_lookup;
