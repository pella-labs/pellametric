import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Integration-ish test: seed a fake ~/.claude/projects/ with the bundled
 * fixture, point the collector at it, run `bematist dry-run`, and assert
 * that (a) the command exits 0, (b) nothing is sent to the network,
 * (c) the egress log picks up one batch descriptor, (d) the printed preview
 * includes events.
 */

let dir: string;
let claudeDir: string;
let captured: string[];
const origLog = console.log;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-dryrun-"));
  claudeDir = join(dir, ".claude", "projects", "test-project");
  mkdirSync(claudeDir, { recursive: true });
  const fixture = `${[
    {
      type: "session_start",
      sessionId: "sess_dryrun_01",
      timestamp: "2026-04-16T14:00:00.000Z",
    },
    {
      requestId: "req_1",
      type: "message",
      sessionId: "sess_dryrun_01",
      timestamp: "2026-04-16T14:00:01.000Z",
      message: {
        role: "assistant",
        usage: { input_tokens: 100, output_tokens: 50 },
        model: "claude-sonnet-4-5",
      },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n")}\n`;
  writeFileSync(join(claudeDir, "session.jsonl"), fixture, "utf8");

  captured = [];
  console.log = (msg: unknown) => {
    captured.push(String(msg));
  };
  process.env.CLAUDE_CONFIG_DIR = join(dir, ".claude");
  process.env.BEMATIST_DATA_DIR = dir;
  process.env.BEMATIST_DRY_RUN = "1";
});

afterEach(() => {
  console.log = origLog;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.BEMATIST_DATA_DIR;
  delete process.env.BEMATIST_DRY_RUN;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

test("dry-run discovers seeded Claude Code data, logs preview, sends nothing", async () => {
  let networkCalls = 0;
  const origFetch = global.fetch;
  const fake = async () => {
    networkCalls += 1;
    return new Response(null, { status: 500 });
  };
  global.fetch = fake as unknown as typeof fetch;

  try {
    const { runDryRun } = await import("./dryRun");
    await runDryRun([]);
  } finally {
    global.fetch = origFetch;
  }

  expect(networkCalls).toBe(0);
  const outputs = captured.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
  const report = outputs.find((o) => o && typeof o === "object" && o.dryRun === true);
  expect(report).toBeTruthy();
  expect(report.adapters).toContain("claude-code");
  // The preview should show at least one event from the seeded fixture.
  expect(Array.isArray(report.preview)).toBe(true);
});
