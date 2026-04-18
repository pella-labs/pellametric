import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EgressLog } from "./egressLog";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-egresslog-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("write appends one JSON line per entry", () => {
  const log = new EgressLog(dir);
  log.write({
    ts: "2026-04-18T14:00:00.000Z",
    endpoint: "https://ingest.test",
    eventCount: 3,
    clientEventIds: ["a", "b", "c"],
    dryRun: false,
    bodyBytes: 500,
  });
  log.write({
    ts: "2026-04-18T14:00:01.000Z",
    endpoint: "https://ingest.test",
    eventCount: 1,
    clientEventIds: ["d"],
    dryRun: true,
    bodyBytes: 200,
  });
  expect(log.count()).toBe(2);
});

test("tail returns newest-first", () => {
  const log = new EgressLog(dir);
  for (let i = 0; i < 5; i++) {
    log.write({
      ts: `2026-04-18T14:00:0${i}.000Z`,
      endpoint: "https://ingest.test",
      eventCount: 1,
      clientEventIds: [`e${i}`],
      dryRun: false,
      bodyBytes: 100,
    });
  }
  const tail = log.tail(3);
  expect(tail.length).toBe(3);
  expect(tail[0]?.clientEventIds[0]).toBe("e4");
  expect(tail[1]?.clientEventIds[0]).toBe("e3");
  expect(tail[2]?.clientEventIds[0]).toBe("e2");
});

test("tail on empty log returns []", () => {
  const log = new EgressLog(dir);
  expect(log.tail(10)).toEqual([]);
  expect(log.count()).toBe(0);
});

test("survives a malformed line mid-file", () => {
  const log = new EgressLog(dir);
  log.write({
    ts: "2026-04-18T14:00:00.000Z",
    endpoint: "https://ingest.test",
    eventCount: 1,
    clientEventIds: ["x"],
    dryRun: false,
    bodyBytes: 100,
  });
  // Simulate a half-written line (corrupted by unclean shutdown).
  const fs = require("node:fs");
  fs.appendFileSync(join(dir, "egress.jsonl"), "not-json\n", "utf8");
  log.write({
    ts: "2026-04-18T14:00:01.000Z",
    endpoint: "https://ingest.test",
    eventCount: 1,
    clientEventIds: ["y"],
    dryRun: false,
    bodyBytes: 100,
  });
  const tail = log.tail(10);
  // The malformed line is skipped.
  expect(tail.length).toBe(2);
});
