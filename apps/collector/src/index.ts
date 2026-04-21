#!/usr/bin/env node
/**
 * pella-metrics collector
 *
 * Reads ~/.claude/projects/**\/*.jsonl and ~/.codex/sessions/**\/rollout-*.jsonl,
 * resolves each session's cwd to a git remote → owner/repo, and uploads to /api/ingest.
 *
 * Usage:
 *   pnpm start -- --token pm_xxx [--url http://localhost:3000] [--since 2026-03-01]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type { IngestPayload, IngestSession } from "@pella/shared";

const HOME = os.homedir();
const args = parseArgs(process.argv.slice(2));
const TOKEN = args.token || process.env.PELLA_TOKEN;
declare const __DEFAULT_URL__: string;
const DEFAULT_URL = typeof __DEFAULT_URL__ === "string" ? __DEFAULT_URL__ : "http://localhost:3000";
const URL = (args.url || process.env.PELLA_URL || DEFAULT_URL).replace(/\/$/, "");
const SINCE = args.since ? new Date(args.since) : new Date("2026-01-01");

if (!TOKEN) { console.error("Missing --token"); process.exit(1); }

type RepoInfo = { owner: string; repo: string };
const repoCache = new Map<string, RepoInfo | null>();

function resolveRepo(cwd: string): RepoInfo | null {
  if (!cwd) return null;
  if (repoCache.has(cwd)) return repoCache.get(cwd)!;
  // Strip agent worktrees
  let p = cwd.replace(/\/\.claude\/worktrees\/agent-[^/]+.*$/, "");
  // Walk up looking for .git
  let cur = p;
  let root: string | null = null;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) { root = cur; break; }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (!root) { repoCache.set(cwd, null); return null; }
  try {
    const url = execSync(`git -C "${root}" remote get-url origin`, { encoding: "utf8", stdio: ["ignore","pipe","ignore"] }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!m) { repoCache.set(cwd, null); return null; }
    const info = { owner: m[1], repo: m[2] };
    repoCache.set(cwd, info);
    return info;
  } catch {
    repoCache.set(cwd, null);
    return null;
  }
}

function* walkJsonl(dir: string, pattern: RegExp): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJsonl(full, pattern);
    else if (entry.isFile() && pattern.test(entry.name)) yield full;
  }
}

// -------- Claude Code parser --------
const TEACHER_RE = /\b(no|wrong|that'?s not|actually|instead|don'?t|undo|revert|not like that|nope)\b/i;
const FRUSTRATION_RE = /\b(fuck|shit|wtf|damn|ugh)\b|!{2,}|\b[A-Z]{4,}\b/;

function parseClaudeSessions(): IngestSession[] {
  const root = path.join(HOME, ".claude", "projects");
  const sessions = new Map<string, any>();
  for (const file of walkJsonl(root, /\.jsonl$/)) {
    try {
      const content = fs.readFileSync(file, "utf8");
      for (const line of content.split("\n")) {
        if (!line) continue;
        let d: any;
        try { d = JSON.parse(line); } catch { continue; }
        const sid = d.sessionId; if (!sid) continue;
        const ts = d.timestamp ? new Date(d.timestamp) : null;
        if (ts && ts < SINCE) continue;
        const cwd = d.cwd || "";
        let s = sessions.get(sid);
        if (!s) {
          s = {
            sid, cwd, start: ts, end: ts, isSidechain: !!d.isSidechain,
            tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0,
            messages: 0, userTurns: 0, errors: 0,
            filesEdited: new Set<string>(), toolHist: {} as Record<string,number>,
            skillsUsed: new Set<string>(), mcpsUsed: new Set<string>(),
            intents: {} as Record<string,number>, model: undefined,
            teacherMoments: 0, frustrationSpikes: 0, promptWords: [] as number[],
          };
          sessions.set(sid, s);
        }
        if (ts) {
          if (!s.start || ts < s.start) s.start = ts;
          if (!s.end || ts > s.end) s.end = ts;
        }
        if (d.type === "assistant") {
          const msg = d.message || {};
          const u = msg.usage || {};
          s.tokensIn += u.input_tokens || 0;
          s.tokensOut += u.output_tokens || 0;
          s.tokensCacheRead += u.cache_read_input_tokens || 0;
          s.tokensCacheWrite += u.cache_creation_input_tokens || 0;
          if (u && Object.keys(u).length) s.messages++;
          if (msg.model) s.model = msg.model;
          const content = Array.isArray(msg.content) ? msg.content : [];
          for (const c of content) {
            if (!c || typeof c !== "object") continue;
            if (c.type === "tool_use") {
              const name = c.name || "unknown";
              s.toolHist[name] = (s.toolHist[name] || 0) + 1;
              if (name === "Skill") s.skillsUsed.add(c.input?.skill || "unknown");
              if (name.startsWith("mcp__")) s.mcpsUsed.add(name.split("__")[1] || "unknown");
              if (["Edit","Write","NotebookEdit"].includes(name) && c.input?.file_path) {
                s.filesEdited.add(c.input.file_path);
              }
            }
          }
        } else if (d.type === "user") {
          const mc = d.message?.content;
          if (Array.isArray(mc)) {
            for (const p of mc) if (p?.type === "tool_result" && p.is_error) s.errors++;
          }
          const text = typeof d.message?.content === "string" ? d.message.content
                     : Array.isArray(d.message?.content) ? d.message.content.map((x:any) => x?.text || "").join("") : "";
          if (text && !text.startsWith("<local-command") && !text.startsWith("<command-name")) {
            s.userTurns++;
            const intent = classifyIntent(text);
            s.intents[intent] = (s.intents[intent] || 0) + 1;
            const wc = text.split(/\s+/).filter(Boolean).length;
            s.promptWords.push(wc);
            if (wc < 30 && TEACHER_RE.test(text)) s.teacherMoments++;
            if (FRUSTRATION_RE.test(text)) s.frustrationSpikes++;
          }
        }
      }
    } catch (e) { /* skip file */ }
  }
  return finalize(sessions);
}

