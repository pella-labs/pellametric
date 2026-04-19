// Transcript loader — given a source + sessionId, returns the full
// user/assistant/tool turn list for the dashboard's session-detail view.
// Reads raw files directly:
//   - Claude:  ~/.claude/projects/<dir-hash>/<sessionId>.jsonl
//   - Codex:   ~/.codex/sessions/YYYY/MM/DD/rollout-*<sessionId>*.jsonl
//   - Cursor:  SQLite cursorDiskKV, rows keyed bubbleId:<composerId>:<bubbleId>

import "server-only";

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type TranscriptSource = "claude-code" | "codex" | "cursor";

export interface TranscriptTurn {
  seq: number;
  role: "user" | "assistant" | "tool";
  timestamp: string | null;
  model: string | null;
  /** Human-readable text content. For assistant turns, concatenated text
   *  blocks only; tool-use blocks become their own `tool` turns. */
  content: string;
  /** Tool metadata when role === "tool". */
  tool?: {
    name?: string;
    input?: string;
    output?: string;
    status?: "ok" | "error";
  };
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheCreate?: number;
  };
}

export interface TranscriptResult {
  source: TranscriptSource;
  sessionId: string;
  path: string | null;
  turns: TranscriptTurn[];
  /** Full-session totals derived from turns — handy for tile overlays on
   *  the detail page without re-hitting grammata. */
  totals: {
    userTurns: number;
    assistantTurns: number;
    toolTurns: number;
    toolErrors: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
  };
}

// ── Filesystem indexing ─────────────────────────────────────────
// Walking ~/.claude/projects on every request is expensive (thousands of
// JSONL files). Build one in-process index per source that maps sessionId
// → absolute path. The index is refreshed lazily on cache miss.

let claudeIndex: Map<string, string> | null = null;
let codexIndex: Map<string, string> | null = null;
let indexBuiltAt = 0;
const INDEX_TTL_MS = 5 * 60_000;

async function buildClaudeIndex(): Promise<Map<string, string>> {
  const root = join(homedir(), ".claude", "projects");
  const out = new Map<string, string>();
  try {
    const dirs = await readdir(root, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = join(root, d.name);
      let files: string[] = [];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const id = f.replace(/\.jsonl$/, "");
        out.set(id, join(dir, f));
      }
    }
  } catch {
    // Directory missing — return empty index, caller handles empty paths.
  }
  return out;
}

async function buildCodexIndex(): Promise<Map<string, string>> {
  const root = join(homedir(), ".codex", "sessions");
  const out = new Map<string, string>();
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as typeof entries;
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p, depth + 1);
      } else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        // Codex filenames look like: rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl
        const m = e.name.match(
          /rollout-.*?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
        );
        if (m?.[1]) out.set(m[1], p);
      }
    }
  }
  await walk(root, 0).catch(() => undefined);
  return out;
}

async function ensureIndexes(): Promise<void> {
  const now = Date.now();
  if (claudeIndex && codexIndex && now - indexBuiltAt < INDEX_TTL_MS) return;
  [claudeIndex, codexIndex] = await Promise.all([buildClaudeIndex(), buildCodexIndex()]);
  indexBuiltAt = now;
}

// ── Claude transcript ────────────────────────────────────────────

interface RawClaudeLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

function blocksToText(content: unknown): { text: string; toolCalls: ToolCallLite[] } {
  if (typeof content === "string") return { text: content, toolCalls: [] };
  if (!Array.isArray(content)) return { text: "", toolCalls: [] };
  const parts: string[] = [];
  const toolCalls: ToolCallLite[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const t = b.type;
    if (t === "text" && typeof b.text === "string") parts.push(b.text);
    else if (t === "thinking") {
      // Skip — noisy, can leak internal reasoning. IC can't normally see this.
    } else if (t === "tool_use") {
      toolCalls.push({
        name: typeof b.name === "string" ? b.name : "",
        input: tryStringify(b.input),
      });
    } else if (t === "tool_result") {
      toolCalls.push({
        name: typeof b.tool_use_id === "string" ? `result:${b.tool_use_id.slice(0, 8)}` : "result",
        output: tryStringify(b.content),
        status: b.is_error ? "error" : "ok",
      });
    }
  }
  return { text: parts.join("\n").trim(), toolCalls };
}

