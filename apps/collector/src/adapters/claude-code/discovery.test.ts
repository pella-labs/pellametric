import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSources } from "./discovery";

test("otelEnabled reflects CLAUDE_CODE_ENABLE_TELEMETRY=1", () => {
  const prev = process.env.CLAUDE_CODE_ENABLE_TELEMETRY;
  try {
    process.env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
    expect(discoverSources().otelEnabled).toBe(true);
    process.env.CLAUDE_CODE_ENABLE_TELEMETRY = "0";
    expect(discoverSources().otelEnabled).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_ENABLE_TELEMETRY;
    else process.env.CLAUDE_CODE_ENABLE_TELEMETRY = prev;
  }
});

test("jsonlDirExists true when CLAUDE_CONFIG_DIR points at a real dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-disc-"));
  const projects = join(dir, "projects");
  require("node:fs").mkdirSync(projects, { recursive: true });
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = dir;
    expect(discoverSources().jsonlDirExists).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("jsonlDirExists false when pointing at nonexistent dir", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = "/nonexistent/path/definitely/not-there";
    expect(discoverSources().jsonlDirExists).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});
