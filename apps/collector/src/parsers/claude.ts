import type { SessionMap } from "../types";
import { newSessionState } from "../types";
import { classifyIntent, FRUSTRATION_RE, TEACHER_RE } from "./intent";
import { readNewLines } from "./slice";

/**
 * Fold one Claude Code JSONL line into the session map. Returns the sid
 * if the line touched a session (so the caller can collect a "dirty"
 * set for incremental uploads), or null if the line was skipped.
 *
 * Line shapes we care about:
 *   { type: "assistant", sessionId, timestamp, cwd, isSidechain, message: { model, usage, content: [...] } }
 *   { type: "user",      sessionId, timestamp, cwd, isSidechain, message: { content: "..." | [...] } }
 */
export function foldClaudeLine(sessions: SessionMap, line: string, since: Date): string | null {
  if (!line) return null;
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  const sid = d.sessionId;
  if (!sid) return null;
  const ts = d.timestamp ? new Date(d.timestamp) : null;
  if (ts && ts < since) return null;
  const cwd = d.cwd || "";

  let s = sessions.get(sid);
  if (!s) {
    s = newSessionState(sid, cwd, !!d.isSidechain);
    sessions.set(sid, s);
  } else if (!s.cwd && cwd) {
    s.cwd = cwd;
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
    if (msg.model) s.model = msg.model;
    const content = Array.isArray(msg.content) ? msg.content : [];
    // Count a "message" only when the assistant emits a text reply, to
    // match Codex semantics ("response_item.message"). Tool-only steps
    // are tracked via toolHist.
    const textParts = content
      .filter((c: any) => c && typeof c === "object" && c.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text as string);
    if (textParts.length > 0) {
      s.messages++;
      // Only capture the assistant reply in the encrypted response log if
      // it's on the main chain — sub-agent replies belong to the sub-agent
      // conversation, which the user never saw directly.
      if (!d.isSidechain && ts) {
        const joined = textParts.join("\n\n").trim();
        if (joined) {
          const wc = joined.split(/\s+/).filter(Boolean).length;
          s.responses.push({ ts, text: joined, wordCount: wc });
        }
      }
    }
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "tool_use") {
        const name = c.name || "unknown";
        s.toolHist[name] = (s.toolHist[name] || 0) + 1;
        if (name === "Skill") s.skillsUsed.add(c.input?.skill || "unknown");
        if (name.startsWith("mcp__")) s.mcpsUsed.add(name.split("__")[1] || "unknown");
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
      for (const p of mc) if (p?.type === "tool_result" && p.is_error) s.errors++;
    }
    // Sub-agent user messages (isSidechain:true) are prompts the agent
    // wrote to itself — not real human turns. Skip for human-prompt
    // metrics (tokens/tools are still aggregated as real computation).
    if (d.isSidechain) return sid;
    const raw: string =
      typeof d.message?.content === "string"
        ? d.message.content
        : Array.isArray(d.message?.content)
          ? d.message.content.map((x: any) => x?.text || "").join("")
          : "";
    if (!raw || raw.startsWith("<local-command") || raw.startsWith("<command-name")) return sid;

    // "Human: <info-msg>…</info-msg>\n{real prompt}" wraps a real prompt
    // inside system metadata. Extract what's after the closing tag; drop
    // if nothing is left. Unknown `Human: <…` variants are skipped.
    let text = raw;
    if (raw.startsWith("Human: <info-msg>") || raw.startsWith("<info-msg>")) {
      const close = raw.indexOf("</info-msg>");
      text = close >= 0 ? raw.slice(close + "</info-msg>".length).trim() : "";
    } else if (raw.startsWith("Human: <")) {
      text = "";
    }
    if (!text) return sid;

    s.userTurns++;
    const intent = classifyIntent(text);
    s.intents[intent] = (s.intents[intent] || 0) + 1;
    const wc = text.split(/\s+/).filter(Boolean).length;
    s.promptWords.push(wc);
    if (wc < 30 && TEACHER_RE.test(text)) s.teacherMoments++;
    if (FRUSTRATION_RE.test(text)) s.frustrationSpikes++;
    if (ts) s.prompts.push({ ts, text, wordCount: wc });
    return sid;
  }

  return null;
}

/**
 * Read new lines from a Claude JSONL file starting at `startOffset`,
 * fold each into `sessions`, and return the new byte cursor plus the
 * set of sids touched this read.
 */
export function ingestClaudeFileSlice(
  sessions: SessionMap,
  absPath: string,
  startOffset: number,
  since: Date,
): { endOffset: number; fileSize: number; touched: Set<string> } {
  const touched = new Set<string>();
  const { lines, bytesConsumed, fileSize } = readNewLines(absPath, startOffset);
  for (const line of lines) {
    const sid = foldClaudeLine(sessions, line, since);
    if (sid) touched.add(sid);
  }
  return { endOffset: bytesConsumed, fileSize, touched };
}
