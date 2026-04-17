-- D1-02: per-cluster weekly stats. Triggers on INSERT into cluster_assignment_mv.
-- JOINs back to events for cost/duration. Empty until H's nightly cluster job runs.
CREATE MATERIALIZED VIEW IF NOT EXISTS prompt_cluster_stats
ENGINE = AggregatingMergeTree
ORDER BY (org_id, cluster_id, week)
PARTITION BY toYYYYMM(week)
POPULATE AS SELECT
  a.org_id                                                AS org_id,
  a.cluster_id                                            AS cluster_id,
  toMonday(toDate(a.ts, 'UTC'))                           AS week,
  sumState(toUInt64(1))                                   AS prompt_count_state,
  uniqState(e.engineer_id)                                AS contributing_engineers_state,
  sumState(e.cost_usd)                                    AS cost_usd_state,
  avgState(e.duration_ms)                                 AS avg_duration_state
FROM cluster_assignment_mv AS a
LEFT JOIN events AS e USING (org_id, session_id, prompt_index)
GROUP BY a.org_id, a.cluster_id, week;
