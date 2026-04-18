import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSources } from "./discovery";

function withDataDir<T>(setup: (dir: string) => void, fn: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "bematist-oc-disc-"));
  const prev = process.env.OPENCODE_DATA_DIR;
  try {
    setup(dir);
    process.env.OPENCODE_DATA_DIR = dir;
    return fn();
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("discoverSources flags sqliteExists when storage.sqlite is present", () => {
  const result = withDataDir(
    (dir) => writeFileSync(join(dir, "storage.sqlite"), ""),
    () => discoverSources(),
  );
  expect(result.sqliteExists).toBe(true);
  expect(result.legacyDirExists).toBe(false);
});

test("discoverSources flags legacyDirExists when storage/session/ has subdirs", () => {
  const result = withDataDir(
    (dir) => mkdirSync(join(dir, "storage", "session", "sess_a"), { recursive: true }),
    () => discoverSources(),
  );
  expect(result.legacyDirExists).toBe(true);
  expect(result.sqliteExists).toBe(false);
});

test("discoverSources reports both shapes when migration is in-flight (issue 13654)", () => {
  const result = withDataDir(
    (dir) => {
      mkdirSync(join(dir, "storage", "session", "sess_orphaned"), { recursive: true });
      writeFileSync(join(dir, "storage.sqlite"), "");
    },
    () => discoverSources(),
  );
  expect(result.sqliteExists).toBe(true);
  expect(result.legacyDirExists).toBe(true);
});

test("discoverSources reports dataDirExists=false for missing dir", () => {
  const prev = process.env.OPENCODE_DATA_DIR;
  try {
    process.env.OPENCODE_DATA_DIR = "/nonexistent/opencode/path";
    const r = discoverSources();
    expect(r.dataDirExists).toBe(false);
    expect(r.sqliteExists).toBe(false);
    expect(r.legacyDirExists).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prev;
  }
});

test("OPENCODE_DATA_DIR env var overrides platform default", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-oc-env-"));
  const prev = process.env.OPENCODE_DATA_DIR;
  try {
    process.env.OPENCODE_DATA_DIR = dir;
    expect(discoverSources().dataDir).toBe(dir);
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
