import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import {
  type CodexTurnUsage,
  deriveToolNameFromCommand,
  extractKind,
  extractPayload,
  type ParsedCodexSession,
} from "./parsers/parseSessionFile";
import type { RawCodexLine, RawCodexPayload } from "./parsers/types";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

/**
 * Pricing anchored to LiteLLM and grammata's reference table. Values in USD
 * per million tokens. Kept in sync with `packages/grammata/src/pricing.ts`
 * `CODEX_PRICING` so our CH numbers match grammata's session view ±0.
 *
 * Composition (matches grammata):
 *   uncached = input_tokens - cached_input_tokens
 *   cost = (uncached * input + cached * cached + output * output) / 1e6
 * `reasoning_output_tokens` is NOT billed separately — matching grammata.
 */
const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number; cached: number }> = {
  // gpt-5 base (generic OpenAI, not codex-branded).
  "gpt-5": { input: 2.5, output: 10.0, cached: 0.25 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cached: 0.025 },
  // Codex-branded tunes — pricing mirrors grammata CODEX_PRICING exactly.
  "gpt-5.1-codex": { input: 1.25, output: 10.0, cached: 0.125 },
  "gpt-5.2-codex": { input: 1.75, output: 14.0, cached: 0.175 },
  "gpt-5.3-codex": { input: 1.75, output: 14.0, cached: 0.175 },
  "gpt-5.3-codex-spark": { input: 1.75, output: 14.0, cached: 0.175 },
  "gpt-5.1-codex-mini": { input: 0.25, output: 2.0, cached: 0.025 },
  "gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25 },
  // Non-codex fallbacks kept for forward-compat.
  "gpt-4o": { input: 2.5, output: 10.0, cached: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
  "gpt-4.1": { input: 2.0, output: 8.0, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  o3: { input: 10.0, output: 40.0, cached: 2.5 },
  "o3-mini": { input: 1.1, output: 4.4, cached: 0.55 },
  "o4-mini": { input: 1.1, output: 4.4, cached: 0.55 },
};

/** Extra context the adapter resolves outside the JSONL (e.g. branch from `.git/HEAD`). */
export interface NormalizeExtras {
  /** Active git branch for the session's `cwd`. Denormalized onto every event
   *  via `raw_attrs.branch`; ingest copies it into CH column `branch`. */
  branch?: string;
}

export function normalizeSession(
  parsed: ParsedCodexSession,
  id: ServerIdentity,
  sourceVersion: string,
  extras: NormalizeExtras = {},
): Event[] {
  const session_id = parsed.sessionId ?? "unknown";
  const events: Event[] = [];
  let seq = 0;

  for (const line of parsed.entries) {
    const mapped = mapLine(line, parsed, id, sourceVersion, session_id, seq, extras);
    for (const e of mapped) {
      events.push(e);
      seq++;
    }
  }
  return events.map((e, i) => ({ ...e, event_seq: i }));
}

function mapLine(
  line: RawCodexLine,
  parsed: ParsedCodexSession,
  id: ServerIdentity,
  sourceVersion: string,
  session_id: string,
  seq: number,
  extras: NormalizeExtras,
): Event[] {
  const kind = extractKind(line);
  if (!kind) return [];
  const payload = extractPayload(line);

  // Attach the resolved git branch on every event via raw_attrs — ingest
  // canonicalize() copies raw_attrs.branch into CH column `branch` so outcome
  // attribution joins (PR/commit) work for Codex sessions the same as Claude.
  const raw_attrs: Record<string, unknown> | undefined = extras.branch
    ? { branch: extras.branch }
    : undefined;

  const base = {
    schema_version: 1 as const,
    ts: line.timestamp ?? new Date().toISOString(),
    tenant_id: id.tenantId,
    engineer_id: id.engineerId,
    device_id: id.deviceId,
    source: "codex" as const,
    source_version: sourceVersion,
    fidelity: "full" as const,
    cost_estimated: false,
    tier: id.tier,
    session_id,
    event_seq: seq,
    ...(raw_attrs ? { raw_attrs } : {}),
  };

  if (kind === "session_start" || kind === "SessionStart" || kind === "session_meta") {
    return [
      {
        ...base,
        client_event_id: deterministicId("session_start", session_id, seq, line),
        dev_metrics: { event_kind: "session_start", duration_ms: 0 },
      } as Event,
    ];
  }

  if (kind === "session_end" || kind === "SessionEnd") {
    return [
      {
        ...base,
        client_event_id: deterministicId("session_end", session_id, seq, line),
        dev_metrics: {
          event_kind: "session_end",
          duration_ms: parsed.durationMs ?? undefined,
        },
      } as Event,
    ];
  }

  if (kind === "user_message" || kind === "UserMessage") {
    // Prefer the model named on the user_message; fall back to the latest
    // turn_context model. Newer Codex omits model on user_message entirely.
    const reqModel = payload?.model ?? parsed.activeModel ?? undefined;
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_request", session_id, seq, line),
        gen_ai: { system: "openai", request: { model: reqModel, max_tokens: 4096 } },
        dev_metrics: { event_kind: "llm_request" },
      } as Event,
    ];
  }

  if (kind === "token_count" || kind === "TokenCount") {
    const turnKey = line.turn_id ?? findTurnKeyForSeq(parsed, line);
    const turn = turnKey ? parsed.perTurnUsage.get(turnKey) : undefined;
    if (!turn) return [];
    // Model priority: explicit turn model → latest turn_context activeModel.
    const respModel = turn.model ?? parsed.activeModel ?? undefined;
    const turnForCost: CodexTurnUsage = respModel ? { ...turn, model: respModel } : turn;
    const cost = costForTurn(turnForCost);
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_response", session_id, seq, line),
        gen_ai: {
          system: "openai",
          // Stamp the request model too so gen_ai_request_model isn't empty
          // on the llm_response row — the CH column is populated from
          // gen_ai.request.model, not gen_ai.response.model.
          request: respModel ? { model: respModel } : undefined,
          response: {
            model: respModel,
            finish_reasons: payload?.finish_reason ? [payload.finish_reason] : undefined,
          },
          usage: {
            input_tokens: turn.input_tokens,
            output_tokens: turn.output_tokens,
            cache_read_input_tokens: turn.cached_input_tokens,
          },
        },
        dev_metrics: {
          event_kind: "llm_response",
          cost_usd: cost,
          pricing_version: cost !== undefined ? pricingVersionString() : undefined,
        },
      } as Event,
    ];
  }

  if (kind === "exec_command_start" || kind === "ExecCommandStart") {
    const toolName = payload?.command ? deriveToolNameFromCommand(payload.command) : "shell";
    return [
      {
        ...base,
        client_event_id: deterministicId("exec_command_start", session_id, seq, line),
        dev_metrics: {
          event_kind: "exec_command_start",
          tool_name: toolName,
        },
      } as Event,
    ];
  }

  if (kind === "exec_command_end" || kind === "ExecCommandEnd") {
    const exit = payload?.exit_code;
    const failure = exit !== undefined && exit !== 0;
    // exec_command_end rarely carries `command` — look back at the prior
    // exec_command_start for the same turn to attribute tool_name.
    const toolName = findToolNameForExecEnd(parsed, line) ?? "shell";
    return [
      {
        ...base,
        client_event_id: deterministicId("exec_command_end", session_id, seq, line),
        dev_metrics: {
          event_kind: "exec_command_end",
          tool_name: toolName,
          tool_status: failure ? "error" : "ok",
          duration_ms: payload?.duration_ms,
          first_try_failure: failure ? true : undefined,
        },
      } as Event,
    ];
  }

  if (kind === "patch_apply_start" || kind === "PatchApplyStart") {
    return [
      {
        ...base,
        client_event_id: deterministicId("patch_apply_start", session_id, seq, line),
        dev_metrics: {
          event_kind: "patch_apply_start",
          tool_name: "apply_patch",
        },
      } as Event,
    ];
  }

  if (kind === "patch_apply_end" || kind === "PatchApplyEnd") {
    const failure = payload?.success === false;
    return [
      {
        ...base,
        client_event_id: deterministicId("patch_apply_end", session_id, seq, line),
        dev_metrics: {
          event_kind: "patch_apply_end",
          tool_name: "apply_patch",
          tool_status: failure ? "error" : "ok",
          duration_ms: payload?.duration_ms,
          first_try_failure: failure ? true : undefined,
        },
      } as Event,
    ];
  }

  return [];
}

