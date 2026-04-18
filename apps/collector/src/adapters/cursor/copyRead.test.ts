import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReadOnlyCopy } from "./copyRead";

function makeDb(dir: string): string {
  const p = join(dir, "state.vscdb");
  const db = new Database(p, { create: true });
  db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["k", "v"]);
  db.close();
  return p;
}

test("openReadOnlyCopy throws on missing source", () => {
  expect(() => openReadOnlyCopy("/does/not/exist/state.vscdb")).toThrow();
});

test("openReadOnlyCopy returns a readable DB against a copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-copy-"));
  try {
    const src = makeDb(dir);
    const { db, tempDir, cleanup } = openReadOnlyCopy(src);
    try {
      const row = db
        .query<{ value: string }, [string]>("SELECT value FROM ItemTable WHERE key = ?")
        .get("k");
      expect(row?.value).toBe("v");
      expect(existsSync(tempDir)).toBe(true);
    } finally {
      cleanup();
    }
    expect(existsSync(tempDir)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openReadOnlyCopy enforces readonly: writes fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-copy-ro-"));
  try {
    const src = makeDb(dir);
    const { db, cleanup } = openReadOnlyCopy(src);
    try {
      expect(() =>
        db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["x", "y"]),
      ).toThrow();
    } finally {
      cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openReadOnlyCopy does not mutate source on parallel copies", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-copy-parallel-"));
  try {
    const src = makeDb(dir);
    const r1 = openReadOnlyCopy(src);
    const r2 = openReadOnlyCopy(src);
    r1.cleanup();
    r2.cleanup();
    // Source still readable + writable after both copy-opens closed.
    const live = new Database(src);
    live.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["k2", "v2"]);
    const row = live
      .query<{ value: string }, [string]>("SELECT value FROM ItemTable WHERE key = ?")
      .get("k2");
    expect(row?.value).toBe("v2");
    live.close();
  } finally {
    // Also remove any leftover junk
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openReadOnlyCopy rejects an empty-file source (corrupt SQLite)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-copy-bad-"));
  try {
    const bad = join(dir, "state.vscdb");
    writeFileSync(bad, "NOT_A_SQLITE_FILE");
    expect(() => openReadOnlyCopy(bad)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
