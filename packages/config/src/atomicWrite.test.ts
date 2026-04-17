import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, unifiedDiff } from "./atomicWrite";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-atomic-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("atomicWrite creates file when missing", async () => {
  const target = join(dir, "a.txt");
  await atomicWrite(target, "hello");
  expect(readFileSync(target, "utf8")).toBe("hello");
  expect(existsSync(`${target}.bak`)).toBe(false);
});

test("atomicWrite writes .bak of previous contents", async () => {
  const target = join(dir, "b.txt");
  writeFileSync(target, "original");
  await atomicWrite(target, "updated");
  expect(readFileSync(target, "utf8")).toBe("updated");
  expect(readFileSync(`${target}.bak`, "utf8")).toBe("original");
});

test("atomicWrite overwrites existing .bak on second edit", async () => {
  const target = join(dir, "c.txt");
  writeFileSync(target, "first");
  await atomicWrite(target, "second");
  await atomicWrite(target, "third");
  expect(readFileSync(target, "utf8")).toBe("third");
  expect(readFileSync(`${target}.bak`, "utf8")).toBe("second");
});

test("unifiedDiff returns empty string when identical", () => {
  expect(unifiedDiff("same", "same")).toBe("");
});

test("unifiedDiff returns non-empty diff when different", () => {
  const d = unifiedDiff("line1\nline2\n", "line1\nLINE2\n");
  expect(d).toContain("-line2");
  expect(d).toContain("+LINE2");
});
