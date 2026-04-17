-- D1-02: session→cluster mapping. Populated by H's nightly cluster job (Sprint 2).
-- Name retained per contract 09 though this is a plain table, not a CH MV.
CREATE TABLE IF NOT EXISTS cluster_assignment_mv (
  org_id        LowCardinality(String),
  session_id    String,
  prompt_index  UInt32,
  cluster_id    String,
  ts            DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(ts)
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, session_id, prompt_index);
