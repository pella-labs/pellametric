import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSources } from "./discovery";

function withFixtureDir(setup: (devDataDir: string) => void, run: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cont-disc-"));
  const devData = join(dir, "dev_data", "0.2.0");
  mkdirSync(devData, { recursive: true });
  setup(devData);
  const prev = process.env.BEMATIST_CONTINUE_DIR;
  try {
    process.env.BEMATIST_CONTINUE_DIR = dir;
    run();
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("baseDirExists=false when CONTINUE_GLOBAL_DIR points at nothing", () => {
  const prev = process.env.BEMATIST_CONTINUE_DIR;
  try {
    process.env.BEMATIST_CONTINUE_DIR = "/nonexistent/continue/path/abc";
    const d = discoverSources();
    expect(d.baseDirExists).toBe(false);
    for (const v of Object.values(d.streams)) expect(v.exists).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prev;
  }
});

test("baseDirExists=true and streams marked present when files exist", () => {
  withFixtureDir(
    (devData) => {
      writeFileSync(join(devData, "chatInteraction.jsonl"), '{"foo":1}\n');
      writeFileSync(join(devData, "tokensGenerated.jsonl"), "");
    },
    () => {
      const d = discoverSources();
      expect(d.baseDirExists).toBe(true);
      expect(d.streams.chatInteraction.exists).toBe(true);
      expect(d.streams.chatInteraction.size).toBeGreaterThan(0);
      expect(d.streams.tokensGenerated.exists).toBe(true);
      expect(d.streams.tokensGenerated.size).toBe(0);
      expect(d.streams.editOutcome.exists).toBe(false);
      expect(d.streams.toolUsage.exists).toBe(false);
    },
  );
});

test("each stream path is reported even when missing", () => {
  withFixtureDir(
    () => {
      // intentionally empty
    },
    () => {
      const d = discoverSources();
      for (const k of ["chatInteraction", "tokensGenerated", "editOutcome", "toolUsage"] as const) {
        expect(d.streams[k].path.endsWith(`${k}.jsonl`)).toBe(true);
      }
    },
  );
});
