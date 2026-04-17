import { z } from "zod";
import { Fidelity } from "./common";

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
