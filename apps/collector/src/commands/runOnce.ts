import os from "node:os";
import path from "node:path";
import { finalizeSessions } from "../accumulator";
import { ingestClaudeFileSlice } from "../parsers/claude";
import { type CodexFileCtxMap, ingestCodexFileSlice } from "../parsers/codex";
import { newCursorSweepState, sweepCursor } from "../parsers/cursor";
import { makeRepoCache, resolveRepo } from "../parsers/repo";
import { walkJsonl } from "../parsers/walk";
import type { SessionMap } from "../types";
import { uploadBatch } from "../upload";

export interface RunOnceOptions {
  url: string;
  token: string;
  /** Drop any event with timestamp < since. Default: beginning of time. */
  since?: Date;
}

/**
 * Backfill-once behavior: walk every JSONL file start-to-end, build the
 * full session state, upload, exit. Used by the legacy collector.mjs
 * one-liner and by `pella run-once` for CLI debugging.
 */
export async function runOnce(opts: RunOnceOptions): Promise<void> {
  const HOME = os.homedir();
  const since = opts.since ?? new Date(0);
  console.log(`pella-metrics collector → ${opts.url}`);
  console.log(`since: ${since.toISOString().slice(0, 10)}`);

  const repoCache = makeRepoCache();
  const resolver = (cwd: string) => resolveRepo(cwd, repoCache);

  // Claude
  const claudeSessions: SessionMap = new Map();
  const claudeRoot = path.join(HOME, ".claude", "projects");
  for (const file of walkJsonl(claudeRoot, /\.jsonl$/)) {
    ingestClaudeFileSlice(claudeSessions, file, 0, since);
  }
  const claudeFinal = finalizeSessions(claudeSessions, resolver);
  console.log(
    `claude sessions in-scope: ${claudeFinal.sessions.length} (prompts: ${claudeFinal.prompts.length}, responses: ${claudeFinal.responses.length})`,
  );
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "claude",
    sessions: claudeFinal.sessions,
    prompts: claudeFinal.prompts,
    responses: claudeFinal.responses,
  });

  // Codex
  const codexSessions: SessionMap = new Map();
  const codexCtx: CodexFileCtxMap = new Map();
  const codexRoots = [path.join(HOME, ".codex", "sessions"), path.join(HOME, ".codex", "archived_sessions")];
  for (const root of codexRoots) {
    for (const file of walkJsonl(root, /^rollout-.*\.jsonl$/)) {
      ingestCodexFileSlice(codexSessions, file, 0, codexCtx, since);
    }
  }
  const codexFinal = finalizeSessions(codexSessions, resolver);
  console.log(
    `codex sessions in-scope: ${codexFinal.sessions.length} (prompts: ${codexFinal.prompts.length}, responses: ${codexFinal.responses.length})`,
  );
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "codex",
    sessions: codexFinal.sessions,
    prompts: codexFinal.prompts,
    responses: codexFinal.responses,
  });

  // Cursor (SQLite, not JSONL — one sweep rebuilds every composer's state).
  const cursorSessions: SessionMap = new Map();
  sweepCursor(cursorSessions, newCursorSweepState(), since);
  const cursorFinal = finalizeSessions(cursorSessions, resolver);
  console.log(
    `cursor sessions in-scope: ${cursorFinal.sessions.length} (prompts: ${cursorFinal.prompts.length}, responses: ${cursorFinal.responses.length})`,
  );
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "cursor",
    sessions: cursorFinal.sessions,
    prompts: cursorFinal.prompts,
    responses: cursorFinal.responses,
  });
}
