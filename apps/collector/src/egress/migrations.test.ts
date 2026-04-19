import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "./migrations";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-migrations-"));
  dbPath = join(dir, "test.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("migrate() creates all tables on empty db", () => {
  const db = new Database(dbPath);
  try {
    migrate(db);
    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(names).toContain("events");
    expect(names).toContain("cursors");
    expect(names).toContain("redaction_counts");
    expect(names).toContain("pinned_certs");
    expect(names).toContain("clio_embeddings");
    expect(names).toContain("schema_migrations");
  } finally {
    db.close();
  }
});

test("migrate() enables WAL mode", () => {
  const db = new Database(dbPath);
  try {
    migrate(db);
    const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    expect(mode?.journal_mode.toLowerCase()).toBe("wal");
  } finally {
    db.close();
  }
});

test("inlined migration bodies match the on-disk .sql files", () => {
  // The inlined strings in migrations.ts exist so `bun build --compile`
  // produces a binary that doesn't need the .sql files at runtime. They
  // MUST stay in lockstep with the on-disk SQL — this test is the lock.
  const onDiskFiles = ["001_initial.sql", "002_dead_letter.sql"];
  const dbFromFile = new Database(join(dir, "file.sqlite"));
  try {
    for (const f of onDiskFiles) {
      const sql = readFileSync(join(import.meta.dir, "migrations", f), "utf8");
      dbFromFile.exec(sql);
    }
    const onDiskSchema = dbFromFile
      .query<{ sql: string | null }, []>(
        "SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL ORDER BY name",
      )
      .all()
      .map((r) => r.sql ?? "")
      .join("\n");

    const dbFromMigrate = new Database(join(dir, "migrate.sqlite"));
    try {
      migrate(dbFromMigrate);
      const migrateSchema = dbFromMigrate
        .query<{ sql: string | null }, []>(
          "SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL AND name != 'schema_migrations' ORDER BY name",
        )
        .all()
        .map((r) => r.sql ?? "")
        .join("\n");
      expect(migrateSchema).toBe(onDiskSchema);
    } finally {
      dbFromMigrate.close();
    }
  } finally {
    dbFromFile.close();
  }
});

test("migrate() is idempotent", () => {
  const db = new Database(dbPath);
  try {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    const rows = db
      .query<{ version: number }, []>("SELECT version FROM schema_migrations ORDER BY version")
      .all();
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  } finally {
    db.close();
  }
});
