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

test("setMany is a no-op on an empty array", async () => {
  const s = new SqliteCursorStore(db, "continue");
  await s.setMany([]);
  expect(await s.get("offset:continue:chatInteraction")).toBe(null);
});

test("setMany commits all (key, value) pairs under the adapter_id", async () => {
  const s = new SqliteCursorStore(db, "continue");
  await s.setMany([
    { key: "offset:continue:chatInteraction", value: "11" },
    { key: "offset:continue:tokensGenerated", value: "22" },
    { key: "offset:continue:editOutcome", value: "33" },
    { key: "offset:continue:toolUsage", value: "44" },
  ]);
  expect(await s.get("offset:continue:chatInteraction")).toBe("11");
  expect(await s.get("offset:continue:tokensGenerated")).toBe("22");
  expect(await s.get("offset:continue:editOutcome")).toBe("33");
  expect(await s.get("offset:continue:toolUsage")).toBe("44");
});

test("setMany upserts — later batch overwrites earlier values for the same keys", async () => {
  const s = new SqliteCursorStore(db, "continue");
  await s.setMany([
    { key: "offset:continue:chatInteraction", value: "1" },
    { key: "offset:continue:tokensGenerated", value: "2" },
  ]);
  await s.setMany([
    { key: "offset:continue:chatInteraction", value: "100" },
    { key: "offset:continue:tokensGenerated", value: "200" },
  ]);
  expect(await s.get("offset:continue:chatInteraction")).toBe("100");
  expect(await s.get("offset:continue:tokensGenerated")).toBe("200");
});

test("setMany rolls back atomically when a single pair fails mid-batch", async () => {
  const s = new SqliteCursorStore(db, "continue");
  // Seed prior values so we can verify they're unchanged after the failed batch.
  await s.setMany([
    { key: "offset:continue:chatInteraction", value: "1" },
    { key: "offset:continue:tokensGenerated", value: "2" },
    { key: "offset:continue:editOutcome", value: "3" },
    { key: "offset:continue:toolUsage", value: "4" },
  ]);

  // Pass a bogus value that SQLite will reject: `value` column is `TEXT NOT NULL`
  // per migration 001, so `null` throws inside the transaction and must roll
  // back EVERY prior write in the same batch.
  let threw = false;
  try {
    await s.setMany([
      { key: "offset:continue:chatInteraction", value: "999" },
      { key: "offset:continue:tokensGenerated", value: "888" },
      { key: "offset:continue:editOutcome", value: null as unknown as string },
      { key: "offset:continue:toolUsage", value: "666" },
    ]);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);

  // Nothing from the failed batch leaked through — the prior values remain.
  expect(await s.get("offset:continue:chatInteraction")).toBe("1");
  expect(await s.get("offset:continue:tokensGenerated")).toBe("2");
  expect(await s.get("offset:continue:editOutcome")).toBe("3");
  expect(await s.get("offset:continue:toolUsage")).toBe("4");
});

test("setMany interleaves cleanly with set() and get()", async () => {
  const s = new SqliteCursorStore(db, "continue");
  await s.set("offset:continue:chatInteraction", "7");
  await s.setMany([
    { key: "offset:continue:chatInteraction", value: "70" },
    { key: "offset:continue:tokensGenerated", value: "11" },
  ]);
  expect(await s.get("offset:continue:chatInteraction")).toBe("70");
  expect(await s.get("offset:continue:tokensGenerated")).toBe("11");
  await s.set("offset:continue:chatInteraction", "700");
  expect(await s.get("offset:continue:chatInteraction")).toBe("700");
  // The setMany-written sibling key is untouched.
  expect(await s.get("offset:continue:tokensGenerated")).toBe("11");
});

test("setMany is scoped to the SqliteCursorStore's adapter_id", async () => {
  const cont = new SqliteCursorStore(db, "continue");
  const other = new SqliteCursorStore(db, "claude-code");
  await cont.setMany([
    { key: "offset:x", value: "CONT" },
    { key: "offset:y", value: "CONT-Y" },
  ]);
  await other.setMany([{ key: "offset:x", value: "CLAUDE" }]);
  expect(await cont.get("offset:x")).toBe("CONT");
  expect(await cont.get("offset:y")).toBe("CONT-Y");
  expect(await other.get("offset:x")).toBe("CLAUDE");
  expect(await other.get("offset:y")).toBe(null);
});
