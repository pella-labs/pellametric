#!/usr/bin/env node

// src/commands/runOnce.ts
import os2 from "node:os";
import path4 from "node:path";

// src/parsers/repo.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
function makeRepoCache() {
  return new Map;
}
function gitlabHosts() {
  const set = new Set(["gitlab.com"]);
  const extra = process.env.PELLA_GITLAB_HOSTS;
  if (extra)
    for (const h of extra.split(",").map((s) => s.trim()).filter(Boolean))
      set.add(h);
  return set;
}
function parseRemote(url) {
  const stripped = url.replace(/\.git$/, "").replace(/\/+$/, "");
  let host = null;
  let p = null;
  let m = stripped.match(/^git@([^:]+):(.+)$/);
  if (m) {
    host = m[1];
    p = m[2];
  }
  if (!host) {
    m = stripped.match(/^(?:ssh|https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
    if (m) {
      host = m[1];
      p = m[2];
    }
  }
  if (!host || !p)
    return null;
  const segments = p.split("/").filter(Boolean);
  if (segments.length < 2)
    return null;
  const gitlabSet = gitlabHosts();
  const isGithub = host === "github.com";
  const isGitlab = gitlabSet.has(host);
  if (!isGithub && !isGitlab)
    return null;
  const repo = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join("/");
  if (!owner || !repo)
    return null;
  return { provider: isGithub ? "github" : "gitlab", owner, repo };
}
function resolveRepo(cwd, cache) {
  if (!cwd)
    return null;
  if (cache.has(cwd))
    return cache.get(cwd) ?? null;
  const trimmed = cwd.replace(/\/\.claude\/worktrees\/agent-[^/]+.*$/, "");
  let cur = trimmed;
  let root = null;
  for (let i = 0;i < 8; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) {
      root = cur;
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur)
      break;
    cur = parent;
  }
  if (!root) {
    cache.set(cwd, null);
    return null;
  }
  try {
    const url = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const info = parseRemote(url);
    cache.set(cwd, info);
    return info;
  } catch {
    cache.set(cwd, null);
    return null;
  }
}
function resolveBranch(cwd) {
  if (!cwd)
    return null;
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!out || out === "HEAD")
      return null;
    return out;
  } catch {
    return null;
  }
}

// src/accumulator.ts
function finalizeSessions(sessions, resolveRepoFn, only) {
  const out = [];
  const prompts = [];
  const responses = [];
  for (const s of sessions.values()) {
    if (only && !only.has(s.sid))
      continue;
    if (!s.start || !s.end || !s.cwd)
      continue;
    const info = resolveRepoFn(s.cwd);
    if (!info)
      continue;
    out.push(toWire(s, info));
    for (const p of s.prompts) {
      prompts.push({
        externalSessionId: s.sid,
        tsPrompt: p.ts.toISOString(),
        text: p.text,
        wordCount: p.wordCount
      });
    }
    for (const r of s.responses) {
      responses.push({
        externalSessionId: s.sid,
        tsResponse: r.ts.toISOString(),
        text: r.text,
        wordCount: r.wordCount
      });
    }
  }
  return { sessions: out, prompts, responses };
}
function toWire(s, info) {
  const pw = s.promptWords.slice().sort((a, b) => a - b);
  const median = pw.length ? pw[Math.floor(pw.length / 2)] : 0;
  const p95 = pw.length ? pw[Math.min(pw.length - 1, Math.floor(pw.length * 0.95))] : 0;
  const branch = s.cwd ? resolveBranch(s.cwd) ?? undefined : undefined;
  const cwdResolvedRepo = `${info.owner}/${info.repo}`;
  return {
    externalSessionId: s.sid,
    repo: cwdResolvedRepo,
    provider: info.provider,
    cwd: s.cwd,
    branch,
    cwdResolvedRepo,
    startedAt: s.start.toISOString(),
    endedAt: s.end.toISOString(),
    model: s.model,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    tokensCacheRead: s.tokensCacheRead,
    tokensCacheWrite: s.tokensCacheWrite,
    tokensReasoning: s.tokensReasoning,
    messages: s.messages,
    userTurns: s.userTurns,
    errors: s.errors,
    filesEdited: [...s.filesEdited],
    toolHist: s.toolHist,
    skillsUsed: [...s.skillsUsed],
    mcpsUsed: [...s.mcpsUsed],
    intentTop: topIntent(s.intents),
    isSidechain: s.isSidechain,
    teacherMoments: s.teacherMoments,
    frustrationSpikes: s.frustrationSpikes,
    promptWordsMedian: median,
    promptWordsP95: p95
  };
}
function topIntent(intents) {
  let best = null;
  for (const e of Object.entries(intents)) {
    if (!best || e[1] > best[1])
      best = e;
  }
  return best?.[0];
}

