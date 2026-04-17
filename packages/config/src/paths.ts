import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(): string {
  return process.env.DEVMETRICS_DATA_DIR || join(homedir(), ".bematist");
}

export function egressSqlite(): string {
  return join(dataDir(), "egress.sqlite");
}

export function policyPath(): string {
  return process.env.DEVMETRICS_POLICY_PATH || join(dataDir(), "policy.yaml");
}

export function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, "projects");
}
