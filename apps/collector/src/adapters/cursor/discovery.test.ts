import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorStateDbPath, discoverSources } from "./discovery";

test("cursorStateDbPath honors CURSOR_STATE_DB override", () => {
  const prev = process.env.CURSOR_STATE_DB;
  try {
    process.env.CURSOR_STATE_DB = "/tmp/fake-cursor.db";
    expect(cursorStateDbPath()).toBe("/tmp/fake-cursor.db");
  } finally {
    if (prev === undefined) delete process.env.CURSOR_STATE_DB;
    else process.env.CURSOR_STATE_DB = prev;
  }
});

test("cursorStateDbPath returns an absolute path without override", () => {
  const prev = process.env.CURSOR_STATE_DB;
  try {
    delete process.env.CURSOR_STATE_DB;
    const p = cursorStateDbPath();
    expect(p.endsWith("state.vscdb")).toBe(true);
    expect(p.includes("Cursor")).toBe(true);
  } finally {
    if (prev !== undefined) process.env.CURSOR_STATE_DB = prev;
  }
});

test("discoverSources reports dbExists=false for a nonexistent path", () => {
  const prev = process.env.CURSOR_STATE_DB;
  try {
    process.env.CURSOR_STATE_DB = "/nonexistent/path/state.vscdb";
    const s = discoverSources();
    expect(s.dbExists).toBe(false);
    expect(s.dbPath).toBe("/nonexistent/path/state.vscdb");
  } finally {
    if (prev === undefined) delete process.env.CURSOR_STATE_DB;
    else process.env.CURSOR_STATE_DB = prev;
  }
});

test("discoverSources reports dbExists=true when file is present", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-disc-"));
  const db = join(dir, "state.vscdb");
  writeFileSync(db, "");
  const prev = process.env.CURSOR_STATE_DB;
  try {
    process.env.CURSOR_STATE_DB = db;
    expect(discoverSources().dbExists).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_STATE_DB;
    else process.env.CURSOR_STATE_DB = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
