// Cursor adapter.
//
// Cursor stores every IDE session in a pair of SQLite DBs:
//   macOS   ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
//   Linux   $XDG_CONFIG_HOME/Cursor/User/globalStorage/state.vscdb   (~/.config)
//   Windows %APPDATA%/Cursor/User/globalStorage/state.vscdb
// plus one per-workspace state.vscdb under workspaceStorage/<wsHash>/.
//
// Key shape (validated on real user data across Cursor 1.7 → 2.3):
//   cursorDiskKV:composerData:<id>          ← one conversation header + ordering
//   cursorDiskKV:bubbleId:<cid>:<bid>       ← one turn (user / assistant / tool)
//   ItemTable['src...applicationUser']      ← aiSettings.composerModel etc.
//   workspaceStorage/<hash>/workspace.json  ← folder URI
//   workspaceStorage/<hash>/state.vscdb     ← ItemTable['composer.composerData']
//                                              .allComposers[] maps cid → workspace
//
// Access: dual backend.
//   1. `bun:sqlite` when running under Bun (the `bun build --compile`
//      binary produced by release.yml is a Bun runtime, so this is free —
//      no npm install, no native prebuild, and ~10× faster than shell-out
//      for the many-small-queries pattern in sweepCursor).
//   2. Shell out to the `sqlite3` CLI when running under plain Node (the
//      legacy `collector.mjs` fallback served from /setup/collector for
//      users who can't install a service). Same args the adapter used
//      before the dual-backend refactor. The existing collector already
//      shells out to `git`, so this adds nothing new to that code path.
// Selection happens once at module load. Both backends return identical
// row shapes (arrays of plain objects keyed by column name).
//
// Unlike Claude/Codex JSONL (append-only, byte-offset cursor), Cursor's
// SQLite rows are mutated in place as the session grows. The incremental
// strategy is a two-level watermark:
//   1. PRAGMA data_version — cheap "has the DB changed at all?" check
//   2. per-composer lastUpdatedAt — which composers need re-read
// We rebuild the SessionState for a changed composer from scratch each
// tick (idempotent — server upsert on (userId, source, externalSessionId)).
//
// Known honest gaps (documented so dashboard math is right):
//  - Per-bubble timestamps are NOT on disk. We synthesise prompt times by
//    interpolating between createdAt and lastUpdatedAt. This preserves
//    ordering and keeps the (user,source,sid,ts) prompt_uniq index happy.
//  - `model` comes from the user's currently-selected aiSettings. For
//    historical composers this may be wrong (user switched models since);
//    for new composers captured by the daemon it's correct.
//  - tokensCacheRead / tokensCacheWrite / tokensReasoning are 0 — Cursor
//    does not expose these locally. Treat as honest zeros, not estimates.
//  - ~21% of composers contain "orphan" bubbles not referenced by
//    fullConversationHeadersOnly (regenerated / cancelled turns). We
//    aggregate their tokens/tools/errors but don't count them as user
//    turns, mirroring the Claude adapter's isSidechain treatment.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { SessionMap, SessionState } from "../types";
import { newSessionState } from "../types";
import { classifyIntent, FRUSTRATION_RE, TEACHER_RE } from "./intent";

/**
 * Decode a `file://` URI into a plain platform path. Cross-platform safe:
 *   macOS / Linux: "file:///Users/a/b.ts"      → "/Users/a/b.ts"
 *   Windows:       "file:///C:/Users/a/b.ts"   → "C:\\Users\\a\\b.ts"
 * A bare path (no scheme) is returned as-is. Returns null on parse failure
 * so the caller can skip that entry rather than crash the sweep.
 */
export function fileUriToPath(raw: string): string | null {
  if (!raw) return null;
  try {
    if (raw.startsWith("file://")) return fileURLToPath(raw);
    // decodeURIComponent handles %20 etc. for anything that slipped past the
    // URI check (some Cursor versions stored workspace folders pre-decoded).
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

// ----------------------------- paths --------------------------------------

export function cursorDataRoot(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appdata, "Cursor");
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "Cursor");
}

function globalDb(root: string): string {
  return path.join(root, "User", "globalStorage", "state.vscdb");
}

function workspaceStorageDir(root: string): string {
  return path.join(root, "User", "workspaceStorage");
}

// ----------------------------- sqlite -------------------------------------

interface SqliteBackend {
  name: "bun" | "cli";
  query<T>(dbPath: string, sql: string): T[];
}

/**
 * Try to load `bun:sqlite` via createRequire with a runtime-built specifier
 * string — that prevents bundlers (including `bun build --target=node`) from
 * trying to resolve the module at compile time. Returns null when running
 * under plain Node, where `bun:sqlite` isn't a thing.
 */
