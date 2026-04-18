import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLinesFromOffset } from "./safeRead";

test("reads every line of a small rollout without truncation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-read-"));
  const path = join(dir, "small.jsonl");
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 0);
  expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  expect(nextOffset).toBe(24);
  rmSync(dir, { recursive: true, force: true });
});

test("resumes from a non-zero offset (JSONL tail pattern)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-read-"));
  const path = join(dir, "resume.jsonl");
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 8);
  expect(lines).toEqual(['{"b":2}', '{"c":3}']);
  expect(nextOffset).toBe(24);
  rmSync(dir, { recursive: true, force: true });
});

test("reads a 60 MB rollout with no silent drop (D17 fix)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-read-"));
  const path = join(dir, "big.jsonl");
  const line = `{"k":"${"x".repeat(1000)}"}\n`;
  const writer = Bun.file(path).writer();
  for (let i = 0; i < 60_000; i++) writer.write(line);
  await writer.end();
  const { lines } = await readLinesFromOffset(path, 0);
  expect(lines.length).toBe(60_000);
  rmSync(dir, { recursive: true, force: true });
}, 60_000);

test("returns the same offset when asked past EOF (no rollback)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-read-"));
  const path = join(dir, "eof.jsonl");
  writeFileSync(path, '{"a":1}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 999);
  expect(lines).toEqual([]);
  expect(nextOffset).toBe(999);
  rmSync(dir, { recursive: true, force: true });
});