/**
 * Walk `parsed.entries` to find the most recent exec_command_start (same
 * turn_id when available) and return its derived tool_name. Used to attribute
 * tool_name on exec_command_end, which doesn't carry the original command.
 */
function findToolNameForExecEnd(
  parsed: ParsedCodexSession,
  endLine: RawCodexLine,
): string | undefined {
  let last: string | undefined;
  for (const e of parsed.entries) {
    if (e === endLine) return last;
    const k = extractKind(e);
    if (k === "exec_command_start" || k === "ExecCommandStart") {
      const p = extractPayload(e);
      if (p?.command && (!endLine.turn_id || e.turn_id === endLine.turn_id)) {
        last = deriveToolNameFromCommand(p.command);
      }
    }
  }
  return last;
}

function findTurnKeyForSeq(parsed: ParsedCodexSession, line: RawCodexLine): string | undefined {
  // Walk entries to recover a sequence-based turn key matching parseSessionFile.
  // Cheap linear scan — rollout files are single-user, single-session, small.
  let n = 0;
  for (const e of parsed.entries) {
    if (extractKind(e) === "token_count" || extractKind(e) === "TokenCount") {
      if (e === line) return e.turn_id ?? `sequence#${n}`;
      n++;
    }
  }
  return undefined;
}

/**
 * Per-turn cost in USD. Matches grammata's codex cost formula exactly:
 *
 *   uncached_input = max(input_tokens - cached_input_tokens, 0)
 *   cost = (uncached_input * input_rate
 *         + cached_input_tokens * cached_rate
 *         + output_tokens * output_rate) / 1_000_000
 *
 * Pricing lookup: exact match first; then longest "includes" (e.g.
 * "openai/gpt-5.3-codex" picks up "gpt-5.3-codex"). If no row is available
 * the turn is skipped (undefined) so downstream never shows a fake $0.
 */
