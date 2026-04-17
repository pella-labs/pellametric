CREATE TABLE events (
  client_event_id TEXT PRIMARY KEY,
  body_json       TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,
  submitted_at    TEXT,
  last_error      TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX events_pending_idx ON events(submitted_at) WHERE submitted_at IS NULL;

CREATE TABLE cursors (
  adapter_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (adapter_id, key)
) STRICT;

CREATE TABLE redaction_counts (
  run_id       TEXT NOT NULL,
  marker_type  TEXT NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (run_id, marker_type)
) STRICT;

CREATE TABLE pinned_certs (
  host        TEXT PRIMARY KEY,
  cert_sha256 TEXT NOT NULL,
  pinned_at   TEXT NOT NULL
) STRICT;

CREATE TABLE clio_embeddings (
  abstract_sha256 TEXT PRIMARY KEY,
  embedding_json  TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  created_at      TEXT NOT NULL
) STRICT;