// -------- Codex parser --------
function parseCodexSessions(): IngestSession[] {
  const sessions = new Map<string, any>();
  const roots = [
    path.join(HOME, ".codex", "sessions"),
    path.join(HOME, ".codex", "archived_sessions"),
  ];
  for (const root of roots) {
    for (const file of walkJsonl(root, /^rollout-.*\.jsonl$/)) {
      try {
        const content = fs.readFileSync(file, "utf8");
        let sid: string | null = null;
        let cwd = "";
        let s: any = null;
        let lastUsage: any = {};
        for (const line of content.split("\n")) {
          if (!line) continue;
          let d: any; try { d = JSON.parse(line); } catch { continue; }
          const ts = d.timestamp ? new Date(d.timestamp) : null;
          if (ts && ts < SINCE) continue;
          const t = d.type, p = d.payload || {};
          if (t === "session_meta") {
            sid = p.id; cwd = p.cwd || "";
            s = {
              sid, cwd, start: ts, end: ts, isSidechain: false,
              tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0,
              messages: 0, userTurns: 0, errors: 0,
              filesEdited: new Set<string>(), toolHist: {} as Record<string,number>,
              skillsUsed: new Set<string>(), mcpsUsed: new Set<string>(),
              intents: {} as Record<string,number>, model: "codex",
              teacherMoments: 0, frustrationSpikes: 0, promptWords: [] as number[],
            };
            sessions.set(sid!, s);
          } else if (!s) continue;
          else if (ts) { if (ts < s.start) s.start = ts; if (ts > s.end) s.end = ts; }
          if (t === "event_msg" && p.type === "token_count" && p.info?.total_token_usage) {
            lastUsage = p.info.total_token_usage;
            s.tokensIn = lastUsage.input_tokens || 0;
            s.tokensOut = lastUsage.output_tokens || 0;
            s.tokensCacheRead = lastUsage.cached_input_tokens || 0;
            s.tokensReasoning = lastUsage.reasoning_output_tokens || 0;
          } else if (t === "event_msg" && p.type === "user_message") {
            const text = p.message || "";
            if (text) {
              s.userTurns++;
              const intent = classifyIntent(text);
              s.intents[intent] = (s.intents[intent] || 0) + 1;
              const wc = text.split(/\s+/).filter(Boolean).length;
              s.promptWords.push(wc);
              if (wc < 30 && TEACHER_RE.test(text)) s.teacherMoments++;
              if (FRUSTRATION_RE.test(text)) s.frustrationSpikes++;
            }
          } else if (t === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call")) {
            const name = p.name || "unknown";
            s.toolHist[name] = (s.toolHist[name] || 0) + 1;
          } else if (t === "response_item" && p.type === "message" && p.role === "assistant") {
            s.messages++;
          } else if (t === "event_msg" && p.type === "patch_apply_end") {
            const changes = p.changes || {};
            for (const fp of Object.keys(changes)) s.filesEdited.add(fp);
          }
        }
      } catch { /* skip */ }
    }
  }
  return finalize(sessions);
}

