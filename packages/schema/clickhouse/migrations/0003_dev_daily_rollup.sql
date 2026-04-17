-- D1-02: per-engineer daily aggregates. Scoring input.
-- UTC buckets per design D2; per-org TZ at read time (E's concern).
CREATE MATERIALIZED VIEW IF NOT EXISTS dev_daily_rollup
ENGINE = AggregatingMergeTree
ORDER BY (org_id, engineer_id, day)
PARTITION BY toYYYYMM(day)
POPULATE AS SELECT
  org_id,
  engineer_id,
  toDate(ts, 'UTC')                                       AS day,
  sumState(input_tokens)                                  AS input_tokens_state,
  sumState(output_tokens)                                 AS output_tokens_state,
  sumState(cost_usd)                                      AS cost_usd_state,
  uniqState(session_id)                                   AS sessions_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept') AS accepted_edits_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept' AND revert_within_24h = 0) AS accepted_retained_edits_state,
  minState(ts)                                            AS first_ts_state,
  maxState(ts)                                            AS last_ts_state
FROM events
GROUP BY org_id, engineer_id, day;
