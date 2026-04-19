-- Dead-letter + cooling state for the egress journal.
--
-- Bug #1/#15/#16 — poison-pill queue stall. Before this migration,
-- `markFailed` only bumped `retry_count`; rows with permanent server
-- rejects (400, 413, 207 per-row rejects) stayed re-selectable via
-- `selectPending` forever and blocked every newer event behind them.
--
-- New state model:
--   pending     — ready to be selected on next flush (default)
--   submitted   — successfully accepted by ingest; kept for audit until prune
--   dead_letter — permanent failure OR retry cap reached; never reselected
--   cooling    — transient failure; reselect after next_attempt_at
--
-- `next_attempt_at` is an ISO-8601 timestamp used by selectPending's WHERE
-- clause to gate cooling rows until the backoff elapses.

ALTER TABLE events ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'
  CHECK(state IN ('pending','submitted','dead_letter','cooling'));
ALTER TABLE events ADD COLUMN next_attempt_at TEXT;

-- Backfill pre-existing rows: anything with submitted_at set is 'submitted'.
UPDATE events SET state = 'submitted' WHERE submitted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_state_next ON events(state, next_attempt_at);
