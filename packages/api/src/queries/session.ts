import { assertRole, type Ctx } from "../auth";
import type {
  GetSessionInput,
  GetSessionOutput,
  SessionSummary,
} from "../schemas/session";

/**
 * Session detail. `prompt_text` is included ONLY if the caller holds a valid
 * reveal token on `ctx.reveal_token` (per contract 07 §Reveal). Absent →
 * `null` with a `consent_required` reason that the UI renders via
 * `<InsufficientData reason="consent_required">` + a Reveal button.
 *
 * Fixture-backed: until Workstream D's `dev_session_summary` MV lands, we
 * generate a deterministic session record from the requested ID so the UI
 * renders end-to-end against the real output shape. Swap the body for a real
 * CH query when the MV is ready.
 */
export async function getSession(
  ctx: Ctx,
  input: GetSessionInput,
): Promise<GetSessionOutput> {
  // Engineers can read their own sessions. Managers/admins can read in-scope,
  // but NEVER get prompt_text without a reveal token.
  assertRole(ctx, ["engineer", "manager", "admin", "auditor", "viewer"]);

  const summary = buildFixtureSession(input.session_id);

  if (ctx.reveal_token) {
    // Once Walid's audit table + Redis token store are live, we verify the
    // reveal_token here and, on success, attach the real prompt_text.
    return {
      ...summary,
      prompt_text:
        "[reveal-token supplied, but fixture mode has no real prompt — wire up real ClickHouse read to populate]",
      redacted_reason: "none",
    };
  }

  return {
    ...summary,
    prompt_text: null,
    redacted_reason: "consent_required",
  };
}

function buildFixtureSession(sessionId: string): SessionSummary {
  const seed = hash(sessionId);
  const rand = (n: number) => {
    const x = Math.sin(seed + n) * 10000;
    return x - Math.floor(x);
  };
  const cost = round2(0.4 + rand(1) * 3.2);
  const started = new Date(Date.UTC(2026, 3, 15, 9, Math.floor(rand(2) * 60)));
  const ended = new Date(started.getTime() + 7 * 60_000);
  return {
    session_id: sessionId,
    engineer_id: "dev-sample-engineer",
    source: "claude-code",
    fidelity: "full",
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    cost_usd: cost,
    cost_estimated: false,
    input_tokens: Math.round(1200 + rand(3) * 6000),
    output_tokens: Math.round(400 + rand(4) * 2000),
    accepted_edits: Math.round(1 + rand(5) * 6),
    tier: "B",
  };
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