function finalize(sessions: Map<string, any>): IngestSession[] {
  const out: IngestSession[] = [];
  for (const s of sessions.values()) {
    if (!s.start || !s.end || !s.cwd) continue;
    const info = resolveRepo(s.cwd);
    if (!info) continue;
    const intentTop = Object.entries(s.intents).sort((a:any,b:any) => b[1]-a[1])[0]?.[0];
    const pw: number[] = (s.promptWords || []).slice().sort((a:number,b:number) => a-b);
    const median = pw.length ? pw[Math.floor(pw.length/2)] : 0;
    const p95 = pw.length ? pw[Math.min(pw.length-1, Math.floor(pw.length*0.95))] : 0;
    out.push({
      externalSessionId: s.sid,
      repo: `${info.owner}/${info.repo}`,
      cwd: s.cwd,
      startedAt: new Date(s.start).toISOString(),
      endedAt: new Date(s.end).toISOString(),
      model: s.model,
      tokensIn: s.tokensIn, tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead, tokensCacheWrite: s.tokensCacheWrite || 0,
      tokensReasoning: s.tokensReasoning || 0,
      messages: s.messages, userTurns: s.userTurns, errors: s.errors,
      filesEdited: [...s.filesEdited],
      toolHist: s.toolHist,
      skillsUsed: [...s.skillsUsed],
      mcpsUsed: [...s.mcpsUsed],
      intentTop,
      isSidechain: s.isSidechain,
      teacherMoments: s.teacherMoments || 0,
      frustrationSpikes: s.frustrationSpikes || 0,
      promptWordsMedian: median,
      promptWordsP95: p95,
    });
  }
  return out;
}

function classifyIntent(text: string): string {
  const t = text.slice(0, 2000).trim();
  if (t.length < 40 && /^(sure|yes|yep|yeah|ok(ay)?|go|do it|continue|more|next|ship it|proceed|right|correct|good|perfect|ya|yup)\.?!?$/i.test(t)) return "approval";
  if (/\b(fix|bug|error|broken|crash|fail|wrong|issue|not working|doesn'?t work)\b/i.test(t)) return "bugfix";
  if (/\b(refactor|clean ?up|simplify|rename|extract|reorganize|consolidat|swap|replace|delete|remove|dedupe)\b/i.test(t)) return "refactor";
  if (/\b(add|build|create|implement|new|make|wire|setup|integrate|connect)\b/i.test(t)) return "feature";
  if (/\b(how|what|why|explain|show me|where is|tell me|can you|should i|check|verify|inspect|look at|understand)\b/i.test(t)) return "exploration";
  return "other";
}

function parseArgs(argv: string[]): Record<string,string> {
  const out: Record<string,string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i+1] && !argv[i+1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

async function upload(source: "claude" | "codex", sessions: IngestSession[]) {
  if (sessions.length === 0) { console.log(`[${source}] no sessions`); return; }
  const payload: IngestPayload = { source, collectorVersion: "0.0.1", sessions };
  const BATCH = 200;
  let inserted = 0, rejected = 0;
  for (let i = 0; i < sessions.length; i += BATCH) {
    const chunk = sessions.slice(i, i + BATCH);
    const r = await fetch(`${URL}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ ...payload, sessions: chunk }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { console.error(`[${source}] batch ${i}: ${r.status}`, j); continue; }
    inserted += j.inserted || 0;
    rejected += (j.rejected?.length || 0);
    console.log(`[${source}] batch ${i}-${i+chunk.length}: inserted ${j.inserted}, rejected ${j.rejected?.length || 0}`);
  }
  console.log(`[${source}] total inserted ${inserted}, rejected ${rejected}`);
}

(async () => {
  console.log(`pella-metrics collector → ${URL}`);
  console.log(`since: ${SINCE.toISOString().slice(0,10)}`);
  const claude = parseClaudeSessions();
  console.log(`claude sessions in-scope: ${claude.length}`);
  await upload("claude", claude);
  const codex = parseCodexSessions();
  console.log(`codex sessions in-scope: ${codex.length}`);
  await upload("codex", codex);
})().catch(e => { console.error(e); process.exit(1); });