// src/types.ts
function newSessionState(sid, cwd, isSidechain = false, model) {
  return {
    sid,
    cwd,
    start: null,
    end: null,
    isSidechain,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensReasoning: 0,
    messages: 0,
    userTurns: 0,
    errors: 0,
    filesEdited: new Set,
    toolHist: {},
    skillsUsed: new Set,
    mcpsUsed: new Set,
    intents: {},
    model,
    teacherMoments: 0,
    frustrationSpikes: 0,
    promptWords: [],
    prompts: [],
    responses: []
  };
}

// src/parsers/intent.ts
function classifyIntent(text) {
  const t = text.slice(0, 2000).trim();
  if (t.length < 40 && /^(sure|yes|yep|yeah|ok(ay)?|go|do it|continue|more|next|ship it|proceed|right|correct|good|perfect|ya|yup)\.?!?$/i.test(t))
    return "approval";
  if (/\b(fix|bug|error|broken|crash|fail|wrong|issue|not working|doesn'?t work)\b/i.test(t))
    return "bugfix";
  if (/\b(refactor|clean ?up|simplify|rename|extract|reorganize|consolidat|swap|replace|delete|remove|dedupe)\b/i.test(t))
    return "refactor";
  if (/\b(add|build|create|implement|new|make|wire|setup|integrate|connect)\b/i.test(t))
    return "feature";
  if (/\b(how|what|why|explain|show me|where is|tell me|can you|should i|check|verify|inspect|look at|understand)\b/i.test(t))
    return "exploration";
  return "other";
}
var TEACHER_RE = /\b(no|wrong|that'?s not|actually|instead|don'?t|undo|revert|not like that|nope)\b/i;
var FRUSTRATION_RE = /\b(fuck|shit|wtf|damn|ugh)\b|!{2,}|\b[A-Z]{4,}\b/;

// src/parsers/slice.ts
import fs2 from "node:fs";
function readNewLines(absPath, startOffset) {
  let stat;
  try {
    stat = fs2.statSync(absPath);
  } catch {
    return { lines: [], bytesConsumed: startOffset, fileSize: 0 };
  }
  const size = stat.size;
  if (size <= startOffset)
    return { lines: [], bytesConsumed: size, fileSize: size };
  const len = size - startOffset;
  const buf = Buffer.alloc(len);
  let fd = null;
  try {
    fd = fs2.openSync(absPath, "r");
    let total = 0;
    while (total < len) {
      const read = fs2.readSync(fd, buf, total, len - total, startOffset + total);
      if (read <= 0)
        break;
      total += read;
    }
    fd = (fs2.closeSync(fd), null);
  } catch {
    if (fd !== null)
      try {
        fs2.closeSync(fd);
      } catch {}
    return { lines: [], bytesConsumed: startOffset, fileSize: size };
  }
  const slice = buf.toString("utf8");
  const lastNewline = slice.lastIndexOf(`
`);
  if (lastNewline < 0) {
    return { lines: [], bytesConsumed: startOffset, fileSize: size };
  }
  const complete = slice.slice(0, lastNewline);
  const bytesConsumed = startOffset + Buffer.byteLength(complete, "utf8") + 1;
  const lines = complete.length === 0 ? [] : complete.split(`
`);
  return { lines, bytesConsumed, fileSize: size };
}

// src/parsers/claude.ts
function foldClaudeLine(sessions, line, since) {
  if (!line)
    return null;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const sid = d.sessionId;
  if (!sid)
    return null;
  const ts = d.timestamp ? new Date(d.timestamp) : null;
  if (ts && ts < since)
    return null;
  const cwd = d.cwd || "";
  let s = sessions.get(sid);
  if (!s) {
    s = newSessionState(sid, cwd, !!d.isSidechain);
    sessions.set(sid, s);
  } else if (!s.cwd && cwd) {
    s.cwd = cwd;
  }
  if (ts) {
    if (!s.start || ts < s.start)
      s.start = ts;
    if (!s.end || ts > s.end)
      s.end = ts;
  }
  if (d.type === "assistant") {
    const msg = d.message || {};
    const u = msg.usage || {};
    s.tokensIn += u.input_tokens || 0;
    s.tokensOut += u.output_tokens || 0;
    s.tokensCacheRead += u.cache_read_input_tokens || 0;
    s.tokensCacheWrite += u.cache_creation_input_tokens || 0;
    if (msg.model)
      s.model = msg.model;
    const content = Array.isArray(msg.content) ? msg.content : [];
    const textParts = content.filter((c) => c && typeof c === "object" && c.type === "text" && typeof c.text === "string").map((c) => c.text);
    if (textParts.length > 0) {
      s.messages++;
      if (!d.isSidechain && ts) {
        const joined = textParts.join(`

`).trim();
        if (joined) {
          const wc = joined.split(/\s+/).filter(Boolean).length;
          s.responses.push({ ts, text: joined, wordCount: wc });
        }
      }
    }
    for (const c of content) {
      if (!c || typeof c !== "object")
        continue;
      if (c.type === "tool_use") {
        const name = c.name || "unknown";
        s.toolHist[name] = (s.toolHist[name] || 0) + 1;
        if (name === "Skill")
          s.skillsUsed.add(c.input?.skill || "unknown");
        if (name.startsWith("mcp__"))
          s.mcpsUsed.add(name.split("__")[1] || "unknown");
        if (["Edit", "Write", "NotebookEdit"].includes(name) && c.input?.file_path) {
          s.filesEdited.add(c.input.file_path);
        }
      }
    }
    return sid;
  }
  if (d.type === "user") {
    const mc = d.message?.content;
    if (Array.isArray(mc)) {
      for (const p of mc)
        if (p?.type === "tool_result" && p.is_error)
          s.errors++;
    }
    if (d.isSidechain)
      return sid;
    const raw = typeof d.message?.content === "string" ? d.message.content : Array.isArray(d.message?.content) ? d.message.content.map((x) => x?.text || "").join("") : "";
    if (!raw || raw.startsWith("<local-command") || raw.startsWith("<command-name"))
      return sid;
    let text = raw;
    if (raw.startsWith("Human: <info-msg>") || raw.startsWith("<info-msg>")) {
      const close = raw.indexOf("</info-msg>");
      text = close >= 0 ? raw.slice(close + "</info-msg>".length).trim() : "";
    } else if (raw.startsWith("Human: <")) {
      text = "";
    }
    if (!text)
      return sid;
    s.userTurns++;
    const intent = classifyIntent(text);
    s.intents[intent] = (s.intents[intent] || 0) + 1;
    const wc = text.split(/\s+/).filter(Boolean).length;
    s.promptWords.push(wc);
    if (wc < 30 && TEACHER_RE.test(text))
      s.teacherMoments++;
    if (FRUSTRATION_RE.test(text))
      s.frustrationSpikes++;
    if (ts)
      s.prompts.push({ ts, text, wordCount: wc });
    return sid;
  }
  return null;
}
function ingestClaudeFileSlice(sessions, absPath, startOffset, since) {
  const touched = new Set;
  const { lines, bytesConsumed, fileSize } = readNewLines(absPath, startOffset);
  for (const line of lines) {
    const sid = foldClaudeLine(sessions, line, since);
    if (sid)
      touched.add(sid);
  }
  return { endOffset: bytesConsumed, fileSize, touched };
}

// src/parsers/codex.ts
function makeCodexCtx() {
  return { sid: null, cwd: "" };
}
function foldCodexLine(sessions, line, ctx, since) {
  if (!line)
    return null;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const ts = d.timestamp ? new Date(d.timestamp) : null;
  if (ts && ts < since)
    return null;
  const t = d.type;
  const p = d.payload || {};
  if (t === "session_meta") {
    ctx.sid = p.id ?? null;
    ctx.cwd = p.cwd || "";
    if (!ctx.sid)
      return null;
    let s2 = sessions.get(ctx.sid);
    if (!s2) {
      s2 = newSessionState(ctx.sid, ctx.cwd, false, "codex");
      sessions.set(ctx.sid, s2);
    } else if (!s2.cwd && ctx.cwd) {
      s2.cwd = ctx.cwd;
    }
    if (ts) {
      if (!s2.start || ts < s2.start)
        s2.start = ts;
      if (!s2.end || ts > s2.end)
        s2.end = ts;
    }
    return ctx.sid;
  }
  if (!ctx.sid)
    return null;
  const s = sessions.get(ctx.sid);
  if (!s)
    return null;
  if (ts) {
    if (!s.start || ts < s.start)
      s.start = ts;
    if (!s.end || ts > s.end)
      s.end = ts;
  }
  if (t === "event_msg" && p.type === "token_count" && p.info?.total_token_usage) {
    const u = p.info.total_token_usage;
    const ti = u.input_tokens || 0;
    const cached = u.cached_input_tokens || 0;
    s.tokensIn = Math.max(0, ti - cached);
    s.tokensOut = u.output_tokens || 0;
    s.tokensCacheRead = cached;
    s.tokensReasoning = u.reasoning_output_tokens || 0;
    return ctx.sid;
  }
  if (t === "event_msg" && p.type === "user_message") {
    const raw = p.message || "";
    const trimmed = raw.replace(/^\s+/, "");
    let text = raw;
    if (trimmed.startsWith("# Context from my IDE setup:") || trimmed.startsWith("# Files mentioned by the user:")) {
      const marker = trimmed.indexOf("## My request for Codex:");
      text = marker >= 0 ? trimmed.slice(marker + "## My request for Codex:".length).trim() : "";
    }
    if (text) {
      s.userTurns++;
      const intent = classifyIntent(text);
      s.intents[intent] = (s.intents[intent] || 0) + 1;
      const wc = text.split(/\s+/).filter(Boolean).length;
      s.promptWords.push(wc);
      if (wc < 30 && TEACHER_RE.test(text))
        s.teacherMoments++;
      if (FRUSTRATION_RE.test(text))
        s.frustrationSpikes++;
      if (ts)
        s.prompts.push({ ts, text, wordCount: wc });
    }
    return ctx.sid;
  }
  if (t === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call")) {
    const name = p.name || "unknown";
    s.toolHist[name] = (s.toolHist[name] || 0) + 1;
    if (p.type === "custom_tool_call" && name === "apply_patch" && typeof p.input === "string") {
      const re = /^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm;
      for (const m of p.input.matchAll(re))
        s.filesEdited.add(m[1].trim());
    }
    return ctx.sid;
  }
  if (t === "response_item" && p.type === "message" && p.role === "assistant") {
    s.messages++;
    const content = Array.isArray(p.content) ? p.content : [];
    const textParts = content.filter((c) => c && typeof c === "object" && typeof c.text === "string").map((c) => c.text);
    if (textParts.length > 0 && ts) {
      const joined = textParts.join(`

`).trim();
      if (joined) {
        const wc = joined.split(/\s+/).filter(Boolean).length;
        s.responses.push({ ts, text: joined, wordCount: wc });
      }
    }
    return ctx.sid;
  }
  if (t === "response_item" && (p.type === "function_call_output" || p.type === "custom_tool_call_output")) {
    const out = p.output;
    if (typeof out === "string" && out.startsWith("{")) {
      try {
        const parsed = JSON.parse(out);
        const ec = parsed?.metadata?.exit_code;
        if (typeof ec === "number" && ec !== 0)
          s.errors++;
      } catch {}
    }
    return ctx.sid;
  }
  if (t === "event_msg" && p.type === "patch_apply_end") {
    const changes = p.changes || {};
    for (const fp of Object.keys(changes))
      s.filesEdited.add(fp);
    return ctx.sid;
  }
  if (t === "event_msg" && p.type === "error") {
    s.errors++;
    return ctx.sid;
  }
  return null;
}
function ingestCodexFileSlice(sessions, absPath, startOffset, ctxMap, since) {
  const touched = new Set;
  let ctx = ctxMap.get(absPath);
  if (!ctx) {
    ctx = makeCodexCtx();
    ctxMap.set(absPath, ctx);
  }
  const { lines, bytesConsumed, fileSize } = readNewLines(absPath, startOffset);
  for (const line of lines) {
    const sid = foldCodexLine(sessions, line, ctx, since);
    if (sid)
      touched.add(sid);
  }
  return { endOffset: bytesConsumed, fileSize, touched };
}

// src/parsers/cursor.ts
import fs3 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync as execFileSync2 } from "node:child_process";
import { createRequire } from "node:module";
function fileUriToPath(raw) {
  if (!raw)
    return null;
  try {
    if (raw.startsWith("file://"))
      return fileURLToPath(raw);
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
function cursorDataRoot() {
  if (process.platform === "darwin") {
    return path2.join(os.homedir(), "Library", "Application Support", "Cursor");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path2.join(os.homedir(), "AppData", "Roaming");
    return path2.join(appdata, "Cursor");
  }
  const xdg = process.env.XDG_CONFIG_HOME || path2.join(os.homedir(), ".config");
  return path2.join(xdg, "Cursor");
}
function globalDb(root) {
  return path2.join(root, "User", "globalStorage", "state.vscdb");
}
function workspaceStorageDir(root) {
  return path2.join(root, "User", "workspaceStorage");
}
function tryBunBackend() {
  const bunGlobal = globalThis.Bun;
  if (!bunGlobal)
    return null;
  try {
    const nodeRequire = createRequire(import.meta.url);
    const spec = "bun" + ":" + "sqlite";
    const Database = nodeRequire(spec).Database;
    return {
      name: "bun",
      query(dbPath, sql) {
        if (!fs3.existsSync(dbPath))
          return [];
        let db = null;
        try {
          db = new Database(dbPath, { readonly: true });
          db.run("PRAGMA busy_timeout = 2000");
          return db.query(sql).all();
        } catch {
          return [];
        } finally {
          try {
            db?.close();
          } catch {}
        }
      }
    };
  } catch {
    return null;
  }
}
function makeCliBackend() {
  return {
    name: "cli",
    query(dbPath, sql) {
      if (!fs3.existsSync(dbPath))
        return [];
      try {
        const out = execFileSync2("sqlite3", ["-readonly", "-bail", "-cmd", ".timeout 2000", "-cmd", ".mode json", dbPath, sql], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
        if (!out.trim())
          return [];
        return JSON.parse(out);
      } catch {
        return [];
      }
    }
  };
}
var backend = tryBunBackend() ?? makeCliBackend();
function sqliteQuery(dbPath, sql) {
  return backend.query(dbPath, sql);
}
function sqliteOne(dbPath, sql) {
  const rows = sqliteQuery(dbPath, sql);
  return rows.length ? rows[0].value : null;
}
function sqliteDataVersion(dbPath) {
  const rows = sqliteQuery(dbPath, "PRAGMA data_version");
  return rows[0]?.data_version ?? 0;
}
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isSafeCursorId(id) {
  return UUID_RE.test(id);
}
function pickModel(cd, ai) {
  if (cd.modelConfig?.modelName)
    return cd.modelConfig.modelName;
  const mode = cd.unifiedMode || cd.forceMode;
  if (mode === "chat")
    return ai.regularChatModel || ai.composerModel;
  return ai.composerModel || ai.regularChatModel;
}
function interpolateTurnTs(startMs, endMs, turnIndex, totalTurns) {
  const span = Math.max(0, endMs - startMs);
  if (totalTurns <= 1)
    return new Date(startMs + turnIndex);
  const t = startMs + Math.floor(span * turnIndex / (totalTurns - 1));
  return new Date(t + turnIndex);
}
function buildCursorSessionState(cd, bubblesOrdered, bubblesAll, cwd, model) {
  const sid = cd.composerId;
  const s = newSessionState(sid, cwd, false, model);
  s.start = new Date(cd.createdAt || 0);
  s.end = new Date(cd.lastUpdatedAt || cd.createdAt || 0);
  for (const b of bubblesAll) {
    const tc = b.tokenCount || {};
    s.tokensIn += tc.inputTokens || 0;
    s.tokensOut += tc.outputTokens || 0;
    const tfd = b.toolFormerData;
    if (tfd?.name) {
      s.toolHist[tfd.name] = (s.toolHist[tfd.name] || 0) + 1;
      if (tfd.status === "error")
        s.errors++;
      if (tfd.name.startsWith("mcp_")) {
        const server = tfd.name.split("_")[1];
        if (server)
          s.mcpsUsed.add(server);
      }
    } else if (b.type === 2 && (b.text || "").length > 0) {
      s.messages++;
    }
  }
  for (const uri of Object.keys(cd.originalFileStates || {})) {
    const p = fileUriToPath(uri);
    if (p)
      s.filesEdited.add(p);
  }
  for (const f of cd.newlyCreatedFiles || [])
    s.filesEdited.add(f);
  const convo = bubblesOrdered.filter((b) => (b.type === 1 || b.type === 2) && (b.text || "").length > 0);
  for (let i = 0;i < convo.length; i++) {
    const b = convo[i];
    const text = b.text || "";
    const wc = text.split(/\s+/).filter(Boolean).length;
    const ts = interpolateTurnTs(s.start.getTime(), s.end.getTime(), i, convo.length);
    if (b.type === 1) {
      s.userTurns++;
      const intent = classifyIntent(text);
      s.intents[intent] = (s.intents[intent] || 0) + 1;
      s.promptWords.push(wc);
      if (wc < 30 && TEACHER_RE.test(text))
        s.teacherMoments++;
      if (FRUSTRATION_RE.test(text))
        s.frustrationSpikes++;
      s.prompts.push({ ts, text, wordCount: wc });
    } else {
      s.responses.push({ ts, text, wordCount: wc });
    }
  }
  return s;
}
function newCursorSweepState() {
  return { dataVersion: -1, lastSeen: new Map };
}
function sweepCursor(sessions, state, since, root = cursorDataRoot()) {
  const touched = new Set;
  const gdb = globalDb(root);
  if (!fs3.existsSync(gdb))
    return touched;
  const dv = sqliteDataVersion(gdb);
  if (dv > 0 && dv === state.dataVersion)
    return touched;
  const userBlob = sqliteOne(gdb, "SELECT value FROM ItemTable WHERE key = 'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser'");
  let aiSettings = {};
  if (userBlob) {
    try {
      aiSettings = JSON.parse(userBlob).aiSettings || {};
    } catch {}
  }
  const cidToCwd = buildComposerIdToCwd(root);
  const composerRows = sqliteQuery(gdb, "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'");
  const sinceMs = since.getTime();
  for (const { key, value } of composerRows) {
    try {
      const cid = key.slice("composerData:".length);
      if (!isSafeCursorId(cid))
        continue;
      let cd;
      try {
        cd = JSON.parse(value);
      } catch {
        continue;
      }
      cd.composerId = cid;
      const headers = cd.fullConversationHeadersOnly || [];
      if ((!cd.status || cd.status === "none") && headers.length === 0)
        continue;
      const createdAt = cd.createdAt || 0;
      const lastUpdatedAt = cd.lastUpdatedAt || createdAt;
      if (!createdAt)
        continue;
      if (lastUpdatedAt < sinceMs)
        continue;
      const prevSeen = state.lastSeen.get(cid) || 0;
      if (lastUpdatedAt <= prevSeen)
        continue;
      const cwd = cidToCwd.get(cid);
      if (!cwd)
        continue;
      const DAY = 24 * 60 * 60 * 1000;
      if (lastUpdatedAt - createdAt > DAY)
        cd.lastUpdatedAt = createdAt + DAY;
      const bubbleRows = sqliteQuery(gdb, `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:${cid}:%'`);
      const byId = new Map;
      const prefix = `bubbleId:${cid}:`;
      for (const { key: bk, value: bv } of bubbleRows) {
        if (!bv)
          continue;
        const bid = bk.slice(prefix.length);
        try {
          byId.set(bid, JSON.parse(bv));
        } catch {}
      }
      const bubblesOrdered = [];
      for (const h of headers) {
        const b = byId.get(h.bubbleId);
        if (b)
          bubblesOrdered.push(b);
      }
      const bubblesAll = Array.from(byId.values());
      const model = pickModel(cd, aiSettings);
      const s = buildCursorSessionState(cd, bubblesOrdered, bubblesAll, cwd, model);
      sessions.set(cid, s);
      state.lastSeen.set(cid, lastUpdatedAt);
      touched.add(cid);
    } catch (e) {
      console.error(`pella cursor: skipped composer — ${e.message}`);
    }
  }
  state.dataVersion = dv;
  return touched;
}
function buildComposerIdToCwd(root) {
  const out = new Map;
  const wsRoot = workspaceStorageDir(root);
  if (!fs3.existsSync(wsRoot))
    return out;
  let entries;
  try {
    entries = fs3.readdirSync(wsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    const dir = path2.join(wsRoot, entry.name);
    const wj = path2.join(dir, "workspace.json");
    const sdb = path2.join(dir, "state.vscdb");
    if (!fs3.existsSync(wj) || !fs3.existsSync(sdb))
      continue;
    let folder = null;
    try {
      const j = JSON.parse(fs3.readFileSync(wj, "utf8"));
      folder = fileUriToPath(j.folder || "");
    } catch {
      continue;
    }
    if (!folder)
      continue;
    const v = sqliteOne(sdb, "SELECT value FROM ItemTable WHERE key = 'composer.composerData'");
    if (!v)
      continue;
    let parsed;
    try {
      parsed = JSON.parse(v);
    } catch {
      continue;
    }
    for (const c of parsed.allComposers || []) {
      if (c.composerId)
        out.set(c.composerId, folder);
    }
  }
  return out;
}

// src/parsers/walk.ts
import fs4 from "node:fs";
import path3 from "node:path";
function* walkJsonl(dir, pattern) {
  if (!fs4.existsSync(dir))
    return;
  for (const entry of fs4.readdirSync(dir, { withFileTypes: true })) {
    const full = path3.join(dir, entry.name);
    if (entry.isDirectory())
      yield* walkJsonl(full, pattern);
    else if (entry.isFile() && pattern.test(entry.name))
      yield full;
  }
}

// src/config.ts
var COLLECTOR_VERSION = "0.0.8";

// src/upload.ts
var BATCH = 200;
async function uploadBatch(opts) {
  const log = opts.log ?? ((m) => console.log(m));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result = { inserted: 0, promptsInserted: 0, responsesInserted: 0, rejected: 0, batches: 0, httpErrors: 0 };
  if (opts.sessions.length === 0) {
    log(`[${opts.source}] no sessions`);
    return result;
  }
  const promptsBySid = new Map;
  for (const p of opts.prompts) {
    const arr = promptsBySid.get(p.externalSessionId);
    if (arr)
      arr.push(p);
    else
      promptsBySid.set(p.externalSessionId, [p]);
  }
  const responsesBySid = new Map;
  for (const r of opts.responses) {
    const arr = responsesBySid.get(r.externalSessionId);
    if (arr)
      arr.push(r);
    else
      responsesBySid.set(r.externalSessionId, [r]);
  }
  for (let i = 0;i < opts.sessions.length; i += BATCH) {
    const chunk = opts.sessions.slice(i, i + BATCH);
    const chunkPrompts = [];
    const chunkResponses = [];
    for (const sess of chunk) {
      const pl = promptsBySid.get(sess.externalSessionId);
      if (pl)
        chunkPrompts.push(...pl);
      const rl = responsesBySid.get(sess.externalSessionId);
      if (rl)
        chunkResponses.push(...rl);
    }
    const payload = {
      source: opts.source,
      collectorVersion: COLLECTOR_VERSION,
      sessions: chunk,
      prompts: chunkPrompts,
      responses: chunkResponses
    };
    try {
      const r = await fetchImpl(`${opts.url}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      result.batches++;
      if (!r.ok) {
        result.httpErrors++;
        log(`[${opts.source}] batch ${i}: HTTP ${r.status} ${JSON.stringify(j)}`);
        continue;
      }
      result.inserted += j.inserted || 0;
      result.promptsInserted += j.promptsInserted || 0;
      result.responsesInserted += j.responsesInserted || 0;
      result.rejected += j.rejected?.length || 0;
      log(`[${opts.source}] batch ${i}-${i + chunk.length}: inserted ${j.inserted}, prompts ${j.promptsInserted || 0}, responses ${j.responsesInserted || 0}, rejected ${j.rejected?.length || 0}`);
    } catch (e) {
      result.httpErrors++;
      log(`[${opts.source}] batch ${i}: fetch failed — ${e.message}`);
    }
  }
  log(`[${opts.source}] total inserted ${result.inserted}, prompts ${result.promptsInserted}, responses ${result.responsesInserted}, rejected ${result.rejected}`);
  return result;
}

// src/commands/runOnce.ts
async function runOnce(opts) {
  const HOME = os2.homedir();
  const since = opts.since ?? new Date(0);
  console.log(`pellametric collector → ${opts.url}`);
  console.log(`since: ${since.toISOString().slice(0, 10)}`);
  const repoCache = makeRepoCache();
  const resolver = (cwd) => resolveRepo(cwd, repoCache);
  const claudeSessions = new Map;
  const claudeRoot = path4.join(HOME, ".claude", "projects");
  for (const file of walkJsonl(claudeRoot, /\.jsonl$/)) {
    ingestClaudeFileSlice(claudeSessions, file, 0, since);
  }
  const claudeFinal = finalizeSessions(claudeSessions, resolver);
  console.log(`claude sessions in-scope: ${claudeFinal.sessions.length} (prompts: ${claudeFinal.prompts.length}, responses: ${claudeFinal.responses.length})`);
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "claude",
    sessions: claudeFinal.sessions,
    prompts: claudeFinal.prompts,
    responses: claudeFinal.responses
  });
  const codexSessions = new Map;
  const codexCtx = new Map;
  const codexRoots = [path4.join(HOME, ".codex", "sessions"), path4.join(HOME, ".codex", "archived_sessions")];
  for (const root of codexRoots) {
    for (const file of walkJsonl(root, /^rollout-.*\.jsonl$/)) {
      ingestCodexFileSlice(codexSessions, file, 0, codexCtx, since);
    }
  }
  const codexFinal = finalizeSessions(codexSessions, resolver);
  console.log(`codex sessions in-scope: ${codexFinal.sessions.length} (prompts: ${codexFinal.prompts.length}, responses: ${codexFinal.responses.length})`);
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "codex",
    sessions: codexFinal.sessions,
    prompts: codexFinal.prompts,
    responses: codexFinal.responses
  });
  const cursorSessions = new Map;
  sweepCursor(cursorSessions, newCursorSweepState(), since);
  const cursorFinal = finalizeSessions(cursorSessions, resolver);
  console.log(`cursor sessions in-scope: ${cursorFinal.sessions.length} (prompts: ${cursorFinal.prompts.length}, responses: ${cursorFinal.responses.length})`);
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "cursor",
    sessions: cursorFinal.sessions,
    prompts: cursorFinal.prompts,
    responses: cursorFinal.responses
  });
}

// src/index.ts
var args = parseArgs(process.argv.slice(2));
var TOKEN = args.token || process.env.PELLA_TOKEN;
var DEFAULT_URL = "https://pellametric.com";
var URL = (args.url || process.env.PELLA_URL || DEFAULT_URL).replace(/\/$/, "");
var SINCE = args.since ? new Date(args.since) : new Date(0);
if (!TOKEN) {
  console.error("Missing --token");
  process.exit(1);
}
runOnce({ url: URL, token: TOKEN, since: SINCE }).catch((e) => {
  console.error(e);
  process.exit(1);
});
function parseArgs(argv) {
  const out = {};
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}
