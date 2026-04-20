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

test("entry is durable on disk after write returns (SIGKILL-proxy via separate Bun process)", async () => {
  // Bill of Rights #1: audit written before POST must survive a SIGKILL.
  // Spawn a subprocess that writes one line then kills itself with SIGKILL.
  // Without fsync in write(), the kernel can buffer the write and a hard
  // kill here would lose the line. With fsync, the line must be on disk by
  // the time write() returned.
  const { spawnSync } = require("node:child_process");
  const fs = require("node:fs");
  const logPath = join(dir, "egress.jsonl");
  const scriptPath = join(dir, "_write-and-kill.ts");
  const egressLogSrc = join(import.meta.dir, "egressLog.ts");
  fs.writeFileSync(
    scriptPath,
    `import { EgressLog } from ${JSON.stringify(egressLogSrc)};
const log = new EgressLog(${JSON.stringify(dir)});
log.write({
  ts: "2026-04-18T14:00:00.000Z",
  endpoint: "https://ingest.test",
  eventCount: 1,
  clientEventIds: ["sigkill-proxy"],
  dryRun: false,
  bodyBytes: 100,
});
// Now SIGKILL self — no graceful shutdown, no close(). The line must have
// been fsynced before write() returned.
process.kill(process.pid, "SIGKILL");
`,
    "utf8",
  );
  const result = spawnSync("bun", [scriptPath], { encoding: "utf8" });
  if (process.platform !== "win32") {
    expect(result.signal).toBe("SIGKILL");
  }
  const raw = fs.readFileSync(logPath, "utf8");
  expect(raw).toContain("sigkill-proxy");
});
