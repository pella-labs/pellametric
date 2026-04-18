import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLinesFromOffset } from "./safeRead";

test("returns empty list + offset 0 when file is missing", async () => {
  const r = await readLinesFromOffset("/nonexistent/file.jsonl", 0);
  expect(r.lines).toEqual([]);
  expect(r.nextOffset).toBe(0);
  expect(r.rotated).toBe(false);
});

test("reads all lines from offset 0 and reports the byte length consumed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-safe-"));
  try {
    const f = join(dir, "x.jsonl");
    const body = `{"a":1}\n{"b":2}\n{"c":3}\n`;
    writeFileSync(f, body);
    const r = await readLinesFromOffset(f, 0);
    expect(r.lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(r.nextOffset).toBe(body.length);
    expect(r.rotated).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resumes from a stored offset and only emits new lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-safe-resume-"));
  try {
    const f = join(dir, "x.jsonl");
    const first = `{"a":1}\n{"b":2}\n`;
    writeFileSync(f, first);
    const r1 = await readLinesFromOffset(f, 0);
    appendFileSync(f, `{"c":3}\n{"d":4}\n`);
    const r2 = await readLinesFromOffset(f, r1.nextOffset);
    expect(r2.lines).toEqual(['{"c":3}', '{"d":4}']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partial trailing line is held back until a newline arrives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-safe-partial-"));
  try {
    const f = join(dir, "x.jsonl");
    writeFileSync(f, `{"a":1}\n{"b":2}\n{"c":`);
    const r1 = await readLinesFromOffset(f, 0);
    expect(r1.lines).toEqual(['{"a":1}', '{"b":2}']);
    appendFileSync(f, `3}\n`);
    const r2 = await readLinesFromOffset(f, r1.nextOffset);
    expect(r2.lines).toEqual(['{"c":3}']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rotation (file shrunk below stored offset) restarts from byte 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-safe-rotate-"));
  try {
    const f = join(dir, "x.jsonl");
    writeFileSync(f, `{"a":1}\n{"b":2}\n{"c":3}\n`);
    const r1 = await readLinesFromOffset(f, 0);
    // File rotates — replaced with a shorter one.
    writeFileSync(f, `{"new":1}\n`);
    const r2 = await readLinesFromOffset(f, r1.nextOffset);
    expect(r2.rotated).toBe(true);
    expect(r2.lines).toEqual(['{"new":1}']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
