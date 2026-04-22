#!/usr/bin/env node

// src/index.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
var HOME = os.homedir();
var args = parseArgs(process.argv.slice(2));
var TOKEN = args.token || process.env.PELLA_TOKEN;
var DEFAULT_URL = "https://pella-web-production.up.railway.app";
var URL = (args.url || process.env.PELLA_URL || DEFAULT_URL).replace(/\/$/, "");
var SINCE = args.since ? new Date(args.since) : new Date(0);
if (!TOKEN) {
  console.error("Missing --token");
  process.exit(1);
}
var repoCache = new Map;
function resolveRepo(cwd) {
  if (!cwd)
    return null;
  if (repoCache.has(cwd))
    return repoCache.get(cwd);
  let p = cwd.replace(/\/\.claude\/worktrees\/agent-[^/]+.*$/, "");
  let cur = p;
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
    repoCache.set(cwd, null);
    return null;
  }
  try {
    const url = execSync(`git -C "${root}" remote get-url origin`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!m) {
      repoCache.set(cwd, null);
      return null;
    }
    const info = { owner: m[1], repo: m[2] };
    repoCache.set(cwd, info);
    return info;
  } catch {
    repoCache.set(cwd, null);
    return null;
  }
}
function* walkJsonl(dir, pattern) {
  if (!fs.existsSync(dir))
    return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      yield* walkJsonl(full, pattern);
    else if (entry.isFile() && pattern.test(entry.name))
      yield full;
  }
}
var TEACHER_RE = /\b(no|wrong|that'?s not|actually|instead|don'?t|undo|revert|not like that|nope)\b/i;
var FRUSTRATION_RE = /\b(fuck|shit|wtf|damn|ugh)\b|!{2,}|\b[A-Z]{4,}\b/;
function parseClaudeSessions() {
  const root = path.join(HOME, ".claude", "projects");
  const sessions = new Map;
  for (const file of walkJsonl(root, /\.jsonl$/)) {
    try {
      const content = fs.readFileSync(file, "utf8");
      for (const line of content.split(`
`)) {
        if (!line)
          continue;
        let d;
        try {
          d = JSON.parse(line);
        } catch {
          continue;
        }
        const sid = d.sessionId;
        if (!sid)
          continue;
        const ts = d.timestamp ? new Date(d.timestamp) : null;
        if (ts && ts < SINCE)
          continue;
        const cwd = d.cwd || "";
        let s = sessions.get(sid);
        if (!s) {
          s = {
            sid,
            cwd,
            start: ts,
            end: ts,
            isSidechain: !!d.isSidechain,
            tokensIn: 0,
            tokensOut: 0,
            tokensCacheRead: 0,
            tokensCacheWrite: 0,
            messages: 0,
            userTurns: 0,
            errors: 0,
            filesEdited: new Set,
            toolHist: {},
            skillsUsed: new Set,
            mcpsUsed: new Set,
            intents: {},
            model: undefined,
            teacherMoments: 0,
            frustrationSpikes: 0,
            promptWords: [],
            prompts: []
          };
          sessions.set(sid, s);
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
          const content2 = Array.isArray(msg.content) ? msg.content : [];
          if (content2.some((c) => c && typeof c === "object" && c.type === "text")) {
            s.messages++;
          }
          for (const c of content2) {
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
        } else if (d.type === "user") {
          const mc = d.message?.content;
          if (Array.isArray(mc)) {
            for (const p of mc)
              if (p?.type === "tool_result" && p.is_error)
                s.errors++;
          }
          if (d.isSidechain)
            continue;
          const raw = typeof d.message?.content === "string" ? d.message.content : Array.isArray(d.message?.content) ? d.message.content.map((x) => x?.text || "").join("") : "";
          if (!raw || raw.startsWith("<local-command") || raw.startsWith("<command-name"))
            continue;
          let text = raw;
          if (raw.startsWith("Human: <info-msg>") || raw.startsWith("<info-msg>")) {
            const close = raw.indexOf("</info-msg>");
            text = close >= 0 ? raw.slice(close + "</info-msg>".length).trim() : "";
          } else if (raw.startsWith("Human: <")) {
            text = "";
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
        }
      }
    } catch (e) {}
  }
  return finalize(sessions);
}
function parseCodexSessions() {
  const sessions = new Map;
  const roots = [
    path.join(HOME, ".codex", "sessions"),
    path.join(HOME, ".codex", "archived_sessions")
  ];
  for (const root of roots) {
    for (const file of walkJsonl(root, /^rollout-.*\.jsonl$/)) {
      try {
        const content = fs.readFileSync(file, "utf8");
        let sid = null;
        let cwd = "";
        let s = null;
        let lastUsage = {};
        for (const line of content.split(`
`)) {
          if (!line)
            continue;
          let d;
          try {
            d = JSON.parse(line);
          } catch {
            continue;
          }
          const ts = d.timestamp ? new Date(d.timestamp) : null;
          if (ts && ts < SINCE)
            continue;
          const t = d.type, p = d.payload || {};
          if (t === "session_meta") {
            sid = p.id;
            cwd = p.cwd || "";
            s = {
              sid,
              cwd,
              start: ts,
              end: ts,
              isSidechain: false,
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
              model: "codex",
              teacherMoments: 0,
              frustrationSpikes: 0,
              promptWords: [],
              prompts: []
            };
            sessions.set(sid, s);
          } else if (!s)
            continue;
          else if (ts) {
            if (ts < s.start)
              s.start = ts;
            if (ts > s.end)
              s.end = ts;
          }
          if (t === "event_msg" && p.type === "token_count" && p.info?.total_token_usage) {
            lastUsage = p.info.total_token_usage;
            const ti = lastUsage.input_tokens || 0;
            const cached = lastUsage.cached_input_tokens || 0;
            s.tokensIn = Math.max(0, ti - cached);
            s.tokensOut = lastUsage.output_tokens || 0;
            s.tokensCacheRead = cached;
            s.tokensReasoning = lastUsage.reasoning_output_tokens || 0;
          } else if (t === "event_msg" && p.type === "user_message") {
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
          } else if (t === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call")) {
            const name = p.name || "unknown";
            s.toolHist[name] = (s.toolHist[name] || 0) + 1;
            if (p.type === "custom_tool_call" && name === "apply_patch" && typeof p.input === "string") {
              const re = /^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm;
              for (const m of p.input.matchAll(re))
                s.filesEdited.add(m[1].trim());
            }
          } else if (t === "response_item" && p.type === "message" && p.role === "assistant") {
            s.messages++;
          } else if (t === "response_item" && (p.type === "function_call_output" || p.type === "custom_tool_call_output")) {
            const out = p.output;
            if (typeof out === "string" && out.startsWith("{")) {
              try {
                const parsed = JSON.parse(out);
                const ec = parsed?.metadata?.exit_code;
                if (typeof ec === "number" && ec !== 0)
                  s.errors++;
              } catch {}
            }
          } else if (t === "event_msg" && p.type === "patch_apply_end") {
            const changes = p.changes || {};
            for (const fp of Object.keys(changes))
              s.filesEdited.add(fp);
          } else if (t === "event_msg" && p.type === "error") {
            s.errors++;
          }
        }
      } catch {}
    }
  }
  return finalize(sessions);
}
function finalize(sessions) {
  const out = [];
  const prompts = [];
  for (const s of sessions.values()) {
    if (!s.start || !s.end || !s.cwd)
      continue;
    const info = resolveRepo(s.cwd);
    if (!info)
      continue;
    const intentTop = Object.entries(s.intents).sort((a, b) => b[1] - a[1])[0]?.[0];
    const pw = (s.promptWords || []).slice().sort((a, b) => a - b);
    const median = pw.length ? pw[Math.floor(pw.length / 2)] : 0;
    const p95 = pw.length ? pw[Math.min(pw.length - 1, Math.floor(pw.length * 0.95))] : 0;
    out.push({
      externalSessionId: s.sid,
      repo: `${info.owner}/${info.repo}`,
      cwd: s.cwd,
      startedAt: new Date(s.start).toISOString(),
      endedAt: new Date(s.end).toISOString(),
      model: s.model,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead,
      tokensCacheWrite: s.tokensCacheWrite || 0,
      tokensReasoning: s.tokensReasoning || 0,
      messages: s.messages,
      userTurns: s.userTurns,
      errors: s.errors,
      filesEdited: [...s.filesEdited],
      toolHist: s.toolHist,
      skillsUsed: [...s.skillsUsed],
      mcpsUsed: [...s.mcpsUsed],
      intentTop,
      isSidechain: s.isSidechain,
      teacherMoments: s.teacherMoments || 0,
      frustrationSpikes: s.frustrationSpikes || 0,
      promptWordsMedian: median,
      promptWordsP95: p95
    });
    for (const p of s.prompts || []) {
      prompts.push({
        externalSessionId: s.sid,
        tsPrompt: new Date(p.ts).toISOString(),
        text: p.text,
        wordCount: p.wordCount
      });
    }
  }
  return { sessions: out, prompts };
}
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
async function upload(source, sessions, prompts) {
  if (sessions.length === 0) {
    console.log(`[${source}] no sessions`);
    return;
  }
  const BATCH = 200;
  const promptsBySid = new Map;
  for (const p of prompts) {
    const arr = promptsBySid.get(p.externalSessionId);
    if (arr)
      arr.push(p);
    else
      promptsBySid.set(p.externalSessionId, [p]);
  }
  let inserted = 0, rejected = 0, pInserted = 0;
  for (let i = 0;i < sessions.length; i += BATCH) {
    const chunk = sessions.slice(i, i + BATCH);
    const chunkPrompts = [];
    for (const sess of chunk) {
      const list = promptsBySid.get(sess.externalSessionId);
      if (list)
        chunkPrompts.push(...list);
    }
    const payload = { source, collectorVersion: "0.0.1", sessions: chunk, prompts: chunkPrompts };
    const r = await fetch(`${URL}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(payload)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[${source}] batch ${i}: ${r.status}`, j);
      continue;
    }
    inserted += j.inserted || 0;
    rejected += j.rejected?.length || 0;
    pInserted += j.promptsInserted || 0;
    console.log(`[${source}] batch ${i}-${i + chunk.length}: inserted ${j.inserted}, prompts ${j.promptsInserted || 0}, rejected ${j.rejected?.length || 0}`);
  }
  console.log(`[${source}] total inserted ${inserted}, prompts ${pInserted}, rejected ${rejected}`);
}
(async () => {
  console.log(`pella-metrics collector → ${URL}`);
  console.log(`since: ${SINCE.toISOString().slice(0, 10)}`);
  const claude = parseClaudeSessions();
  console.log(`claude sessions in-scope: ${claude.sessions.length} (prompts: ${claude.prompts.length})`);
  await upload("claude", claude.sessions, claude.prompts);
  const codex = parseCodexSessions();
  console.log(`codex sessions in-scope: ${codex.sessions.length} (prompts: ${codex.prompts.length})`);
  await upload("codex", codex.sessions, codex.prompts);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
