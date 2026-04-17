import { expect, test } from "bun:test";
import { claudeProjectsDir, dataDir, egressSqlite, policyPath } from "./paths";

test("dataDir honors DEVMETRICS_DATA_DIR when set", () => {
  const prev = process.env.DEVMETRICS_DATA_DIR;
  try {
    process.env.DEVMETRICS_DATA_DIR = "/tmp/bematist-test-datadir";
    expect(dataDir()).toBe("/tmp/bematist-test-datadir");
  } finally {
    if (prev === undefined) delete process.env.DEVMETRICS_DATA_DIR;
    else process.env.DEVMETRICS_DATA_DIR = prev;
  }
});

test("dataDir falls back to ~/.bematist when env unset", () => {
  const prev = process.env.DEVMETRICS_DATA_DIR;
  try {
    delete process.env.DEVMETRICS_DATA_DIR;
    expect(dataDir()).toMatch(/[\\/]\.bematist$/);
  } finally {
    if (prev !== undefined) process.env.DEVMETRICS_DATA_DIR = prev;
  }
});

test("egressSqlite lives inside dataDir", () => {
  expect(egressSqlite()).toContain(".bematist");
  expect(egressSqlite()).toMatch(/egress\.sqlite$/);
});

test("policyPath honors DEVMETRICS_POLICY_PATH", () => {
  const prev = process.env.DEVMETRICS_POLICY_PATH;
  try {
    process.env.DEVMETRICS_POLICY_PATH = "/tmp/policy.yaml";
    expect(policyPath()).toBe("/tmp/policy.yaml");
  } finally {
    if (prev === undefined) delete process.env.DEVMETRICS_POLICY_PATH;
    else process.env.DEVMETRICS_POLICY_PATH = prev;
  }
});

test("claudeProjectsDir honors CLAUDE_CONFIG_DIR", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-alt";
    const result = claudeProjectsDir();
    expect(result).toMatch(/projects$/);
    expect(result).toContain("claude-alt");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

test("claudeProjectsDir defaults to ~/.claude/projects", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeProjectsDir()).toMatch(/[\\/]\.claude[\\/]projects$/);
  } finally {
    if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

test("dataDir treats empty string env var as unset (falls back to default)", () => {
  const prev = process.env.DEVMETRICS_DATA_DIR;
  try {
    process.env.DEVMETRICS_DATA_DIR = "";
    expect(dataDir()).toMatch(/[\\/]\.bematist$/);
  } finally {
    if (prev === undefined) delete process.env.DEVMETRICS_DATA_DIR;
    else process.env.DEVMETRICS_DATA_DIR = prev;
  }
});
