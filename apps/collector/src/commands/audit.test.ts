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

test("audit --tail surfaces dead-letter rows when present", async () => {
  // Seed a journal with a dead-letter row, then verify runAudit prints it.
  const { Database } = await import("bun:sqlite");
  const { egressSqlite } = await import("@bematist/config");
  const { migrate } = await import("../egress/migrations");
  const { Journal } = await import("../egress/journal");

  const dbPath = egressSqlite();
  const fs = await import("node:fs");
  fs.mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec("PRAGMA journal_mode=DELETE");
    migrate(db);
    const j = new Journal(db);
    j.enqueue({
      client_event_id: "00000000-0000-0000-0000-00000000dead",
      schema_version: 1,
      ts: "2026-04-18T14:00:00.000Z",
      tenant_id: "org_acme",
      engineer_id: "eng_x",
      device_id: "dev_y",
      source: "claude-code",
      fidelity: "full",
      tier: "B",
      session_id: "s1",
      event_seq: 0,
      dev_metrics: { event_kind: "session_start" },
      cost_estimated: false,
    } as const);
    j.markFailed(["00000000-0000-0000-0000-00000000dead"], "400 schema", { permanent: true });
  } finally {
    db.close();
  }

  const { runAudit } = await import("./audit");
  await runAudit(["--tail", "-n", "10"]);

  const summary = captured.find((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed._section === "dead_letter" && typeof parsed.count === "number";
    } catch {
      return false;
    }
  });
  const rowLine = captured.find((line) => line.includes("00000000-0000-0000-0000-00000000dead"));
  expect(summary).toBeTruthy();
  expect(rowLine).toBeTruthy();
});
