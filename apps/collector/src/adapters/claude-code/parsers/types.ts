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
  /**
   * Message payload.
   * - Fixture format: `type==="message"`, with `role` and a string `content`.
   * - Real format (`~/.claude/projects/**.jsonl`): `type` is one of
   *   `"user" | "assistant" | "system"` at top level, and `content` is either
   *   a string OR an array of typed blocks (`thinking`, `text`, `tool_use`,
   *   `tool_result`) — see `RawClaudeContentBlock`.
   */
  message?: {
    role?: "user" | "assistant" | "system";
    content?: string | RawClaudeContentBlock[] | unknown;
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

/**
 * Content block on `message.content[]` in the real Claude Code JSONL format.
 * Assistant messages carry `thinking | text | tool_use`; user messages that
 * are tool-result replies carry `tool_result` blocks.
 */
export interface RawClaudeContentBlock {
  type?: string;
  /** `tool_use` block */
  name?: string;
  input?: unknown;
  id?: string;
  /** `tool_result` block */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}
