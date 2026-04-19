// H3 — fail-closed boot regression test.
//
// Prior to this fix, apps/ingest/src/index.ts:
//   • Had bootCheck.ts but never called assertGitHubBootDeps() at runtime.
//   • Swallowed Kafka + pg-store wiring failures and fell back to in-memory
//     defaults, silently accepting webhooks on a bus that would lose them.
//
// Production code paths must fail closed (PRD §10 non-negotiable). This
// test spawns the ingest entrypoint with GITHUB_APP_ID unset and asserts:
//   1. the process exits with code 1 (NOT 0, NOT defaulted to in-memory)
//   2. stderr/stdout carries a structured FATAL log with a specific code
//
// Kept in a dedicated file so it stays independent of the in-memory
// bun test deps — we literally spawn a child `bun` process and observe.

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import path from "node:path";

const INGEST_ENTRY = path.resolve(import.meta.dir, "../index.ts");

async function spawnIngest(env: Record<string, string | undefined>): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [INGEST_ENTRY], {
      env: { ...process.env, ...env } as Record<string, string>,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr?.on("data", (b) => {
      stderr += b.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ingest did not exit within 10s — fail-closed gate not hit"));
    }, 10_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("H3 — ingest boot fails closed on missing GITHUB_APP_ID", () => {
  test("exits 1 with structured FATAL log when GITHUB_APP_ID is unset", async () => {
    // Deliberately unset both GITHUB_APP_ID and NODE_ENV so the production
    // path runs. Leave BEMATIST_INGEST_FAILCLOSED_FATAL_ONLY=1 as an
    // opt-in that SHORT-CIRCUITS before Redis/PG are dialed — otherwise
    // this test would demand a running Redis+PG in the harness just to
    // reach the GITHUB_APP_ID check.
    const result = await spawnIngest({
      GITHUB_APP_ID: undefined,
      NODE_ENV: undefined,
      BEMATIST_INGEST_FAILCLOSED_FATAL_ONLY: "1",
    });
    expect(result.code).toBe(1);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toMatch(/BOOT_FAILED_GITHUB_APP_ID_MISSING/);
    expect(combined).toMatch(/FATAL/);
  }, 15_000);
});
