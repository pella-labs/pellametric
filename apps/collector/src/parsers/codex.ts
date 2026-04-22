import type { SessionMap } from "../types";
import { newSessionState } from "../types";
import { classifyIntent, FRUSTRATION_RE, TEACHER_RE } from "./intent";
import { readNewLines } from "./slice";

/**
 * Per-file context for Codex rollout files. Each rollout-*.jsonl
 * starts with a single `session_meta` line carrying the session id and
 * cwd — subsequent lines reference neither. When we read a file in
 * chunks across ticks we need to remember the (sid, cwd) past that
 * first line, so the fold function can keep routing events to the
 * right session.
 */
export interface CodexFileCtx {
  sid: string | null;
  cwd: string;
}

export type CodexFileCtxMap = Map<string, CodexFileCtx>;

export function makeCodexCtx(): CodexFileCtx {
  return { sid: null, cwd: "" };
}

function foldCodexLine(
  sessions: SessionMap,
  line: string,
  ctx: CodexFileCtx,
  since: Date,
): string | null {
  if (!line) return null;
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const ts = d.timestamp ? new Date(d.timestamp) : null;
  if (ts && ts < since) return null;
  const t = d.type;
  const p = d.payload || {};

  if (t === "session_meta") {
    ctx.sid = p.id ?? null;
    ctx.cwd = p.cwd || "";
    if (!ctx.sid) return null;
    let s = sessions.get(ctx.sid);
    if (!s) {
      s = newSessionState(ctx.sid, ctx.cwd, false, "codex");
      sessions.set(ctx.sid, s);
    } else if (!s.cwd && ctx.cwd) {
      s.cwd = ctx.cwd;
    }
    if (ts) {
      if (!s.start || ts < s.start) s.start = ts;
      if (!s.end || ts > s.end) s.end = ts;
    }
    return ctx.sid;
  }

  if (!ctx.sid) return null;
  const s = sessions.get(ctx.sid);
  if (!s) return null;
  if (ts) {
    if (!s.start || ts < s.start) s.start = ts;
    if (!s.end || ts > s.end) s.end = ts;
  }

  if (t === "event_msg" && p.type === "token_count" && p.info?.total_token_usage) {
    // OpenAI's `input_tokens` is the TOTAL input and `cached_input_tokens`
    // is a subset of it. Normalize to Anthropic's disjoint semantics
    // (tokensIn = non-cached input) so downstream cost/cache-hit math
    // is consistent across sources.
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
    const raw: string = p.message || "";
    // The Codex IDE extension wraps real prompts in a context block;
    // the user's actual prompt sits under a "## My request for Codex:"
    // header. Strip the wrapper when present.
    const trimmed = raw.replace(/^\s+/, "");
    let text = raw;
    if (
      trimmed.startsWith("# Context from my IDE setup:") ||
      trimmed.startsWith("# Files mentioned by the user:")
    ) {
      const marker = trimmed.indexOf("## My request for Codex:");
      text = marker >= 0 ? trimmed.slice(marker + "## My request for Codex:".length).trim() : "";
    }
    if (text) {
      s.userTurns++;
      const intent = classifyIntent(text);
      s.intents[intent] = (s.intents[intent] || 0) + 1;
      const wc = text.split(/\s+/).filter(Boolean).length;
      s.promptWords.push(wc);
      if (wc < 30 && TEACHER_RE.test(text)) s.teacherMoments++;
      if (FRUSTRATION_RE.test(text)) s.frustrationSpikes++;
      if (ts) s.prompts.push({ ts, text, wordCount: wc });
    }
    return ctx.sid;
  }

  if (t === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call")) {
    const name = p.name || "unknown";
    s.toolHist[name] = (s.toolHist[name] || 0) + 1;
    // Modern Codex applies patches via custom_tool_call apply_patch.
    // Parse the patch header markers to extract edited paths;
    // patch_apply_end is legacy.
    if (p.type === "custom_tool_call" && name === "apply_patch" && typeof p.input === "string") {
      const re = /^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm;
      for (const m of p.input.matchAll(re)) s.filesEdited.add(m[1].trim());
    }
    return ctx.sid;
  }

  if (t === "response_item" && p.type === "message" && p.role === "assistant") {
    s.messages++;
    // Extract the assistant text reply (Codex stores it as
    // content:[{type:"output_text", text}] — occasionally several items).
    const content = Array.isArray(p.content) ? p.content : [];
    const textParts = content
      .filter((c: any) => c && typeof c === "object" && typeof c.text === "string")
      .map((c: any) => c.text as string);
    if (textParts.length > 0 && ts) {
      const joined = textParts.join("\n\n").trim();
      if (joined) {
        const wc = joined.split(/\s+/).filter(Boolean).length;
        s.responses.push({ ts, text: joined, wordCount: wc });
      }
    }
    return ctx.sid;
  }

  if (
    t === "response_item" &&
    (p.type === "function_call_output" || p.type === "custom_tool_call_output")
  ) {
    const out = p.output;
    if (typeof out === "string" && out.startsWith("{")) {
      try {
        const parsed = JSON.parse(out);
        const ec = parsed?.metadata?.exit_code;
        if (typeof ec === "number" && ec !== 0) s.errors++;
      } catch {
        /* ignore malformed */
      }
    }
    return ctx.sid;
  }

  if (t === "event_msg" && p.type === "patch_apply_end") {
    const changes = p.changes || {};
    for (const fp of Object.keys(changes)) s.filesEdited.add(fp);
    return ctx.sid;
  }

  if (t === "event_msg" && p.type === "error") {
    s.errors++;
    return ctx.sid;
  }

  return null;
}

/**
 * Read new lines from a Codex rollout file starting at `startOffset`,
 * fold each into `sessions`, and return the new byte cursor plus the
 * set of sids touched this read. `ctxMap` carries the (sid, cwd) for
 * each file across ticks so incremental reads (past session_meta)
 * still route correctly.
 */
export function ingestCodexFileSlice(
  sessions: SessionMap,
  absPath: string,
  startOffset: number,
  ctxMap: CodexFileCtxMap,
  since: Date,
): { endOffset: number; fileSize: number; touched: Set<string> } {
  const touched = new Set<string>();
  let ctx = ctxMap.get(absPath);
  if (!ctx) {
    ctx = makeCodexCtx();
    ctxMap.set(absPath, ctx);
  }
  const { lines, bytesConsumed, fileSize } = readNewLines(absPath, startOffset);
  for (const line of lines) {
    const sid = foldCodexLine(sessions, line, ctx, since);
    if (sid) touched.add(sid);
  }
  return { endOffset: bytesConsumed, fileSize, touched };
}
