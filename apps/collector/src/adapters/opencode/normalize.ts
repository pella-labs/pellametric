import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import type { OpenCodeSessionPayload, RawMessageRow, RawPartRow } from "./sqlite";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

/**
 * Convert one OpenCode session payload into canonical Event[].
 *
 * Mapping:
 *   session row       → session_start (at time_created) + session_end (at time_updated)
 *   user message      → llm_request
 *   assistant message → llm_response (with cumulative usage / cost if provided)
 *   part: tool        → tool_call
 *   part: tool-result → tool_result
 *
 * Cost policy (CLAUDE.md §Scoring Rules): OpenCode persists the provider's
 * computed cost directly. We stamp `pricing_version` on any event that
 * carries cost so D21 version-shift banners work even when upstream did the
 * math for us.
 */
export function normalizeSession(
  payload: OpenCodeSessionPayload,
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const { session, messages, partsByMessageId } = payload;
  const events: Event[] = [];
  let seq = 0;

  const base = (ts: number) =>
    ({
      schema_version: 1 as const,
      ts: new Date(ts).toISOString(),
      tenant_id: id.tenantId,
      engineer_id: id.engineerId,
      device_id: id.deviceId,
      source: "opencode" as const,
      source_version: sourceVersion,
      fidelity: "post-migration" as const,
      cost_estimated: false,
      tier: id.tier,
      session_id: session.id,
    }) as const;

  events.push({
    ...base(session.time_created),
    client_event_id: deterministicId("session_start", session.id, seq, {
      sessionId: session.id,
      ts: session.time_created,
    }),
    event_seq: seq,
    dev_metrics: { event_kind: "session_start", duration_ms: 0 },
  } as Event);
  seq += 1;

  for (const msg of messages) {
    const msgEvents = mapMessage(msg, partsByMessageId.get(msg.id) ?? [], id, sourceVersion, seq);
    for (const e of msgEvents) {
      events.push(e);
      seq += 1;
    }
  }

  const endTs = Math.max(session.time_updated, session.time_created);
  events.push({
    ...base(endTs),
    client_event_id: deterministicId("session_end", session.id, seq, {
      sessionId: session.id,
      ts: endTs,
    }),
    event_seq: seq,
    dev_metrics: {
      event_kind: "session_end",
      duration_ms: Math.max(0, session.time_updated - session.time_created),
    },
  } as Event);

  return events.map((e, i) => ({ ...e, event_seq: i }));
}

function mapMessage(
  msg: RawMessageRow,
  parts: RawPartRow[],
  id: ServerIdentity,
  sourceVersion: string,
  startSeq: number,
): Event[] {
  const base = {
    schema_version: 1 as const,
    ts: new Date(msg.time_created).toISOString(),
    tenant_id: id.tenantId,
    engineer_id: id.engineerId,
    device_id: id.deviceId,
    source: "opencode" as const,
    source_version: sourceVersion,
    fidelity: "post-migration" as const,
    cost_estimated: false,
    tier: id.tier,
    session_id: msg.session_id,
  };

  const out: Event[] = [];
  let seq = startSeq;

  if (msg.role === "user") {
    out.push({
      ...base,
      client_event_id: deterministicId("llm_request", msg.session_id, seq, {
        messageId: msg.id,
      }),
      event_seq: seq,
      gen_ai: {
        system: msg.provider_id ?? undefined,
        request: msg.model_id ? { model: msg.model_id } : undefined,
      },
      dev_metrics: { event_kind: "llm_request" },
    } as Event);
    seq += 1;
  } else if (msg.role === "assistant") {
    const hasUsage =
      msg.input_tokens !== null ||
      msg.output_tokens !== null ||
      msg.cache_read_input_tokens !== null ||
      msg.cache_creation_input_tokens !== null;
    const hasCost = msg.cost_usd !== null && msg.cost_usd !== undefined;
    out.push({
      ...base,
      client_event_id: deterministicId("llm_response", msg.session_id, seq, {
        messageId: msg.id,
      }),
      event_seq: seq,
      gen_ai: {
        system: msg.provider_id ?? undefined,
        response: {
          model: msg.model_id ?? undefined,
          finish_reasons: msg.finish_reason ? [msg.finish_reason] : undefined,
        },
        usage: hasUsage
          ? {
              input_tokens: msg.input_tokens ?? undefined,
              output_tokens: msg.output_tokens ?? undefined,
              cache_read_input_tokens: msg.cache_read_input_tokens ?? undefined,
              cache_creation_input_tokens: msg.cache_creation_input_tokens ?? undefined,
            }
          : undefined,
      },
      dev_metrics: {
        event_kind: "llm_response",
        cost_usd: hasCost ? (msg.cost_usd as number) : undefined,
        pricing_version: hasCost ? pricingVersionString() : undefined,
      },
    } as Event);
    seq += 1;
  }

  for (const part of parts) {
    if (part.type === "tool") {
      out.push({
        ...base,
        ts: new Date(part.time_created).toISOString(),
        client_event_id: deterministicId("tool_call", msg.session_id, seq, {
          partId: part.id,
        }),
        event_seq: seq,
        dev_metrics: {
          event_kind: "tool_call",
          tool_name: part.tool_name ?? undefined,
        },
      } as Event);
      seq += 1;
    } else if (part.type === "tool-result") {
      out.push({
        ...base,
        ts: new Date(part.time_created).toISOString(),
        client_event_id: deterministicId("tool_result", msg.session_id, seq, {
          partId: part.id,
        }),
        event_seq: seq,
        dev_metrics: {
          event_kind: "tool_result",
          tool_name: part.tool_name ?? undefined,
          tool_status: part.tool_status ?? undefined,
          duration_ms: part.tool_duration_ms ?? undefined,
          first_try_failure: part.tool_status === "error" ? true : undefined,
        },
      } as Event);
      seq += 1;
    }
  }

  return out;
}

function deterministicId(
  kind: string,
  sessionId: string,
  seq: number,
  payload: Record<string, unknown>,
): string {
  const raw = `opencode|${sessionId}|${seq}|${kind}|${JSON.stringify(payload)}`;
  const hex = createHash("sha256").update(raw).digest("hex");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    `4${hex.substring(12, 15)}`,
    `${((Number.parseInt(hex.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hex.substring(16, 19)}`,
    hex.substring(19, 31),
  ].join("-");
}