function costForTurn(turn: CodexTurnUsage): number | undefined {
  const model = turn.model;
  if (!model) return undefined;
  const p = pricingFor(model);
  if (!p) return undefined;
  const cached = turn.cached_input_tokens;
  const uncached = Math.max(turn.input_tokens - cached, 0);
  const cost = (uncached * p.input + cached * p.cached + turn.output_tokens * p.output) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

function pricingFor(model: string): { input: number; output: number; cached: number } | undefined {
  const exact = MODEL_PRICING_PER_MTOK[model];
  if (exact) return exact;
  const normalized = model.toLowerCase();
  let best: { key: string; row: { input: number; output: number; cached: number } } | undefined;
  for (const [key, row] of Object.entries(MODEL_PRICING_PER_MTOK)) {
    if (normalized.includes(key.toLowerCase())) {
      if (!best || key.length > best.key.length) best = { key, row };
    }
  }
  return best?.row;
}

function deterministicId(
  kind: string,
  session_id: string,
  seq: number,
  line: RawCodexLine,
): string {
  const raw = `codex|${session_id}|${seq}|${kind}|${JSON.stringify(line)}`;
  const hex = createHash("sha256").update(raw).digest("hex");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    `4${hex.substring(12, 15)}`,
    `${((Number.parseInt(hex.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hex.substring(16, 19)}`,
    hex.substring(19, 31),
  ].join("-");
}

export type { RawCodexPayload };
/** Exported for tests. Not part of the public surface. */
export { costForTurn as _costForTurn, MODEL_PRICING_PER_MTOK as _PRICING, mapLine as _mapLine };
