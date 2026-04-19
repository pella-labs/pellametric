import { z } from "zod";
import { DeveloperIdentity, Fidelity, Window } from "./common";

export const SessionSummary = z.object({
  session_id: z.string(),
  engineer_id: z.string(),
  source: z.enum([
    "claude-code",
    "codex",
    "cursor",
    "opencode",
    "continue",
    "vscode-generic",
    "goose",
    "copilot-ide",
    "copilot-cli",
    "cline",
    "roo",
    "kilo",
    "antigravity",
  ]),
  fidelity: Fidelity,
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
  cost_usd: z.number().nonnegative(),
  cost_estimated: z.boolean(),
  input_tokens: z.number().nonnegative(),
  output_tokens: z.number().nonnegative(),
  accepted_edits: z.number().nonnegative(),
  tier: z.enum(["A", "B", "C"]),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const GetSessionInput = z.object({ session_id: z.string() });
export type GetSessionInput = z.infer<typeof GetSessionInput>;

/**
 * Session detail. `prompt_text` is included ONLY when a valid reveal token is
 * present on `ctx` (per contract 07 §Reveal). Absent reveal → null with a
 * `consent_required` reason the UI renders via `<InsufficientData>`.
 */
export const GetSessionOutput = SessionSummary.extend({
  prompt_text: z.string().nullable(),
  redacted_reason: z.enum(["consent_required", "none"]).default("none"),
});
export type GetSessionOutput = z.infer<typeof GetSessionOutput>;

/** Input for the reveal mutation — see contract 07 §Reveal gesture. */
export const RevealInput = z.object({
  session_id: z.string(),
  reason: z.string().min(20, "Explain the reveal in at least 20 characters."),
});
export type RevealInput = z.infer<typeof RevealInput>;

export const RevealOutput = z.object({
  reveal_token: z.string(),
  /** Token validity (15 min per contract 07). */
  expires_at: z.string().datetime(),
});
export type RevealOutput = z.infer<typeof RevealOutput>;

/**
 * Row shape for the `/sessions` list view. Subset of `SessionSummary` — we
 * omit prompt-adjacent fields by construction so this type can never leak
 * prompt text into a list render.
 */
export const SessionListItem = SessionSummary.pick({
  session_id: true,
  engineer_id: true,
  source: true,
  fidelity: true,
  started_at: true,
  ended_at: true,
  cost_usd: true,
  cost_estimated: true,
  input_tokens: true,
  output_tokens: true,
  accepted_edits: true,
  tier: true,
}).extend({
  /** Duration in seconds; null while the session is still open. */
  duration_s: z.number().int().nonnegative().nullable(),
});
export type SessionListItem = z.infer<typeof SessionListItem>;

export const ListSessionsInput = z.object({
  window: Window.default("7d"),
  team_id: z.string().optional(),
  engineer_id: z.string().optional(),
  /** Single source filter; UI can widen later. */
  source: SessionSummary.shape.source.optional(),
  /** Max rows returned — virtualization handles larger lists. */
  limit: z.number().int().positive().max(5000).default(500),
  /**
   * Compliance-OFF demo opt-in: when true, the response carries an
   * `identities` map of `engineer_id → {name?, email, image?}`. Callers MUST
   * gate this on `isComplianceEnabled() === false`. Default false preserves
   * the existing wire shape for every current caller.
   */
  includeIdentities: z.boolean().optional(),
});
export type ListSessionsInput = z.infer<typeof ListSessionsInput>;

export const ListSessionsOutput = z.object({
  sessions: z.array(SessionListItem),
  /** Total matching rows; `sessions.length` may be <= this when capped by limit. */
  total: z.number().int().nonnegative(),
  window: Window,
  /**
   * Plaintext identity per `engineer_id`. Present ONLY when caller opted in
   * via `includeIdentities: true` (compliance-OFF demo path). Absent in the
   * default / compliance-ON path so the wire shape is unchanged for existing
   * callers.
   */
  identities: z.record(z.string(), DeveloperIdentity).optional(),
});
export type ListSessionsOutput = z.infer<typeof ListSessionsOutput>;
