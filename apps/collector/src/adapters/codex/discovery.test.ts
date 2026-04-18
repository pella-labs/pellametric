import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexSessionsDir, discoverSources } from "./discovery";

test("codexSessionsDir respects CODEX_HOME override", () => {
  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = "/some/codex/home";
    expect(codexSessionsDir()).toBe("/some/codex/home/sessions");
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});

test("discoverSources reports sessionsDirExists=true when CODEX_HOME points at a real dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-disc-"));
  mkdirSync(join(dir, "sessions"), { recursive: true });
  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    expect(discoverSources().sessionsDirExists).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverSources reports sessionsDirExists=false when CODEX_HOME is bogus", () => {
  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = "/nonexistent/codex/never";
    expect(discoverSources().sessionsDirExists).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});
