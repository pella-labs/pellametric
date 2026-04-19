import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Inlined migration bodies — duplicated from the .sql files so the
// `bun build --compile` binary (which doesn't bundle non-code assets)
// still works without filesystem-relative reads. The .sql files remain
// the authoritative source during `bun run` / `bun test`, and the inlined
// strings below are verified identical in migrations.test.ts.
const INLINED_MIGRATIONS: Record<string, string> = {
  "001_initial.sql": `CREATE TABLE events (
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
`,
  "002_dead_letter.sql": `-- Dead-letter + cooling state for the egress journal.
--
-- Bug #1/#15/#16 — poison-pill queue stall. Before this migration,
-- \`markFailed\` only bumped \`retry_count\`; rows with permanent server
-- rejects (400, 413, 207 per-row rejects) stayed re-selectable via
-- \`selectPending\` forever and blocked every newer event behind them.
--
-- New state model:
--   pending     — ready to be selected on next flush (default)
--   submitted   — successfully accepted by ingest; kept for audit until prune
--   dead_letter — permanent failure OR retry cap reached; never reselected
--   cooling    — transient failure; reselect after next_attempt_at
--
-- \`next_attempt_at\` is an ISO-8601 timestamp used by selectPending's WHERE
-- clause to gate cooling rows until the backoff elapses.

ALTER TABLE events ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'
  CHECK(state IN ('pending','submitted','dead_letter','cooling'));
ALTER TABLE events ADD COLUMN next_attempt_at TEXT;

-- Backfill pre-existing rows: anything with submitted_at set is 'submitted'.
UPDATE events SET state = 'submitted' WHERE submitted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_state_next ON events(state, next_attempt_at);
`,
};

const MIGRATIONS: ReadonlyArray<{ version: number; file: string }> = [
  { version: 1, file: "001_initial.sql" },
  { version: 2, file: "002_dead_letter.sql" },
];

function loadMigrationSql(file: string): string {
  // Prefer the on-disk .sql file when it exists (dev / test). Fall back to
  // the inlined string when running as a compiled binary where migrations/
  // is not part of the asset bundle.
  const path = join(import.meta.dir, "migrations", file);
  if (existsSync(path)) {
    return readFileSync(path, "utf8");
  }
  const inlined = INLINED_MIGRATIONS[file];
  if (!inlined) throw new Error(`missing migration: ${file}`);
  return inlined;
}

export function migrate(db: Database): void {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = new Set(
    db
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((r) => r.version),
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const sql = loadMigrationSql(m.file);
    db.transaction(() => {
      db.exec(sql);
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        new Date().toISOString(),
      ]);
    })();
  }
}
