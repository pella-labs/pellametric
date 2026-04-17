import { assertRole, type Ctx } from "../auth";
import type {
  GetSessionInput,
  GetSessionOutput,
  ListSessionsInput,
  ListSessionsOutput,
  SessionListItem,
  SessionSummary,
} from "../schemas/session";
import type { Window } from "../schemas/common";

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

/**
 * Session list for the `/sessions` view. Fixture-backed until Workstream D's
 * `dev_session_summary` MV lands. The list shape deliberately omits any
 * prompt-adjacent fields; those only appear in `getSession` under a reveal
 * token (contract 07 §Reveal).
 *
 * Deterministic per `(org_id, team_id?, engineer_id?, source?, window)` so the
 * same query returns the same list every render until real data flows.
 */
export async function listSessions(
  ctx: Ctx,
  input: ListSessionsInput,
): Promise<ListSessionsOutput> {
  assertRole(ctx, ["engineer", "manager", "admin", "auditor", "viewer"]);

  const windowDays = WINDOW_DAYS[input.window];
  const seed = hash(
    [
      ctx.tenant_id,
      input.team_id ?? "_",
      input.engineer_id ?? "_",
      input.source ?? "_",
      input.window,
    ].join("|"),
  );
  const rowCount = Math.min(input.limit, 240);
  const sessions: SessionListItem[] = [];

  const sources = input.source
    ? [input.source]
    : ([
        "claude-code",
        "codex",
        "cursor",
        "continue",
        "opencode",
      ] as const satisfies readonly SessionListItem["source"][]);

  const engineers = input.engineer_id
    ? [input.engineer_id]
    : ["dev-ada", "dev-lin", "dev-ren", "dev-sam", "dev-kai", "dev-vic"];

  const now = Date.UTC(2026, 3, 16, 18, 0, 0);
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  for (let i = 0; i < rowCount; i++) {
    const r = (n: number) => rand(seed + i * 7, n);
    const source =
      sources[Math.floor(r(1) * sources.length) % sources.length] ??
      "claude-code";
    const engineer =
      engineers[Math.floor(r(2) * engineers.length) % engineers.length] ??
      "dev-ada";
    const fidelity = fidelityFor(source, r(3));
    const estimated = source === "cursor" && r(4) < 0.35;
    const started = new Date(now - r(5) * windowMs);
    const durationS = 60 + Math.floor(r(6) * 50 * 60);
    const ended = new Date(started.getTime() + durationS * 1000);
    const input_tokens = Math.round(400 + r(7) * 9000);
    const output_tokens = Math.round(150 + r(8) * 3500);
    const cost_usd = estimated ? 0 : round2(0.05 + r(9) * 4.2);
    sessions.push({
      session_id: `sess_${seed.toString(16)}_${i.toString(16)}`,
      engineer_id: engineer,
      source,
      fidelity,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      duration_s: durationS,
      cost_usd,
      cost_estimated: estimated,
      input_tokens,
      output_tokens,
      accepted_edits: Math.round(r(10) * 8),
      tier: "B",
    });
  }

  sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));

  return {
    sessions,
    total: sessions.length,
    window: input.window,
  };
}

const WINDOW_DAYS: Record<Window, number> = { "7d": 7, "30d": 30, "90d": 90 };

function fidelityFor(
  source: SessionListItem["source"],
  r: number,
): SessionListItem["fidelity"] {
  if (source === "cursor") return "estimated";
  if (source === "opencode") return "post-migration";
  if (source === "codex") return r < 0.15 ? "estimated" : "full";
  return "full";
}

function rand(seed: number, n: number): number {
  const x = Math.sin(seed + n * 17.13) * 10000;
  return x - Math.floor(x);
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
