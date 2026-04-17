import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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

test("migrate() is idempotent", () => {
  const db = new Database(dbPath);
  try {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    const rows = db.query<{ version: number }, []>("SELECT version FROM schema_migrations").all();
    expect(rows.length).toBe(1);
    expect(rows[0]?.version).toBe(1);
  } finally {
    db.close();
  }
});
