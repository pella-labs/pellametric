import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EgressLog } from "../egress/egressLog";

let dir: string;
let captured: string[];
const origLog = console.log;
const origExit = process.exit;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-audit-cmd-"));
  captured = [];
  console.log = (msg: unknown) => {
    captured.push(String(msg));
  };
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (process as any).exit = (_: number) => {
    /* swallow for test */
  };
  process.env.BEMATIST_DATA_DIR = dir;
});

afterEach(() => {
  console.log = origLog;
  process.exit = origExit;
  delete process.env.BEMATIST_DATA_DIR;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("audit --tail prints each egress-log entry as one NDJSON line", async () => {
  const egress = new EgressLog(dir);
  for (let i = 0; i < 3; i++) {
    egress.write({
      ts: `2026-04-18T14:00:0${i}.000Z`,
      endpoint: "https://ingest.test/v1/events",
      eventCount: 1,
      clientEventIds: [`e${i}`],
      dryRun: false,
      bodyBytes: 100,
    });
  }

  const { runAudit } = await import("./audit");
  await runAudit(["--tail", "-n", "10"]);

  expect(captured.length).toBe(3);
  const parsed = captured.map((line) => JSON.parse(line));
  // newest-first
  expect(parsed[0].clientEventIds[0]).toBe("e2");
  expect(parsed[2].clientEventIds[0]).toBe("e0");
});

test("audit without --tail exits non-zero (usage)", async () => {
  const { runAudit } = await import("./audit");
  let exitCode = 0;
  // biome-ignore lint/suspicious/noExplicitAny: test override
  (process as any).exit = (n: number) => {
    exitCode = n;
    throw new Error("exit");
  };
  let err: unknown;
  try {
    await runAudit([]);
  } catch (e) {
    err = e;
  }
  expect(exitCode).toBe(2);
  expect(String(err)).toContain("exit");
});
