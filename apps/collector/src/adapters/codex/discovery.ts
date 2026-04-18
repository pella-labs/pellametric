import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CodexDiscoverySources {
  sessionsDir: string;
  sessionsDirExists: boolean;
}

/**
 * Default Codex CLI rollout directory layout:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<id>.jsonl
 *
 * Honored env overrides:
 *   CODEX_HOME — points at the replacement for ~/.codex (parity with
 *   CLAUDE_CONFIG_DIR in the Claude Code adapter).
 */
export function codexSessionsDir(): string {
  const base = process.env.CODEX_HOME || join(homedir(), ".codex");
  return join(base, "sessions");
}

export function discoverSources(): CodexDiscoverySources {
  const sessionsDir = codexSessionsDir();
  return {
    sessionsDir,
    sessionsDirExists: existsSync(sessionsDir),
  };
}
