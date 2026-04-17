-- D1-02: team-weekly rollup for manager tiles + 2×2 view.
-- team_id comes from dev_team_dict; data lands when D1-05 adds teams + developers.team_id.
-- Until then: dictGetOrNull returns NULL; rows exist with NULL team_id.
DROP DICTIONARY IF EXISTS dev_team_dict;

CREATE DICTIONARY dev_team_dict (
  engineer_id String,
  team_id     Nullable(String)
)
PRIMARY KEY engineer_id
SOURCE(POSTGRESQL(
  port ${PG_DICT_PORT}
  host '${PG_DICT_HOST}'
  user '${PG_DICT_USER}'
  password '${PG_DICT_PASSWORD}'
  db '${PG_DICT_DB}'
  query 'SELECT stable_hash AS engineer_id, NULL::text AS team_id FROM developers'
))
LAYOUT(HASHED())
LIFETIME(MIN 300 MAX 900);

CREATE MATERIALIZED VIEW IF NOT EXISTS team_weekly_rollup
ENGINE = AggregatingMergeTree
ORDER BY (org_id, team_id, week)
PARTITION BY toYYYYMM(week)
SETTINGS allow_nullable_key = 1
POPULATE AS SELECT
  org_id,
  dictGetOrNull('dev_team_dict', 'team_id', engineer_id)  AS team_id,
  toMonday(toDate(ts, 'UTC'))                             AS week,
  sumState(input_tokens)                                  AS input_tokens_state,
  sumState(output_tokens)                                 AS output_tokens_state,
  sumState(cost_usd)                                      AS cost_usd_state,
  uniqState(session_id)                                   AS sessions_state,
  uniqState(engineer_id)                                  AS engineers_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept') AS accepted_edits_state
FROM events
GROUP BY org_id, team_id, week;
