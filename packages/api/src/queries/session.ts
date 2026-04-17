import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import type { Window } from "../schemas/common";
import type {
  GetSessionInput,
  GetSessionOutput,
  ListSessionsInput,
  ListSessionsOutput,
  SessionListItem,
  SessionSummary,
} from "../schemas/session";

/**
 * Session detail. `prompt_text` is included ONLY if the caller holds a valid
 * reveal token on `ctx.reveal_token` (per contract 07 §Reveal). Absent →
 * `null` with a `consent_required` reason that the UI renders via
 * `<InsufficientData reason="consent_required">` + a Reveal button.
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads the canonical CH `events` table (aggregate roll
 *     up to a session row); prompt_text is fetched only when reveal_token is
 *     present.
 *   - Otherwise (default) a deterministic fixture so the UI renders without
 *     real data.
 */
export async function getSession(ctx: Ctx, input: GetSessionInput): Promise<GetSessionOutput> {
  // Engineers can read their own sessions. Managers/admins can read in-scope,
  // but NEVER get prompt_text without a reveal token.
  assertRole(ctx, ["engineer", "manager", "admin", "auditor", "viewer"]);
  if (useFixtures()) return getSessionFixture(ctx, input);
  return getSessionReal(ctx, input);
}

async function getSessionFixture(ctx: Ctx, input: GetSessionInput): Promise<GetSessionOutput> {
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
 * Real-branch ClickHouse read.
 *
 * EXPLAIN: Uses `events` ORDER BY (org_id, ts, engineer_id) — the session_id
 * filter is a secondary but bounded lookup; partition-pruning keeps it cheap.
 *
 * TIER-A ALLOWLIST: the summary aggregate never selects prompt_text /
 * tool_input / tool_output / messages / toolArgs / toolOutputs / fileContents /
 * diffs / filePaths / ticketIds / emails / realNames. Those live on
 * Tier-C-only rows and require a separate reveal read.
 */
async function getSessionReal(ctx: Ctx, input: GetSessionInput): Promise<GetSessionOutput> {
  const rows = await ctx.db.ch.query<{
    session_id: string;
    engineer_id: string;
    source: SessionSummary["source"];
    fidelity: SessionSummary["fidelity"];
    started_at: string;
    ended_at: string | null;
    cost_usd: number;
    cost_estimated: number;
    input_tokens: number;
    output_tokens: number;
    accepted_edits: number;
    tier: "A" | "B" | "C";
  }>(
    `SELECT
       session_id,
       any(engineer_id) AS engineer_id,
       any(source) AS source,
       any(fidelity) AS fidelity,
       min(ts) AS started_at,
       max(ts) AS ended_at,
       sum(cost_usd) AS cost_usd,
       max(cost_estimated) AS cost_estimated,
       sum(input_tokens) AS input_tokens,
       sum(output_tokens) AS output_tokens,
       sumIf(1, edit_decision = 'accept') AS accepted_edits,
       any(tier) AS tier
     FROM events
     WHERE org_id = {tenant_id:String}
       AND session_id = {session_id:String}
     GROUP BY session_id
     LIMIT 1`,
    { tenant_id: ctx.tenant_id, session_id: input.session_id },
  );

  const row = rows[0];
  if (!row) {
    return {
      session_id: input.session_id,
      engineer_id: "",
      source: "claude-code",
      fidelity: "full",
      started_at: new Date(0).toISOString(),
      ended_at: null,
      cost_usd: 0,
      cost_estimated: false,
      input_tokens: 0,
      output_tokens: 0,
      accepted_edits: 0,
      tier: "B",
      prompt_text: null,
      redacted_reason: "consent_required",
    };
  }

  const summary: SessionSummary = {
    session_id: row.session_id,
    engineer_id: row.engineer_id,
    source: row.source,
    fidelity: row.fidelity,
    started_at: new Date(row.started_at).toISOString(),
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    cost_usd: round2(Number(row.cost_usd)),
    cost_estimated: Number(row.cost_estimated) > 0,
    input_tokens: Number(row.input_tokens),
    output_tokens: Number(row.output_tokens),
    accepted_edits: Number(row.accepted_edits),
    tier: row.tier,
  };

  if (!ctx.reveal_token) {
    return { ...summary, prompt_text: null, redacted_reason: "consent_required" };
  }

  // With a reveal token we separately pull prompt_text from Tier-C rows only.
  // The token's validity + audit log is enforced upstream by the Reveal
  // mutation (contract 07 §Reveal).
  const promptRows = await ctx.db.ch.query<{ prompt_text: string | null }>(
    `SELECT prompt_text
       FROM events
      WHERE org_id = {tenant_id:String}
        AND session_id = {session_id:String}
        AND tier = 'C'
        AND prompt_text IS NOT NULL
      ORDER BY ts ASC
      LIMIT 1`,
    { tenant_id: ctx.tenant_id, session_id: input.session_id },
  );

  return {
    ...summary,
    prompt_text: promptRows[0]?.prompt_text ?? null,
    redacted_reason: promptRows[0]?.prompt_text ? "none" : "consent_required",
  };
}

/**
 * Session list for the `/sessions` view.
 *
 * The list shape deliberately omits any prompt-adjacent fields; those only
 * appear in `getSession` under a reveal token (contract 07 §Reveal).
 */
export async function listSessions(
  ctx: Ctx,
  input: ListSessionsInput,
): Promise<ListSessionsOutput> {
  assertRole(ctx, ["engineer", "manager", "admin", "auditor", "viewer"]);
  if (useFixtures()) return listSessionsFixture(ctx, input);
  return listSessionsReal(ctx, input);
}

async function listSessionsFixture(
  ctx: Ctx,
  input: ListSessionsInput,
): Promise<ListSessionsOutput> {
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
    const source = sources[Math.floor(r(1) * sources.length) % sources.length] ?? "claude-code";
    const engineer = engineers[Math.floor(r(2) * engineers.length) % engineers.length] ?? "dev-ada";
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

/**
 * Real-branch ClickHouse read.
 *
 * EXPLAIN: `events` ORDER BY (org_id, ts, engineer_id) — filters `org_id`,
 * `ts >= now() - N days`; optional `team_id`, `engineer_id`, `source`. The
 * GROUP BY session_id keeps the roll-up cheap; result set is capped by
 * `limit`.
 *
 * TIER-A ALLOWLIST: no prompt_text, tool_input, tool_output, messages,
 * toolArgs, toolOutputs, fileContents, diffs, filePaths, ticketIds, emails,
 * realNames in SELECT. Aggregates only.
 */
async function listSessionsReal(ctx: Ctx, input: ListSessionsInput): Promise<ListSessionsOutput> {
  const days = WINDOW_DAYS[input.window];

  const clauses = ["org_id = {tenant_id:String}", "ts >= now() - INTERVAL {days:UInt16} DAY"];
  const params: Record<string, unknown> = {
    tenant_id: ctx.tenant_id,
    days,
    limit: Math.min(input.limit, 5000),
  };
  if (input.team_id) {
    clauses.push("team_id = {team_id:String}");
    params.team_id = input.team_id;
  }
  if (input.engineer_id) {
    clauses.push("engineer_id = {engineer_id:String}");
    params.engineer_id = input.engineer_id;
  }
  if (input.source) {
    clauses.push("source = {source:String}");
    params.source = input.source;
  }

  const rows = await ctx.db.ch.query<{
    session_id: string;
    engineer_id: string;
    source: SessionListItem["source"];
    fidelity: SessionListItem["fidelity"];
    started_at: string;
    ended_at: string | null;
    cost_usd: number;
    cost_estimated: number;
    input_tokens: number;
    output_tokens: number;
    accepted_edits: number;
    tier: "A" | "B" | "C";
    duration_s: number | null;
  }>(
    `SELECT
       session_id,
       any(engineer_id) AS engineer_id,
       any(source) AS source,
       any(fidelity) AS fidelity,
       min(ts) AS started_at,
       max(ts) AS ended_at,
       sum(cost_usd) AS cost_usd,
       max(cost_estimated) AS cost_estimated,
       sum(input_tokens) AS input_tokens,
       sum(output_tokens) AS output_tokens,
       sumIf(1, edit_decision = 'accept') AS accepted_edits,
       any(tier) AS tier,
       dateDiff('second', min(ts), max(ts)) AS duration_s
     FROM events
     WHERE ${clauses.join(" AND ")}
     GROUP BY session_id
     ORDER BY max(ts) DESC
     LIMIT {limit:UInt32}`,
    params,
  );

  const sessions: SessionListItem[] = rows.map((r) => ({
    session_id: r.session_id,
    engineer_id: r.engineer_id,
    source: r.source,
    fidelity: r.fidelity,
    started_at: new Date(r.started_at).toISOString(),
    ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    duration_s: r.duration_s != null ? Number(r.duration_s) : null,
    cost_usd: round2(Number(r.cost_usd)),
    cost_estimated: Number(r.cost_estimated) > 0,
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    accepted_edits: Number(r.accepted_edits),
    tier: r.tier,
  }));

  return {
    sessions,
    total: sessions.length,
    window: input.window,
  };
}

const WINDOW_DAYS: Record<Window, number> = { "7d": 7, "30d": 30, "90d": 90 };

function fidelityFor(source: SessionListItem["source"], r: number): SessionListItem["fidelity"] {
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