interface ToolCallLite {
  name: string;
  input?: string;
  output?: string;
  status?: "ok" | "error";
}

function tryStringify(x: unknown): string {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

async function loadClaudeTranscript(sessionId: string): Promise<TranscriptResult> {
  await ensureIndexes();
  const path = claudeIndex?.get(sessionId) ?? null;
  const turns: TranscriptTurn[] = [];
  if (!path) {
    return emptyResult("claude-code", sessionId, null);
  }
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return emptyResult("claude-code", sessionId, path);
  }
  let seq = 0;
  for (const raw of contents.split("\n")) {
    if (!raw.trim()) continue;
    let line: RawClaudeLine;
    try {
      line = JSON.parse(raw) as RawClaudeLine;
    } catch {
      continue;
    }
    const ts = line.timestamp ?? null;
    const model = line.message?.model ?? null;
    const role = line.type === "user" ? "user" : line.type === "assistant" ? "assistant" : null;
    if (!role) continue;
    const { text, toolCalls } = blocksToText(line.message?.content);
    if (text) {
      turns.push({ seq: seq++, role, timestamp: ts, model, content: text });
    }
    for (const tc of toolCalls) {
      turns.push({
        seq: seq++,
        role: "tool",
        timestamp: ts,
        model,
        content: tc.input || tc.output || tc.name,
        tool: tc,
      });
    }
    // Attach usage counters onto the most recent assistant turn.
    if (role === "assistant" && line.message?.usage) {
      const u = line.message.usage;
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i];
        if (!t) break;
        if (t.role === "assistant") {
          const tokens: NonNullable<TranscriptTurn["tokens"]> = {};
          if (u.input_tokens !== undefined) tokens.input = u.input_tokens;
          if (u.output_tokens !== undefined) tokens.output = u.output_tokens;
          if (u.cache_read_input_tokens !== undefined) tokens.cacheRead = u.cache_read_input_tokens;
          if (u.cache_creation_input_tokens !== undefined)
            tokens.cacheCreate = u.cache_creation_input_tokens;
          t.tokens = tokens;
          break;
        }
      }
    }
  }
  return finalize("claude-code", sessionId, path, turns);
}

// ── Codex transcript ────────────────────────────────────────────

interface RawCodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    /** Older Codex CLI shape. */
    content?: unknown;
    /** Newer Codex CLI shape — user_message / agent_message carry `message`
     *  string directly on the payload. */
    message?: string;
    model?: string;
    command?: unknown;
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    /** response_item payload: role + content blocks. */
    role?: string;
    info?: {
      total_token_usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
      };
    };
  };
  event_msg?: {
    type?: string;
    payload?: RawCodexLine["payload"];
  };
}

