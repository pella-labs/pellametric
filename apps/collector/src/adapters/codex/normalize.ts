import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import {
  type CodexTurnUsage,
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
 * Pricing anchored to the LiteLLM pin in @bematist/config. Values in USD per
 * million tokens. Scope is deliberately minimal — M2 focuses on parse/dedup
 * correctness; the full pricing table lands via packages/config/pricing.ts.
 */
const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number; cached: number }> = {
  "gpt-5": { input: 2.5, output: 10.0, cached: 0.25 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cached: 0.025 },
  "gpt-4.1": { input: 2.0, output: 8.0, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "o4-mini": { input: 1.1, output: 4.4, cached: 0.275 },
};

export function normalizeSession(
  parsed: ParsedCodexSession,
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const session_id = parsed.sessionId ?? "unknown";
  const events: Event[] = [];
  let seq = 0;

  for (const line of parsed.entries) {
    const mapped = mapLine(line, parsed, id, sourceVersion, session_id, seq);
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
): Event[] {
  const kind = extractKind(line);
  if (!kind) return [];
  const payload = extractPayload(line);

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
  };

  if (kind === "session_start" || kind === "SessionStart") {
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
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_request", session_id, seq, line),
        gen_ai: { system: "openai", request: { model: payload?.model, max_tokens: 4096 } },
        dev_metrics: { event_kind: "llm_request" },
      } as Event,
    ];
  }

  if (kind === "token_count" || kind === "TokenCount") {
    const turnKey = line.turn_id ?? findTurnKeyForSeq(parsed, line);
    const turn = turnKey ? parsed.perTurnUsage.get(turnKey) : undefined;
    if (!turn) return [];
    const cost = costForTurn(turn);
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_response", session_id, seq, line),
        gen_ai: {
          system: "openai",
          response: {
            model: turn.model,
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
    return [
      {
        ...base,
        client_event_id: deterministicId("exec_command_start", session_id, seq, line),
        dev_metrics: {
          event_kind: "exec_command_start",
          tool_name: "shell",
        },
      } as Event,
    ];
  }

  if (kind === "exec_command_end" || kind === "ExecCommandEnd") {
    const exit = payload?.exit_code;
    const failure = exit !== undefined && exit !== 0;
    return [
      {
        ...base,
        client_event_id: deterministicId("exec_command_end", session_id, seq, line),
        dev_metrics: {
          event_kind: "exec_command_end",
          tool_name: "shell",
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

function costForTurn(turn: CodexTurnUsage): number | undefined {
  const model = turn.model;
  if (!model) return undefined;
  const p = MODEL_PRICING_PER_MTOK[model];
  if (!p) return undefined;
  const input = turn.input_tokens / 1_000_000;
  const output = turn.output_tokens / 1_000_000;
  const cached = turn.cached_input_tokens / 1_000_000;
  const cost = input * p.input + output * p.output + cached * p.cached;
  return Math.round(cost * 1e6) / 1e6;
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
