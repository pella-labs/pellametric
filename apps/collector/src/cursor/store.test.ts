import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../egress/migrations";
import { SqliteCursorStore } from "./store";

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-cursor-"));
  db = new Database(join(dir, "c.sqlite"));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("get returns null for unset key", async () => {
  const s = new SqliteCursorStore(db, "claude-code");
  expect(await s.get("offset:foo")).toBe(null);
});

test("set then get round-trips a value", async () => {
  const s = new SqliteCursorStore(db, "claude-code");
  await s.set("offset:foo", "1234");
  expect(await s.get("offset:foo")).toBe("1234");
});

test("set overwrites a previous value", async () => {
  const s = new SqliteCursorStore(db, "claude-code");
  await s.set("offset:foo", "1");
  await s.set("offset:foo", "2");
  expect(await s.get("offset:foo")).toBe("2");
});

test("per-adapter isolation — same key, different adapter_id", async () => {
  const a = new SqliteCursorStore(db, "claude-code");
  const b = new SqliteCursorStore(db, "codex");
  await a.set("k", "A");
  await b.set("k", "B");
  expect(await a.get("k")).toBe("A");
  expect(await b.get("k")).toBe("B");
});
