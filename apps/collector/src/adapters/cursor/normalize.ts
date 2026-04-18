import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import type { CursorGenerationRow } from "./parse";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

// Cursor per-million-token pricing; estimated for Auto mode, published list for Pro.
// Minimal table for M2 — full table lands in packages/config/pricing.ts expansion.
const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number }> =
  {
    "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheRead: 0.3 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3 },
    "claude-opus-4-6": { input: 15.0, output: 75.0, cacheRead: 1.5 },
    "claude-opus-4-7": { input: 15.0, output: 75.0, cacheRead: 1.5 },
    "claude-haiku-4-5": { input: 0.8, output: 4.0, cacheRead: 0.08 },
    "gpt-4o": { input: 2.5, output: 10.0, cacheRead: 1.25 },
    "gpt-4.1": { input: 2.0, output: 8.0, cacheRead: 0.5 },
  };

/**
 * Emit session_start / llm_request / llm_response / tool_result triplets from
 * Cursor generations. Fidelity is HONEST — Auto-mode rows set cost_estimated=true
 * and fidelity='estimated' per CLAUDE.md §Adapter Matrix; Pro rows stay 'full'.
 */
export function normalizeGenerations(
  generations: CursorGenerationRow[],
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  if (generations.length === 0) return [];

  const bySession = new Map<string, CursorGenerationRow[]>();
  for (const g of generations) {
    const sid = g.conversationId ?? `cursor-orphan-${g.generationUUID}`;
    const list = bySession.get(sid) ?? [];
    list.push(g);
    bySession.set(sid, list);
  }

  const events: Event[] = [];
  for (const [sessionId, rows] of bySession) {
    rows.sort((a, b) => a.unixMs - b.unixMs);
    events.push(...mapSession(sessionId, rows, id, sourceVersion));
  }
  return events.map((e, i) => ({ ...e, event_seq: i }));
}

function mapSession(
  sessionId: string,
  rows: CursorGenerationRow[],
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const out: Event[] = [];
  const first = rows[0];
  if (!first) return out;
  let seq = 0;

  const start = baseEvent(sessionId, id, sourceVersion, first, seq++);
  out.push({
    ...start,
    client_event_id: deterministicId("session_start", sessionId, 0, first),
    dev_metrics: { event_kind: "session_start", duration_ms: 0 },
  } as Event);

  for (const row of rows) {
    const isAuto = isAutoMode(row);
    const base = baseEvent(sessionId, id, sourceVersion, row, seq);
    const costEstimated = isAuto ? true : base.cost_estimated;
    const fidelity = isAuto ? "estimated" : ("full" as const);

    out.push({
      ...base,
      fidelity,
      cost_estimated: costEstimated,
      client_event_id: deterministicId("llm_request", sessionId, seq, row),
      gen_ai: {
        system: "cursor",
        request: { model: row.model },
      },
      dev_metrics: { event_kind: "llm_request" },
    } as Event);
    seq++;

    const usage = row.tokenCount;
    const cost = computeCost(row.model, usage);
    out.push({
      ...base,
      fidelity,
      cost_estimated: costEstimated,
      client_event_id: deterministicId("llm_response", sessionId, seq, row),
      gen_ai: {
        system: "cursor",
        response: { model: row.model },
        usage: {
          input_tokens: usage?.inputTokens,
          output_tokens: usage?.outputTokens,
          cache_read_input_tokens: usage?.cacheReadTokens,
          cache_creation_input_tokens: usage?.cacheWriteTokens,
        },
      },
      dev_metrics: {
        event_kind: "llm_response",
        cost_usd: cost,
        pricing_version: cost !== undefined ? pricingVersionString() : undefined,
      },
    } as Event);
    seq++;

    const tool = row.toolFormerData?.tool;
    const toolStatus = row.toolFormerData?.additionalData?.status;
    if (tool) {
      const firstTryFailure = toolStatus === "error" ? true : undefined;
      out.push({
        ...base,
        fidelity,
        cost_estimated: costEstimated,
        client_event_id: deterministicId("tool_result", sessionId, seq, row),
        dev_metrics: {
          event_kind: "tool_result",
          tool_name: tool,
          tool_status: toolStatus === "error" ? "error" : "ok",
          first_try_failure: firstTryFailure,
        },
      } as Event);
      seq++;
    }
  }

  const last = rows[rows.length - 1];
  if (last) {
    const durationMs = Math.max(0, last.unixMs - first.unixMs);
    out.push({
      ...baseEvent(sessionId, id, sourceVersion, last, seq),
      client_event_id: deterministicId("session_end", sessionId, seq, last),
      dev_metrics: { event_kind: "session_end", duration_ms: durationMs },
    } as Event);
  }

  return out;
}

function baseEvent(
  sessionId: string,
  id: ServerIdentity,
  sourceVersion: string,
  row: CursorGenerationRow,
  seq: number,
) {
  return {
    schema_version: 1 as const,
    ts: new Date(row.unixMs).toISOString(),
    tenant_id: id.tenantId,
    engineer_id: id.engineerId,
    device_id: id.deviceId,
    source: "cursor" as const,
    source_version: sourceVersion,
    fidelity: "full" as const,
    cost_estimated: false,
    tier: id.tier,
    session_id: sessionId,
    event_seq: seq,
  };
}

function isAutoMode(row: CursorGenerationRow): boolean {
  if (row.mode === "auto") return true;
  if (row.mode === "pro") return false;
  // No mode signal ⇒ treat as auto (conservative: honest fidelity over flattering).
  return row.mode === undefined;
}

function computeCost(
  model: string | undefined,
  usage: CursorGenerationRow["tokenCount"],
): number | undefined {
  if (!model || !usage) return undefined;
  const p = MODEL_PRICING_PER_MTOK[model];
  if (!p) return undefined;
  const input = (usage.inputTokens ?? 0) / 1_000_000;
  const output = (usage.outputTokens ?? 0) / 1_000_000;
  const cacheRead = (usage.cacheReadTokens ?? 0) / 1_000_000;
  const cost = input * p.input + output * p.output + cacheRead * p.cacheRead;
  return Math.round(cost * 1e6) / 1e6;
}

function deterministicId(
  kind: string,
  sessionId: string,
  seq: number,
  row: CursorGenerationRow,
): string {
  const raw = `cursor|${sessionId}|${seq}|${kind}|${row.generationUUID}|${row.unixMs}`;
  const hex = createHash("sha256").update(raw).digest("hex");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    `4${hex.substring(12, 15)}`,
    `${((Number.parseInt(hex.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hex.substring(16, 19)}`,
    hex.substring(19, 31),
  ].join("-");
}
