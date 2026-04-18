-- M3 follow-up #2: per-event redaction audit side table (contract 08 §Invariant #4,
-- contract 09 §Side tables). One row per marker emitted by the ingest hot-path
-- redactor (apps/ingest/src/redact/hotpath.ts). Never carries the raw secret —
-- only (type, detector, rule, hash, field). 30-day TTL per contract 09.
--
-- Join key back to events: (org_id, client_event_id). `marker_seq` is stable
-- per (client_event_id, ordinal) so repeated redaction of the same event
-- (idempotent retry) produces identical audit rows under ReplacingMergeTree(ts).
--
-- Redis SETNX is the authoritative event-dedup gate; this table is a side
-- log and inherits its per-event dedup from the event's client_event_id.
CREATE TABLE IF NOT EXISTS redaction_audit (
  org_id               LowCardinality(String),
  client_event_id      UUID,
  session_id           String,
  marker_seq           UInt32,

  field                Enum8('prompt_text'=1, 'tool_input'=2, 'tool_output'=3, 'raw_attrs'=4),
  type                 Enum8('secret'=1, 'email'=2, 'phone'=3, 'name'=4, 'ip'=5, 'credit_card'=6, 'ssn'=7, 'url'=8, 'address'=9, 'other'=10),
  detector             Enum8('trufflehog'=1, 'gitleaks'=2, 'presidio'=3),
  rule                 LowCardinality(String),
  hash                 FixedString(16),

  tier                 Enum8('A'=1, 'B'=2, 'C'=3),
  redacted_at          DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(redacted_at)
PARTITION BY (toYYYYMM(redacted_at), cityHash64(org_id) % 16)
ORDER BY (org_id, client_event_id, marker_seq)
TTL toDateTime(redacted_at) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