async function loadCodexTranscript(sessionId: string): Promise<TranscriptResult> {
  await ensureIndexes();
  const path = codexIndex?.get(sessionId) ?? null;
  if (!path) return emptyResult("codex", sessionId, null);
  let contents = "";
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return emptyResult("codex", sessionId, path);
  }
  const turns: TranscriptTurn[] = [];
  let seq = 0;
  let activeModel: string | null = null;
  for (const raw of contents.split("\n")) {
    if (!raw.trim()) continue;
    let line: RawCodexLine;
    try {
      line = JSON.parse(raw) as RawCodexLine;
    } catch {
      continue;
    }
    const ts = line.timestamp ?? null;
    const kind = line.event_msg?.type ?? line.payload?.type ?? line.type;
    const payload = line.event_msg?.payload ?? line.payload;
    if (!kind || !payload) continue;
    if (kind === "turn_context" && typeof payload.model === "string") {
      activeModel = payload.model;
      continue;
    }
    if (kind === "user_message" || kind === "UserMessage") {
      const text = payload.message ?? codexMessageText(payload.content);
      if (text) {
        turns.push({
          seq: seq++,
          role: "user",
          timestamp: ts,
          model: activeModel,
          content: text,
        });
      }
      continue;
    }
    if (kind === "agent_message" || kind === "AgentMessage") {
      const text = payload.message ?? codexMessageText(payload.content);
      if (text) {
        turns.push({
          seq: seq++,
          role: "assistant",
          timestamp: ts,
          model: activeModel,
          content: text,
        });
      }
      continue;
    }
    if (kind === "exec_command_start" || kind === "ExecCommandStart") {
      turns.push({
        seq: seq++,
        role: "tool",
        timestamp: ts,
        model: activeModel,
        content: tryStringify(payload.command),
        tool: { name: "shell", input: tryStringify(payload.command) },
      });
      continue;
    }
    if (kind === "exec_command_end" || kind === "ExecCommandEnd") {
      const failure = typeof payload.exit_code === "number" && payload.exit_code !== 0;
      turns.push({
        seq: seq++,
        role: "tool",
        timestamp: ts,
        model: activeModel,
        content:
          (payload.stdout ?? "") || (payload.stderr ?? "") || `exit ${payload.exit_code ?? "?"}`,
        tool: {
          name: "shell-end",
          output: (payload.stdout ?? "") + (payload.stderr ? `\n[stderr] ${payload.stderr}` : ""),
          status: failure ? "error" : "ok",
        },
      });
      continue;
    }
    if (kind === "token_count" && payload.info?.total_token_usage) {
      const u = payload.info.total_token_usage;
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i];
        if (!t) break;
        if (t.role === "assistant") {
          const tokens: NonNullable<TranscriptTurn["tokens"]> = {};
          if (u.input_tokens !== undefined) tokens.input = u.input_tokens;
          if (u.output_tokens !== undefined) tokens.output = u.output_tokens;
          if (u.cached_input_tokens !== undefined) tokens.cacheRead = u.cached_input_tokens;
          t.tokens = tokens;
          break;
        }
      }
    }
  }
  return finalize("codex", sessionId, path, turns);
}

function codexMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      if (typeof b === "string") parts.push(b);
      else if (b && typeof b === "object") {
        const x = b as Record<string, unknown>;
        if (typeof x.text === "string") parts.push(x.text);
        else if (typeof x.content === "string") parts.push(x.content);
      }
    }
    return parts.join("\n").trim();
  }
  return "";
}

// ── Cursor transcript ────────────────────────────────────────────

