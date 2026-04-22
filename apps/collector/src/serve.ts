import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalizeSessions } from "./accumulator";
import type { CollectorConfig } from "./config";
import { ingestClaudeFileSlice } from "./parsers/claude";
import { type CodexFileCtxMap, ingestCodexFileSlice } from "./parsers/codex";
import { type CursorSweepState, newCursorSweepState, sweepCursor } from "./parsers/cursor";
import { makeRepoCache, resolveRepo } from "./parsers/repo";
import { walkJsonl } from "./parsers/walk";
import type { SessionMap } from "./types";
import { uploadBatch } from "./upload";

const HOME = os.homedir();
const CLAUDE_ROOT = path.join(HOME, ".claude", "projects");
const CODEX_ROOTS = [path.join(HOME, ".codex", "sessions"), path.join(HOME, ".codex", "archived_sessions")];
const CLAUDE_PATTERN = /\.jsonl$/;
const CODEX_PATTERN = /^rollout-.*\.jsonl$/;

/**
 * Per-file cursor. Kept in-memory only; the daemon rebuilds accumulator
 * state from scratch on restart (full re-parse from offset 0). Server-
 * side upserts on (userId, source, externalSessionId) make re-uploads
 * of already-seen sessions idempotent, so cold-start is correct but
 * not minimal — a good trade for the simplicity of no persisted state.
 */
interface FileCursor {
  offset: number;
  size: number;
}

export interface LoopHandle {
  /** Resolves after the final in-flight tick finishes and we've exited. */
  done: Promise<void>;
  /** Trigger graceful shutdown. */
  stop(): Promise<void>;
}

/**
 * Start the collector's streaming loop. Non-blocking — returns a handle
 * the caller can await / abort. `pella serve` wires SIGINT/SIGTERM to
 * `handle.stop()` and awaits `handle.done`.
 */
export function startServeLoop(cfg: CollectorConfig): LoopHandle {
  const repoCache = makeRepoCache();
  const resolver = (cwd: string) => resolveRepo(cwd, repoCache);
  const claudeSessions: SessionMap = new Map();
  const codexSessions: SessionMap = new Map();
  const cursorSessions: SessionMap = new Map();
  const codexCtx: CodexFileCtxMap = new Map();
  const claudeCursors = new Map<string, FileCursor>();
  const codexCursors = new Map<string, FileCursor>();
  const cursorSweepState: CursorSweepState = newCursorSweepState();

  let stopped = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  const tick = async () => {
    const started = Date.now();
    const touchedClaude = sweep(
      claudeSessions,
      claudeCursors,
      [CLAUDE_ROOT],
      CLAUDE_PATTERN,
      (state, abs, off) => ingestClaudeFileSlice(state, abs, off, cfg.since),
    );
    const touchedCodex = sweep(
      codexSessions,
      codexCursors,
      CODEX_ROOTS,
      CODEX_PATTERN,
      (state, abs, off) => ingestCodexFileSlice(state, abs, off, codexCtx, cfg.since),
    );
    // Cursor's SQLite source has its own PRAGMA data_version + per-composer
    // lastUpdatedAt watermarks (no byte-offset cursor — rows mutate in place).
    // Opt-out escape hatch: users whose state.vscdb has grown to multi-GB can
    // set PELLA_SKIP_CURSOR=1 in ~/.pella/config.env — the first cold-start
    // pass across the whole DB can otherwise peg CPU long enough for macOS's
    // "inefficient" killer to SIGTERM the daemon before it emits a tick.
    const touchedCursor = process.env.PELLA_SKIP_CURSOR === "1"
      ? new Set<string>()
      : sweepCursor(cursorSessions, cursorSweepState, cfg.since);

    if (touchedClaude.size > 0) {
      const { sessions, prompts, responses } = finalizeSessions(claudeSessions, resolver, touchedClaude);
      if (sessions.length > 0) {
        await uploadBatch({
          url: cfg.url,
          token: cfg.token,
          source: "claude",
          sessions,
          prompts,
          responses,
        });
      }
    }
    if (touchedCodex.size > 0) {
      const { sessions, prompts, responses } = finalizeSessions(codexSessions, resolver, touchedCodex);
      if (sessions.length > 0) {
        await uploadBatch({
          url: cfg.url,
          token: cfg.token,
          source: "codex",
          sessions,
          prompts,
          responses,
        });
      }
    }
    if (touchedCursor.size > 0) {
      const { sessions, prompts, responses } = finalizeSessions(cursorSessions, resolver, touchedCursor);
      if (sessions.length > 0) {
        await uploadBatch({
          url: cfg.url,
          token: cfg.token,
          source: "cursor",
          sessions,
          prompts,
          responses,
        });
      }
    }

    const total = touchedClaude.size + touchedCodex.size + touchedCursor.size;
    if (total > 0) {
      console.log(
        `pella tick: claude+${touchedClaude.size} codex+${touchedCodex.size} cursor+${touchedCursor.size} in ${Date.now() - started}ms`,
      );
    }
  };

  const loop = async () => {
    console.log(`pella serve: starting, endpoint=${cfg.url}, interval=${cfg.pollIntervalMs}ms`);
    // Cold-start pass: read every file from offset 0 to build full state.
    try {
      await tick();
    } catch (e) {
      console.error(`pella serve: cold-start tick failed — ${(e as Error).message}`);
    }
    while (!stopped) {
      await interruptibleSleep(cfg.pollIntervalMs, () => stopped);
      if (stopped) break;
      try {
        await tick();
      } catch (e) {
        console.error(`pella serve: tick failed — ${(e as Error).message}`);
      }
    }
    console.log("pella serve: stopped");
    resolveDone();
  };

  loop();

  return {
    done,
    async stop() {
      if (stopped) return done;
      stopped = true;
      return done;
    },
  };
}

/**
 * Walk `roots` for files matching `pattern`, advance each file's cursor
 * by reading its new lines, and merge touched sids into the returned
 * set. Cursor / truncation semantics: if the file shrank below the
 * cursor we reset to 0 (rotation / cleanup); if it grew we read from
 * the last consumed byte.
 */
function sweep(
  state: SessionMap,
  cursors: Map<string, FileCursor>,
  roots: string[],
  pattern: RegExp,
  ingest: (
    state: SessionMap,
    absPath: string,
    offset: number,
  ) => { endOffset: number; fileSize: number; touched: Set<string> },
): Set<string> {
  const touched = new Set<string>();
  for (const root of roots) {
    for (const file of walkJsonl(root, pattern)) {
      const cur = cursors.get(file) ?? { offset: 0, size: 0 };
      // Truncation / rotation guard: if the on-disk size is smaller
      // than our last observation, the file was replaced. Restart from
      // the beginning so we don't skip whatever now lives at offset 0.
      const startOffset = cur.size > 0 && fileShrunk(file, cur.size) ? 0 : cur.offset;
      const r = ingest(state, file, startOffset);
      for (const sid of r.touched) touched.add(sid);
      cursors.set(file, { offset: r.endOffset, size: r.fileSize });
    }
  }
  return touched;
}

function fileShrunk(absPath: string, lastSize: number): boolean {
  try {
    return fs.statSync(absPath).size < lastSize;
  } catch {
    return false;
  }
}

async function interruptibleSleep(totalMs: number, isAborted: () => boolean): Promise<void> {
  const TICK = 100;
  let remaining = totalMs;
  while (remaining > 0) {
    if (isAborted()) return;
    const slice = Math.min(TICK, remaining);
    await new Promise((r) => setTimeout(r, slice));
    remaining -= slice;
  }
}