function tryBunBackend(): SqliteBackend | null {
  const bunGlobal = (globalThis as { Bun?: unknown }).Bun;
  if (!bunGlobal) return null;
  try {
    const nodeRequire = createRequire(import.meta.url);
    const spec = "bun" + ":" + "sqlite";
    const Database = (nodeRequire(spec) as { Database: new (p: string, o?: unknown) => BunDbHandle }).Database;
    return {
      name: "bun",
      query<T>(dbPath: string, sql: string): T[] {
        if (!fs.existsSync(dbPath)) return [];
        let db: BunDbHandle | null = null;
        try {
          db = new Database(dbPath, { readonly: true });
          db.run("PRAGMA busy_timeout = 2000");
          return db.query(sql).all() as T[];
        } catch {
          return [];
        } finally {
          try { db?.close(); } catch { /* ignore */ }
        }
      },
    };
  } catch {
    return null;
  }
}

interface BunDbHandle {
  run(sql: string): void;
  query(sql: string): { all(): unknown[] };
  close(): void;
}

function makeCliBackend(): SqliteBackend {
  return {
    name: "cli",
    query<T>(dbPath: string, sql: string): T[] {
      if (!fs.existsSync(dbPath)) return [];
      try {
        const out = execFileSync(
          "sqlite3",
          ["-readonly", "-bail", "-cmd", ".timeout 2000", "-cmd", ".mode json", dbPath, sql],
          { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
        );
        if (!out.trim()) return [];
        return JSON.parse(out) as T[];
      } catch {
        return [];
      }
    },
  };
}

const backend: SqliteBackend = tryBunBackend() ?? makeCliBackend();

/** For logs / diagnostics — lets `pella doctor` (future) report which path is active. */
export function sqliteBackendName(): "bun" | "cli" {
  return backend.name;
}

/**
 * Run one SELECT and return rows as plain objects keyed by column name.
 * Values may contain newlines / pipes / any ASCII — both backends preserve
 * them as native strings, no delimiter collisions. `PRAGMA busy_timeout =
 * 2000` (bun) / `.timeout 2000` (cli) keeps us polite if Cursor is actively
 * writing.
 */
export function sqliteQuery<T = Record<string, string>>(dbPath: string, sql: string): T[] {
  return backend.query<T>(dbPath, sql);
}

/** Convenience: return the `value` column of the first row, or null. */
export function sqliteOne(dbPath: string, sql: string): string | null {
  const rows = sqliteQuery<{ value: string }>(dbPath, sql);
  return rows.length ? rows[0].value : null;
}

/** Current SQLite data_version — cheap monotonic "did anything write?" probe. */
export function sqliteDataVersion(dbPath: string): number {
  const rows = sqliteQuery<{ data_version: number }>(dbPath, "PRAGMA data_version");
  return rows[0]?.data_version ?? 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isSafeCursorId(id: string): boolean {
  return UUID_RE.test(id);
}

// ----------------------------- pure logic ---------------------------------

export interface CursorAiSettings {
  composerModel?: string;
  regularChatModel?: string;
  cmdKModel?: string;
}

export interface CursorBubble {
  type?: number; // 1 = user, 2 = assistant
  text?: string;
  tokenCount?: { inputTokens?: number; outputTokens?: number } | null;
  toolFormerData?: {
    name?: string;
    status?: string; // completed | error | cancelled
    userDecision?: string | null;
  } | null;
}

export interface CursorComposer {
  composerId?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  status?: string;
  unifiedMode?: string;
  forceMode?: string;
  fullConversationHeadersOnly?: Array<{ bubbleId: string; type?: number }>;
  originalFileStates?: Record<string, unknown>;
  newlyCreatedFiles?: string[];
  modelConfig?: { modelName?: string; maxMode?: boolean };
  _v?: number;
}

export function pickModel(cd: CursorComposer, ai: CursorAiSettings): string | undefined {
  // Prefer the per-composer modelConfig.modelName — it's the actual model used
  // for this session, not Cursor's currently-selected global setting. Falling
  // back to aiSettings keeps older schemas working.
  if (cd.modelConfig?.modelName) return cd.modelConfig.modelName;
  const mode = cd.unifiedMode || cd.forceMode;
  if (mode === "chat") return ai.regularChatModel || ai.composerModel;
  return ai.composerModel || ai.regularChatModel;
}

/**
 * Synthesise a per-turn timestamp by linear interpolation between the
 * session start and end. Preserves ordering and, crucially, always yields
 * a unique ms value across turns (we add turnIndex ms so the
 * prompt_uniq (userId,source,sid,ts) index never collides).
 */
export function interpolateTurnTs(
  startMs: number,
  endMs: number,
  turnIndex: number,
  totalTurns: number,
): Date {
  const span = Math.max(0, endMs - startMs);
  if (totalTurns <= 1) return new Date(startMs + turnIndex);
  const t = startMs + Math.floor((span * turnIndex) / (totalTurns - 1));
  return new Date(t + turnIndex);
}

/**
 * Build a fresh SessionState for one composer. The caller replaces any
 * previous entry in the SessionMap with this one — cursor rows are
 * mutated in place, so incremental fold-deltas don't apply.
 *
 * `bubblesAll` feeds the aggregate metrics (tokens/tools/errors). The
 * orphan bubbles that exist in ~21% of composers contribute real work
 * and belong in those totals. `bubblesOrdered` is the user-visible
 * conversation (fullConversationHeadersOnly) — used for user-turn /
 * prompt metrics only.
 */
export function buildCursorSessionState(
  cd: CursorComposer,
  bubblesOrdered: CursorBubble[],
  bubblesAll: CursorBubble[],
  cwd: string,
  model: string | undefined,
): SessionState {
  const sid = cd.composerId!;
  const s = newSessionState(sid, cwd, false, model);
  s.start = new Date(cd.createdAt || 0);
  s.end = new Date(cd.lastUpdatedAt || cd.createdAt || 0);

  // Aggregate across every bubble (including orphans).
  for (const b of bubblesAll) {
    const tc = b.tokenCount || {};
    s.tokensIn += tc.inputTokens || 0;
    s.tokensOut += tc.outputTokens || 0;
    const tfd = b.toolFormerData;
    if (tfd?.name) {
      s.toolHist[tfd.name] = (s.toolHist[tfd.name] || 0) + 1;
      // Only real system errors — user-pressed-cancel is intent, not a failure.
      if (tfd.status === "error") s.errors++;
      // Cursor's MCP tools follow an `mcp_<server>_<tool>` naming pattern.
      // Mirror Claude's mcpsUsed treatment.
      if (tfd.name.startsWith("mcp_")) {
        const server = tfd.name.split("_")[1];
        if (server) s.mcpsUsed.add(server);
      }
    } else if (b.type === 2 && (b.text || "").length > 0) {
      s.messages++;
    }
  }

  // Files touched — originalFileStates is Cursor's pre-edit snapshot map.
  for (const uri of Object.keys(cd.originalFileStates || {})) {
    const p = fileUriToPath(uri);
    if (p) s.filesEdited.add(p);
  }
  for (const f of cd.newlyCreatedFiles || []) s.filesEdited.add(f);

  // Walk the ordered conversation once and emit prompts + responses sharing
  // the same interpolated timeline so they interleave correctly in the drawer.
  // Orphan bubbles are intentionally excluded from prompts/responses — they
  // represent regenerated/cancelled turns the user never saw as a reply.
  const convo = bubblesOrdered.filter(b => (b.type === 1 || b.type === 2) && (b.text || "").length > 0);
  for (let i = 0; i < convo.length; i++) {
    const b = convo[i];
    const text = b.text || "";
    const wc = text.split(/\s+/).filter(Boolean).length;
    const ts = interpolateTurnTs(s.start.getTime(), s.end.getTime(), i, convo.length);
    if (b.type === 1) {
      s.userTurns++;
      const intent = classifyIntent(text);
      s.intents[intent] = (s.intents[intent] || 0) + 1;
      s.promptWords.push(wc);
      if (wc < 30 && TEACHER_RE.test(text)) s.teacherMoments++;
      if (FRUSTRATION_RE.test(text)) s.frustrationSpikes++;
      s.prompts.push({ ts, text, wordCount: wc });
    } else {
      s.responses.push({ ts, text, wordCount: wc });
    }
  }

  return s;
}

// ----------------------------- sweep --------------------------------------

export interface CursorSweepState {
  /** Last observed PRAGMA data_version — short-circuit ticks when unchanged. */
  dataVersion: number;
  /** composerId → last lastUpdatedAt we processed for that composer. */
  lastSeen: Map<string, number>;
}

export function newCursorSweepState(): CursorSweepState {
  return { dataVersion: -1, lastSeen: new Map() };
}

/**
 * Discover which composers changed since last sweep and rebuild their
 * SessionState entries in `sessions`. Returns the set of sids that were
 * touched — `finalizeSessions` consumes this for incremental uploads.
 *
 * Safe to call repeatedly. When Cursor is idle the whole function is a
 * single PRAGMA data_version lookup.
 */
export function sweepCursor(
  sessions: SessionMap,
  state: CursorSweepState,
  since: Date,
  root: string = cursorDataRoot(),
): Set<string> {
  const touched = new Set<string>();
  const gdb = globalDb(root);
  if (!fs.existsSync(gdb)) return touched;

  // Cheap short-circuit: the global DB hasn't been written to since last tick.
  const dv = sqliteDataVersion(gdb);
  if (dv > 0 && dv === state.dataVersion) return touched;

  // Read the user's currently-selected models (one shellout).
  const userBlob = sqliteOne(
    gdb,
    "SELECT value FROM ItemTable WHERE key = 'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser'",
  );
  let aiSettings: CursorAiSettings = {};
  if (userBlob) {
    try {
      aiSettings = (JSON.parse(userBlob) as { aiSettings?: CursorAiSettings }).aiSettings || {};
    } catch {
      /* ignore */
    }
  }

  // composerId → cwd (one pass across every workspaceStorage/<hash>/state.vscdb).
  const cidToCwd = buildComposerIdToCwd(root);

  // Pull every composer header (each is a small JSON blob; ~10KB p95).
  const composerRows = sqliteQuery<{ key: string; value: string }>(
    gdb,
    "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
  );
  const sinceMs = since.getTime();

  for (const { key, value } of composerRows) {
    // Defensive: one malformed / schema-drifted composer must NOT take down
    // the whole sweep. Wrap the per-composer work so a single bad row
    // degrades to "session not emitted" rather than "no sessions emitted".
    try {
    const cid = key.slice("composerData:".length);
    if (!isSafeCursorId(cid)) continue;
    let cd: CursorComposer;
    try {
      cd = JSON.parse(value);
    } catch {
      continue;
    }
    cd.composerId = cid;

    const headers = cd.fullConversationHeadersOnly || [];
    // Cursor pre-creates an empty composer per mode on startup — filter those.
    if ((!cd.status || cd.status === "none") && headers.length === 0) continue;

    const createdAt = cd.createdAt || 0;
    const lastUpdatedAt = cd.lastUpdatedAt || createdAt;
    if (!createdAt) continue;
    if (lastUpdatedAt < sinceMs) continue;

    // Skip composers we already processed at this same lastUpdatedAt.
    const prevSeen = state.lastSeen.get(cid) || 0;
    if (lastUpdatedAt <= prevSeen) continue;

    const cwd = cidToCwd.get(cid);
    if (!cwd) continue;

    // Clamp absurdly long "sessions" that sit open across days.
    const DAY = 24 * 60 * 60 * 1000;
    if (lastUpdatedAt - createdAt > DAY) cd.lastUpdatedAt = createdAt + DAY;

    // Load the composer's bubbles.
    const bubbleRows = sqliteQuery<{ key: string; value: string }>(
      gdb,
      `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${cid}:%'`,
    );
    const byId = new Map<string, CursorBubble>();
    const prefix = `bubbleId:${cid}:`;
    for (const { key: bk, value: bv } of bubbleRows) {
      if (!bv) continue;
      const bid = bk.slice(prefix.length);
      try {
        byId.set(bid, JSON.parse(bv));
      } catch {
        /* skip malformed */
      }
    }
    const bubblesOrdered: CursorBubble[] = [];
    for (const h of headers) {
      const b = byId.get(h.bubbleId);
      if (b) bubblesOrdered.push(b);
    }
    const bubblesAll = Array.from(byId.values());

    const model = pickModel(cd, aiSettings);
    const s = buildCursorSessionState(cd, bubblesOrdered, bubblesAll, cwd, model);
    sessions.set(cid, s);
    state.lastSeen.set(cid, lastUpdatedAt);
    touched.add(cid);
    } catch (e) {
      // Schema drift, truncated JSON, or any other per-composer failure.
      // Log once so operators see it, but don't abort the sweep.
      console.error(`pella cursor: skipped composer — ${(e as Error).message}`);
    }
  }

  state.dataVersion = dv;
  return touched;
}

function buildComposerIdToCwd(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const wsRoot = workspaceStorageDir(root);
  if (!fs.existsSync(wsRoot)) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(wsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(wsRoot, entry.name);
    const wj = path.join(dir, "workspace.json");
    const sdb = path.join(dir, "state.vscdb");
    if (!fs.existsSync(wj) || !fs.existsSync(sdb)) continue;

    let folder: string | null = null;
    try {
      const j = JSON.parse(fs.readFileSync(wj, "utf8"));
      folder = fileUriToPath(j.folder || "");
    } catch {
      continue;
    }
    if (!folder) continue;

    const v = sqliteOne(sdb, "SELECT value FROM ItemTable WHERE key = 'composer.composerData'");
    if (!v) continue;
    let parsed: { allComposers?: Array<{ composerId?: string }> };
    try {
      parsed = JSON.parse(v);
    } catch {
      continue;
    }
    for (const c of parsed.allComposers || []) {
      if (c.composerId) out.set(c.composerId, folder);
    }
  }
  return out;
}
