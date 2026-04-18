import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@bematist/sdk";
import { listLegacySessionIds, SkippedCounter } from "./skipped";

function silentLogger(): Logger {
  const log: Logger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => log,
  };
  return log;
}

test("SkippedCounter increments on first record() per sessionId", () => {
  const c = new SkippedCounter();
  expect(c.record("s1", "pre-v1.2", silentLogger())).toBe(true);
  expect(c.getCount()).toBe(1);
});

test("SkippedCounter is idempotent — second record() of same id is a no-op", () => {
  const c = new SkippedCounter();
  c.record("s1", "pre-v1.2", silentLogger());
  expect(c.record("s1", "pre-v1.2", silentLogger())).toBe(false);
  expect(c.getCount()).toBe(1);
});

test("SkippedCounter.reset clears state", () => {
  const c = new SkippedCounter();
  c.record("s1", "pre-v1.2", silentLogger());
  c.record("s2", "pre-v1.2", silentLogger());
  c.reset();
  expect(c.getCount()).toBe(0);
  expect(c.record("s1", "pre-v1.2", silentLogger())).toBe(true);
});

test("listLegacySessionIds returns subdir names sorted, ignoring files", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-oc-skip-"));
  try {
    mkdirSync(join(dir, "sess_b"));
    mkdirSync(join(dir, "sess_a"));
    writeFileSync(join(dir, "loose.json"), "{}");
    expect(listLegacySessionIds(dir)).toEqual(["sess_a", "sess_b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listLegacySessionIds returns [] when dir is missing", () => {
  expect(listLegacySessionIds("/nonexistent/legacy/dir")).toEqual([]);
});
