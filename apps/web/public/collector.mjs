#!/usr/bin/env node

// src/commands/runOnce.ts
import os from "node:os";
import path3 from "node:path";

// src/accumulator.ts
function finalizeSessions(sessions, resolveRepoFn, only) {
  const out = [];
  const prompts = [];
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
  }
  return { sessions: out, prompts };
}
function toWire(s, info) {
  const pw = s.promptWords.slice().sort((a, b) => a - b);
  const median = pw.length ? pw[Math.floor(pw.length / 2)] : 0;
  const p95 = pw.length ? pw[Math.min(pw.length - 1, Math.floor(pw.length * 0.95))] : 0;
  return {
    externalSessionId: s.sid,
    repo: `${info.owner}/${info.repo}`,
    cwd: s.cwd,
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
    prompts: []
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
import fs from "node:fs";
function readNewLines(absPath, startOffset) {
  let stat;
  try {
    stat = fs.statSync(absPath);
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
    fd = fs.openSync(absPath, "r");
    let total = 0;
    while (total < len) {
      const read = fs.readSync(fd, buf, total, len - total, startOffset + total);
      if (read <= 0)
        break;
      total += read;
    }
    fd = (fs.closeSync(fd), null);
  } catch {
    if (fd !== null)
      try {
        fs.closeSync(fd);
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
    if (content.some((c) => c && typeof c === "object" && c.type === "text")) {
      s.messages++;
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

// src/parsers/repo.ts
import fs2 from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
function makeRepoCache() {
  return new Map;
}
function parseGithubRemote(url) {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!m)
    return null;
  return { owner: m[1], repo: m[2] };
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
    if (fs2.existsSync(path.join(cur, ".git"))) {
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
    const url = execSync(`git -C "${root}" remote get-url origin`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const info = parseGithubRemote(url);
    cache.set(cwd, info);
    return info;
  } catch {
    cache.set(cwd, null);
    return null;
  }
}

// src/parsers/walk.ts
import fs3 from "node:fs";
import path2 from "node:path";
function* walkJsonl(dir, pattern) {
  if (!fs3.existsSync(dir))
    return;
  for (const entry of fs3.readdirSync(dir, { withFileTypes: true })) {
    const full = path2.join(dir, entry.name);
    if (entry.isDirectory())
      yield* walkJsonl(full, pattern);
    else if (entry.isFile() && pattern.test(entry.name))
      yield full;
  }
}

// src/upload.ts
var COLLECTOR_VERSION = "0.0.2";
var BATCH = 200;
async function uploadBatch(opts) {
  const log = opts.log ?? ((m) => console.log(m));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const result = { inserted: 0, promptsInserted: 0, rejected: 0, batches: 0, httpErrors: 0 };
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
  for (let i = 0;i < opts.sessions.length; i += BATCH) {
    const chunk = opts.sessions.slice(i, i + BATCH);
    const chunkPrompts = [];
    for (const sess of chunk) {
      const list = promptsBySid.get(sess.externalSessionId);
      if (list)
        chunkPrompts.push(...list);
    }
    const payload = {
      source: opts.source,
      collectorVersion: COLLECTOR_VERSION,
      sessions: chunk,
      prompts: chunkPrompts
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
      result.rejected += j.rejected?.length || 0;
      log(`[${opts.source}] batch ${i}-${i + chunk.length}: inserted ${j.inserted}, prompts ${j.promptsInserted || 0}, rejected ${j.rejected?.length || 0}`);
    } catch (e) {
      result.httpErrors++;
      log(`[${opts.source}] batch ${i}: fetch failed — ${e.message}`);
    }
  }
  log(`[${opts.source}] total inserted ${result.inserted}, prompts ${result.promptsInserted}, rejected ${result.rejected}`);
  return result;
}

// src/commands/runOnce.ts
async function runOnce(opts) {
  const HOME = os.homedir();
  const since = opts.since ?? new Date(0);
  console.log(`pella-metrics collector → ${opts.url}`);
  console.log(`since: ${since.toISOString().slice(0, 10)}`);
  const repoCache = makeRepoCache();
  const resolver = (cwd) => resolveRepo(cwd, repoCache);
  const claudeSessions = new Map;
  const claudeRoot = path3.join(HOME, ".claude", "projects");
  for (const file of walkJsonl(claudeRoot, /\.jsonl$/)) {
    ingestClaudeFileSlice(claudeSessions, file, 0, since);
  }
  const claudeFinal = finalizeSessions(claudeSessions, resolver);
  console.log(`claude sessions in-scope: ${claudeFinal.sessions.length} (prompts: ${claudeFinal.prompts.length})`);
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "claude",
    sessions: claudeFinal.sessions,
    prompts: claudeFinal.prompts
  });
  const codexSessions = new Map;
  const codexCtx = new Map;
  const codexRoots = [path3.join(HOME, ".codex", "sessions"), path3.join(HOME, ".codex", "archived_sessions")];
  for (const root of codexRoots) {
    for (const file of walkJsonl(root, /^rollout-.*\.jsonl$/)) {
      ingestCodexFileSlice(codexSessions, file, 0, codexCtx, since);
    }
  }
  const codexFinal = finalizeSessions(codexSessions, resolver);
  console.log(`codex sessions in-scope: ${codexFinal.sessions.length} (prompts: ${codexFinal.prompts.length})`);
  await uploadBatch({
    url: opts.url,
    token: opts.token,
    source: "codex",
    sessions: codexFinal.sessions,
    prompts: codexFinal.prompts
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
