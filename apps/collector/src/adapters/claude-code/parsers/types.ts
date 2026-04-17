/**
 * Raw JSONL shapes emitted by Claude Code to `~/.claude/projects/<hash>/sessions/<ulid>.jsonl`.
 * These reflect the shape as of Claude Code v1.0.35; field drift is expected and
 * handled by making every property optional + a fail-loud `unknown` catch-all.
 *
 * Source-of-truth reference: pella-labs/pharos → src/claude.ts (read, then
 * reimplement per PRD D17 — do NOT vendor).
 */

export interface RawClaudeSessionLine {
  /** Anthropic API request id — the key for the max-per-field dedup (D17). */
  requestId?: string;
  /** Event kind tag; Claude Code uses a mix of "message", "tool_use", "tool_result", etc. */
  type?: string;
  /** Session id (ULID-ish). */
  sessionId?: string;
  /** Wall-clock timestamp, ISO 8601. */
  timestamp?: string;
  /** User-message payload when type==="message" && role==="user". */
  message?: {
    role?: "user" | "assistant" | "system";
    content?: unknown;
    usage?: RawClaudeUsage;
    model?: string;
    stop_reason?: string;
  };
  /** Tool-use payload when type==="tool_use". */
  toolUse?: {
    name?: string;
    input?: unknown;
    id?: string;
  };
  /** Tool-result payload when type==="tool_result". */
  toolResult?: {
    toolUseId?: string;
    content?: unknown;
    isError?: boolean;
    durationMs?: number;
  };
  /** Edit-proposal / decision. */
  editProposed?: {
    toolName?: string;
    hunkSha256?: string;
    filePathHash?: string;
  };
  editDecision?: {
    toolName?: string;
    hunkSha256?: string;
    filePathHash?: string;
    decision?: "accept" | "reject" | "modify";
    durationMs?: number;
  };
}

export interface RawClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
