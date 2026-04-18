/**
 * Raw JSONL shapes for Continue.dev dev-data telemetry (schema v0.2.0).
 *
 * Continue writes one file per stream under `~/.continue/dev_data/0.2.0/`:
 *   - chatInteraction.jsonl — one row per user↔assistant turn
 *   - tokensGenerated.jsonl — per-response token usage
 *   - editOutcome.jsonl     — accept/reject of suggested edits (D23 signal)
 *   - toolUsage.jsonl       — tool invocations + outcomes
 *
 * No OSS parser exists (D23). Field names reflect Continue's telemetry
 * instrumentation as observed in the wild (Continue v1.x). Every field is
 * optional + a fail-loud `unknown` catch-all so field drift in newer
 * Continue releases doesn't kill the adapter — a malformed row is logged
 * and skipped, never propagated.
 */

/** Common envelope fields present on every stream. */
interface ContinueLineBase {
  /** Continue's internal event name — e.g. "chat", "tokensGenerated". */
  eventName?: string;
  /** ISO 8601 wall-clock timestamp. */
  timestamp?: string;
  /** Chat / agent session id. May be absent for background events. */
  sessionId?: string;
  /** Integrations emit `userId` when telemetry is opted in. Ignored by us. */
  userId?: string;
}

export interface ContinueChatInteractionLine extends ContinueLineBase {
  /** Unique per user↔assistant turn. Acts as request id for joining to tokens. */
  interactionId?: string;
  /** Model string as configured in Continue, e.g. "claude-sonnet-4-5". */
  modelTitle?: string;
  modelProvider?: string;
  /** Present for the user side of the turn. Continue serializes role. */
  role?: "user" | "assistant" | "system";
  /** Number of raw tokens in the prompt as Continue counted them. */
  promptTokens?: number;
  generatedTokens?: number;
  /** Stop reason emitted by the underlying provider, if any. */
  finishReason?: string;
  /** Continue surfaces a short tag — e.g. "chat", "edit", "applyToFile". */
  interactionType?: string;
}

export interface ContinueTokensGeneratedLine extends ContinueLineBase {
  interactionId?: string;
  modelTitle?: string;
  modelProvider?: string;
  promptTokens?: number;
  generatedTokens?: number;
  /** Present only when Continue's provider reports cache metrics. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ContinueEditOutcomeLine extends ContinueLineBase {
  /** Unique id for the proposed edit hunk. */
  editId?: string;
  /** Links back to the chatInteraction that produced the edit. */
  interactionId?: string;
  /** True ⇒ user accepted (Tab / Apply). False ⇒ rejected / dismissed. */
  accepted?: boolean;
  /** Short tag: "manual", "inlineEdit", "applyToFile", "nextEdit". */
  editKind?: string;
  /** SHA-256 of the accepted hunk (D29 join key) — Continue hashes server-side. */
  hunkSha256?: string;
  /** Hash of the file path the edit targets — never a raw path (Tier B). */
  filePathHash?: string;
  /** Optional latency from proposal to decision. */
  decisionLatencyMs?: number;
  modelTitle?: string;
}

export interface ContinueToolUsageLine extends ContinueLineBase {
  interactionId?: string;
  toolCallId?: string;
  toolName?: string;
  /** "ok" | "error" | "denied". */
  status?: "ok" | "error" | "denied";
  durationMs?: number;
  /** Continue emits a short classifier string for the failure mode. Opaque to us. */
  errorKind?: string;
}

export type ContinueLine =
  | ContinueChatInteractionLine
  | ContinueTokensGeneratedLine
  | ContinueEditOutcomeLine
  | ContinueToolUsageLine;
