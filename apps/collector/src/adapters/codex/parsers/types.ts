/**
 * Raw JSONL shapes emitted by the Codex CLI to
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<id>.jsonl`.
 *
 * Field drift is expected; every property is optional and the parser falls
 * back to `event_msg.type` discrimination rather than rigid typing.
 *
 * Source-of-truth reference: Codex CLI session format (developers.openai.com).
 */

export interface RawCodexLine {
  /** Monotonically-ordered wall-clock timestamp, ISO 8601. */
  timestamp?: string;
  /** Session/rollout id (stable for the whole file). */
  session_id?: string;
  /** Opaque per-turn id the CLI emits; not every event has one. */
  turn_id?: string;
  /** Discriminator container — the CLI wraps every event here. */
  event_msg?: RawCodexEventMsg;
  /** Some rollout files emit bare records without `event_msg`; we capture the type too. */
  type?: string;
  /** Payload mirrored at the top level for bare records. */
  payload?: RawCodexPayload;
}

export interface RawCodexEventMsg {
  type?: string;
  payload?: RawCodexPayload;
}

/**
 * `token_count` events carry cumulative totals for the rollout so far.
 * Per-turn deltas are derived by subtracting the previous cumulative snapshot
 * (D17 firstTryRate + dollar-accuracy fix, per CLAUDE.md Adapter Matrix).
 */
export interface RawCodexPayload {
  type?: string;
  model?: string;

  // token_count cumulative fields (Codex CLI shape — snake_case).
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  total_tokens?: number;

  // exec_command_* payloads.
  command?: string;
  cwd?: string;
  exit_code?: number;
  stdout_bytes?: number;
  stderr_bytes?: number;
  duration_ms?: number;

  // patch_apply_* payloads.
  success?: boolean;
  path?: string;
  hunk_count?: number;

  // agent_message / user_message.
  role?: "user" | "assistant" | "system";
  content?: unknown;
  finish_reason?: string;
}

export type CodexEventKind =
  | "session_start"
  | "session_end"
  | "token_count"
  | "agent_message"
  | "user_message"
  | "exec_command_start"
  | "exec_command_end"
  | "patch_apply_start"
  | "patch_apply_end";