function cursorDbPath(): string | null {
  const home = homedir();
  const p = platform();
  if (p === "darwin")
    return join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  if (p === "win32")
    return join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb");
  return join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

interface RawCursorBubble {
  _v?: number;
  type?: number;
  bubbleId?: string;
  text?: string;
  createdAt?: string;
  toolFormerData?: {
    name?: string;
    status?: string;
    rawArgs?: string;
    additionalData?: { status?: string };
  };
  context?: { fileSelections?: unknown[] };
  richText?: unknown;
}

async function loadCursorTranscript(composerId: string): Promise<TranscriptResult> {
  const path = cursorDbPath();
  if (!path) return emptyResult("cursor", composerId, null);
  const exists = await stat(path).catch(() => null);
  if (!exists) return emptyResult("cursor", composerId, null);

  // Shell out to sqlite3 — Next.js dev runs on Node, bun:sqlite unavailable.
  // Cursor may be writing concurrently; sqlite3 CLI opens read-only by default
  // when the DB journal is in WAL mode (which Cursor uses).
  const safeId = composerId.replace(/[^a-zA-Z0-9-]/g, "");
  const sql = `SELECT key, CAST(value AS TEXT) as value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${safeId}:%' ORDER BY key`;
  let rows: { key: string; value: string }[] = [];
  try {
    const { stdout } = await execFileP("sqlite3", ["-json", path, sql], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (stdout.trim()) rows = JSON.parse(stdout) as { key: string; value: string }[];
  } catch {
    return emptyResult("cursor", composerId, path);
  }

  const turns: TranscriptTurn[] = [];
  let seq = 0;
  for (const row of rows) {
    let bubble: RawCursorBubble;
    try {
      bubble = JSON.parse(row.value) as RawCursorBubble;
    } catch {
      continue;
    }
    // Cursor bubble types (observed): 1 = user prompt, 2 = assistant response.
    const role: TranscriptTurn["role"] =
      bubble.type === 1 ? "user" : bubble.type === 2 ? "assistant" : "tool";
    const text = typeof bubble.text === "string" ? bubble.text.trim() : "";
    const tool = bubble.toolFormerData;
    if (tool?.name) {
      const status =
        tool.additionalData?.status === "error" || tool.status === "error" ? "error" : "ok";
      const toolMeta: NonNullable<TranscriptTurn["tool"]> = { name: tool.name, status };
      if (tool.rawArgs) toolMeta.input = tool.rawArgs;
      turns.push({
        seq: seq++,
        role: "tool",
        timestamp: bubble.createdAt ?? null,
        model: null,
        content: tool.rawArgs ?? tool.name,
        tool: toolMeta,
      });
      continue;
    }
    if (!text) continue;
    turns.push({
      seq: seq++,
      role,
      timestamp: bubble.createdAt ?? null,
      model: null,
      content: text,
    });
  }
  return finalize("cursor", composerId, path, turns);
}

// ── Common finalization ─────────────────────────────────────────

function emptyResult(
  source: TranscriptSource,
  sessionId: string,
  path: string | null,
): TranscriptResult {
  return {
    source,
    sessionId,
    path,
    turns: [],
    totals: {
      userTurns: 0,
      assistantTurns: 0,
      toolTurns: 0,
      toolErrors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
  };
}

function finalize(
  source: TranscriptSource,
  sessionId: string,
  path: string,
  turns: TranscriptTurn[],
): TranscriptResult {
  const totals = {
    userTurns: 0,
    assistantTurns: 0,
    toolTurns: 0,
    toolErrors: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
  };
  for (const t of turns) {
    if (t.role === "user") totals.userTurns++;
    else if (t.role === "assistant") totals.assistantTurns++;
    else totals.toolTurns++;
    if (t.tool?.status === "error") totals.toolErrors++;
    totals.inputTokens += t.tokens?.input ?? 0;
    totals.outputTokens += t.tokens?.output ?? 0;
    totals.cacheReadTokens += t.tokens?.cacheRead ?? 0;
    totals.cacheCreateTokens += t.tokens?.cacheCreate ?? 0;
  }
  return { source, sessionId, path, turns, totals };
}

export async function loadTranscript(
  source: TranscriptSource,
  sessionId: string,
): Promise<TranscriptResult> {
  switch (source) {
    case "claude-code":
      return loadClaudeTranscript(sessionId);
    case "codex":
      return loadCodexTranscript(sessionId);
    case "cursor":
      return loadCursorTranscript(sessionId);
    default:
      return emptyResult(source, sessionId, null);
  }
}

/** Session classification from turn counts + tool outcomes.
 *  "One-shot"   — single user prompt, successful outcome.
 *  "Iterative"  — 2–5 user prompts.
 *  "Deep-dive"  — 6+ user prompts.
 *  "Fixing"     — ≥1 tool error or explicit retry. */
export type SessionShape = "One-shot" | "Iterative" | "Deep-dive" | "Fixing";

export function classifyTurns(totals: TranscriptResult["totals"]): SessionShape {
  if (totals.toolErrors > 0) return "Fixing";
  if (totals.userTurns <= 1) return "One-shot";
  if (totals.userTurns <= 5) return "Iterative";
  return "Deep-dive";
}
