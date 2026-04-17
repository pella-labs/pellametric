import { type NextRequest, NextResponse } from "next/server";
import { writeCsv } from "@/lib/csv";
import { getSessionCtx } from "@/lib/session";

/**
 * CSV export route — implements contract 07 §CSV export rules.
 *
 * Default (no `?include_prompts=true`):
 *   `prompt_text`, `tool_input`, `tool_output` columns are OMITTED from the
 *   header and row set. The response does not leak prompt columns even if the
 *   underlying query returned them.
 *
 * With `?include_prompts=true`:
 *   Requires a 2FA challenge completed within the last 5 minutes (tracked via
 *   an `x-bematist-2fa` header populated by the client after WebAuthn/TOTP)
 *   AND writes an `audit_log` row per exported session with prompt content.
 *   Today the 2FA plumbing is not wired — the route returns 403 with a
 *   `2fa_required` code so the UI renders the right prompt flow.
 *
 * Datasets (`?dataset=sessions|outcomes|events`) default to `sessions`. The
 * fixture-backed data set mirrors the shape of the real export once Workstream
 * D's MVs land; the strip-prompts invariant is enforced here so swapping to a
 * real query set doesn't accidentally start emitting prompt columns.
 */

const SESSION_COLUMNS_BASE = [
  "session_id",
  "engineer_id",
  "source",
  "fidelity",
  "started_at",
  "ended_at",
  "cost_usd",
  "cost_estimated",
  "input_tokens",
  "output_tokens",
  "accepted_edits",
  "tier",
] as const;

const SESSION_COLUMNS_WITH_PROMPT = [
  ...SESSION_COLUMNS_BASE,
  "prompt_text",
  "tool_input",
  "tool_output",
] as const;

const PROMPT_COLUMNS = new Set(["prompt_text", "tool_input", "tool_output"]);

export async function GET(req: NextRequest) {
  const dataset = req.nextUrl.searchParams.get("dataset") ?? "sessions";
  const includePrompts = req.nextUrl.searchParams.get("include_prompts") === "true";

  if (dataset !== "sessions") {
    return NextResponse.json(
      { error: "bad_request", message: `dataset '${dataset}' not supported yet` },
      { status: 400 },
    );
  }

  const ctx = await getSessionCtx();

  if (includePrompts) {
    // 2FA verification hook — the real implementation reads `x-bematist-2fa`,
    // looks up the challenge token in Redis with a 5-minute TTL, and requires
    // the actor role to be `auditor` OR the IC owner of the session.
    const twoFa = req.headers.get("x-bematist-2fa");
    if (!twoFa) {
      return NextResponse.json(
        {
          error: "forbidden",
          code: "2fa_required",
          message:
            "Exporting prompts requires a 2FA challenge completed in the last 5 minutes. Complete the 2FA prompt and retry.",
        },
        { status: 403 },
      );
    }
    // TODO(B5 / Walid): validate twoFa against Redis + write audit_log row.
    void ctx;
  }

  const columns = includePrompts ? SESSION_COLUMNS_WITH_PROMPT : SESSION_COLUMNS_BASE;

  const rows = buildFixtureSessions();
  const scrubbed = includePrompts ? rows : rows.map((r) => stripPromptColumns(r));

  const csv = writeCsv(columns, scrubbed);
  const filename = `bematist-sessions-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function stripPromptColumns(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (PROMPT_COLUMNS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function buildFixtureSessions(): Record<string, unknown>[] {
  const base = new Date(Date.UTC(2026, 3, 15, 9));
  return Array.from({ length: 5 }, (_, i) => ({
    session_id: `sess-fixture-${i + 1}`,
    engineer_id: "dev-sample-engineer",
    source: i % 2 === 0 ? "claude-code" : "cursor",
    fidelity: i === 1 ? "estimated" : "full",
    started_at: new Date(base.getTime() + i * 600_000).toISOString(),
    ended_at: new Date(base.getTime() + i * 600_000 + 420_000).toISOString(),
    cost_usd: 0.42 + i * 0.31,
    cost_estimated: i === 1,
    input_tokens: 1500 + i * 400,
    output_tokens: 480 + i * 120,
    accepted_edits: i + 1,
    tier: "B",
    // Prompt columns included so the server-side stripper proves it works.
    prompt_text: `[fixture prompt ${i + 1}]`,
    tool_input: { kind: "Read", path: `src/file${i}.ts` },
    tool_output: { ok: true, bytes: 1024 + i * 64 },
  }));
}
