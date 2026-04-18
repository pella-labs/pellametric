import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCursorState } from "./parse";

function withTempDb(fn: (db: Database) => void): { warnings: string[]; count: number } {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-parse-"));
  try {
    const p = join(dir, "state.vscdb");
    const db = new Database(p, { create: true });
    fn(db);
    db.close();
    const ro = new Database(p, { readonly: true });
    try {
      const { generations, warnings } = parseCursorState(ro);
      return { warnings, count: generations.length };
    } finally {
      ro.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parseCursorState returns warning when ItemTable is absent", () => {
  const { warnings, count } = withTempDb((db) => {
    db.run("CREATE TABLE unrelated (a INTEGER)");
  });
  expect(count).toBe(0);
  expect(warnings.some((w) => w.includes("ItemTable not found"))).toBe(true);
});

test("parseCursorState warns when aiService.generations key is missing", () => {
  const { warnings, count } = withTempDb((db) => {
    db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", ["some.other.key", "{}"]);
  });
  expect(count).toBe(0);
  expect(warnings.some((w) => w.includes("no aiService.generations"))).toBe(true);
});

test("parseCursorState warns on invalid JSON payload", () => {
  const { warnings, count } = withTempDb((db) => {
    db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [
      "aiService.generations",
      "{not json",
    ]);
  });
  expect(count).toBe(0);
  expect(warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
});

test("parseCursorState skips entries missing generationUUID or unixMs", () => {
  const { warnings, count } = withTempDb((db) => {
    db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [
      "aiService.generations",
      JSON.stringify([{ unixMs: 1 }, { generationUUID: "x" }, { unixMs: 2, generationUUID: "ok" }]),
    ]);
  });
  expect(count).toBe(1);
  expect(warnings.length).toBe(0);
});

test("parseCursorState sorts generations by unixMs", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-parse-sort-"));
  try {
    const p = join(dir, "state.vscdb");
    const db = new Database(p, { create: true });
    db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [
      "aiService.generations",
      JSON.stringify([
        { unixMs: 3000, generationUUID: "c" },
        { unixMs: 1000, generationUUID: "a" },
        { unixMs: 2000, generationUUID: "b" },
      ]),
    ]);
    db.close();
    const ro = new Database(p, { readonly: true });
    const { generations } = parseCursorState(ro);
    ro.close();
    expect(generations.map((g) => g.generationUUID)).toEqual(["a", "b", "c"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseCursorState preserves toolFormerData status when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-parse-tool-"));
  try {
    const p = join(dir, "state.vscdb");
    const db = new Database(p, { create: true });
    db.run("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [
      "aiService.generations",
      JSON.stringify([
        {
          unixMs: 1,
          generationUUID: "t1",
          toolFormerData: { tool: "read_file", additionalData: { status: "error" } },
        },
      ]),
    ]);
    db.close();
    const ro = new Database(p, { readonly: true });
    const { generations } = parseCursorState(ro);
    ro.close();
    expect(generations[0]?.toolFormerData?.tool).toBe("read_file");
    expect(generations[0]?.toolFormerData?.additionalData?.status).toBe("error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
