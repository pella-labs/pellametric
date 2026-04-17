import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import type { ParsedSession } from "./parsers/parseSessionFile";
import type { RawClaudeSessionLine, RawClaudeUsage } from "./parsers/types";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

const MODEL_PRICING_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheCreation: number }
> = {
  // Values in USD per million tokens. Anchored to the LiteLLM pin in @bematist/config.
  // For M1 we carry a minimal table covering the 4.5 / 4.6 family; fully loaded table
  // lands as a generated JSON in M2 via packages/config/pricing.ts.
  "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  "claude-opus-4-6": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  "claude-opus-4-7": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0, cacheRead: 0.08, cacheCreation: 1.0 },
};

export function normalizeSession(
  parsed: ParsedSession,
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const session_id = parsed.sessionId ?? "unknown";
  const events: Event[] = [];
  let seq = 0;

  for (const line of parsed.entries) {
    const eventsForLine = mapLine(line, parsed, id, sourceVersion, session_id, seq);
    for (const e of eventsForLine) {
      events.push(e);
      seq++;
    }
  }
  return events.map((e, i) => ({ ...e, event_seq: i }));
}

function mapLine(
  line: RawClaudeSessionLine,
  parsed: ParsedSession,
  id: ServerIdentity,
  sourceVersion: string,
  session_id: string,
  seq: number,
): Event[] {
  const base = {
    schema_version: 1 as const,
    ts: line.timestamp ?? new Date().toISOString(),
    tenant_id: id.tenantId,
    engineer_id: id.engineerId,
    device_id: id.deviceId,
    source: "claude-code" as const,
    source_version: sourceVersion,
    fidelity: "full" as const,
    cost_estimated: false,
    tier: id.tier,
    session_id,
    event_seq: seq,
  };

  if (line.type === "session_start") {
    return [
      {
        ...base,
        client_event_id: deterministicId("session_start", session_id, seq, line),
        dev_metrics: {
          event_kind: "session_start",
          duration_ms: 0,
        },
      } as Event,
    ];
  }

  if (line.type === "session_end") {
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

  if (line.type === "message" && line.message?.role === "user") {
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_request", session_id, seq, line),
        gen_ai: {
          system: "anthropic",
          request: {
            model: line.message?.model,
            max_tokens: 4096,
          },
        },
        dev_metrics: { event_kind: "llm_request" },
      } as Event,
    ];
  }

  if (line.type === "message" && line.message?.role === "assistant") {
    const model = line.message?.model;
    const usage =
      (line.requestId && parsed.perRequestUsage.get(line.requestId)) || line.message?.usage;
    const cost = usage && model ? computeCostUsd(model, usage) : undefined;
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_response", session_id, seq, line),
        gen_ai: {
          system: "anthropic",
          response: {
            model,
            finish_reasons: line.message?.stop_reason ? [line.message.stop_reason] : undefined,
          },
          usage: {
            input_tokens: usage?.input_tokens,
            output_tokens: usage?.output_tokens,
            cache_read_input_tokens: usage?.cache_read_input_tokens,
            cache_creation_input_tokens: usage?.cache_creation_input_tokens,
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

  if (line.type === "tool_use") {
    return [
      {
        ...base,
        client_event_id: deterministicId("tool_call", session_id, seq, line),
        dev_metrics: {
          event_kind: "tool_call",
          tool_name: line.toolUse?.name,
        },
      } as Event,
    ];
  }

  if (line.type === "tool_result") {
    return [
      {
        ...base,
        client_event_id: deterministicId("tool_result", session_id, seq, line),
        dev_metrics: {
          event_kind: "tool_result",
          tool_name: line.toolUse?.name,
          tool_status: line.toolResult?.isError ? "error" : "ok",
          duration_ms: line.toolResult?.durationMs,
          first_try_failure: line.toolResult?.isError ? true : undefined,
        },
      } as Event,
    ];
  }

  // Unknown line kinds are skipped for M1. M2 will expand this mapping.
  return [];
}

function computeCostUsd(model: string, u: RawClaudeUsage): number | undefined {
  const p = MODEL_PRICING_PER_MTOK[model];
  if (!p) return undefined;
  const input = (u.input_tokens ?? 0) / 1_000_000;
  const output = (u.output_tokens ?? 0) / 1_000_000;
  const cacheRead = (u.cache_read_input_tokens ?? 0) / 1_000_000;
  const cacheCreation = (u.cache_creation_input_tokens ?? 0) / 1_000_000;
  const cost =
    input * p.input + output * p.output + cacheRead * p.cacheRead + cacheCreation * p.cacheCreation;
  return Math.round(cost * 1e6) / 1e6;
}

function deterministicId(
  kind: string,
  session_id: string,
  seq: number,
  line: RawClaudeSessionLine,
): string {
  const raw = `claude-code|${session_id}|${seq}|${kind}|${JSON.stringify(line)}`;
  const hex = createHash("sha256").update(raw).digest("hex");
  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where y is one of [8, 9, a, b]
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    `4${hex.substring(12, 15)}`,
    `${((Number.parseInt(hex.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hex.substring(16, 19)}`,
    hex.substring(19, 31),
  ].join("-");
}
