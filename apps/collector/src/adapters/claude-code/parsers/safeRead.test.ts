import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLinesFromOffset } from "./safeRead";

test("reads all lines from offset 0 on a small file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "small.jsonl");
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 0);
  expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  expect(nextOffset).toBe(24);
  rmSync(dir, { recursive: true, force: true });
});

test("resumes from a non-zero offset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "resume.jsonl");
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 8);
  expect(lines).toEqual(['{"b":2}', '{"c":3}']);
  expect(nextOffset).toBe(24);
  rmSync(dir, { recursive: true, force: true });
});

test("handles a 60 MB file without dropping lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "big.jsonl");
  // Make 60MB of JSONL: 60_000 lines × ~1KB each.
  const line = `{"k":"${"x".repeat(1000)}"}\n`;
  const fd = Bun.file(path).writer();
  for (let i = 0; i < 60_000; i++) fd.write(line);
  await fd.end();
  const { lines } = await readLinesFromOffset(path, 0);
  expect(lines.length).toBe(60_000);
  rmSync(dir, { recursive: true, force: true });
}, 60_000);

test("ignores empty trailing newline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "trail.jsonl");
  writeFileSync(path, '{"a":1}\n\n');
  const { lines } = await readLinesFromOffset(path, 0);
  expect(lines).toEqual(['{"a":1}']);
  rmSync(dir, { recursive: true, force: true });
});

test("returns nextOffset unchanged if offset is past EOF", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "eof.jsonl");
  writeFileSync(path, '{"a":1}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 999);
  expect(lines).toEqual([]);
  expect(nextOffset).toBe(999);
  rmSync(dir, { recursive: true, force: true });
});
