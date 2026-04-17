-- D1-02: per-repo weekly rollup for repo pages + outcome attribution.
-- Only counts events with repo_id_hash (those with no repo attribution fall out).
CREATE MATERIALIZED VIEW IF NOT EXISTS repo_weekly_rollup
ENGINE = AggregatingMergeTree
ORDER BY (org_id, repo_id_hash, week)
PARTITION BY toYYYYMM(week)
SETTINGS allow_nullable_key = 1
POPULATE AS SELECT
  org_id,
  repo_id_hash,
  toMonday(toDate(ts, 'UTC'))                             AS week,
  sumState(input_tokens)                                  AS input_tokens_state,
  sumState(output_tokens)                                 AS output_tokens_state,
  sumState(cost_usd)                                      AS cost_usd_state,
  uniqState(session_id)                                   AS sessions_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept') AS accepted_edits_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept' AND revert_within_24h = 0) AS accepted_retained_edits_state,
  uniqStateIf(commit_sha, commit_sha IS NOT NULL)         AS commits_state,
  uniqStateIf(pr_number, pr_number IS NOT NULL)           AS prs_state
FROM events
WHERE repo_id_hash IS NOT NULL
GROUP BY org_id, repo_id_hash, week;
