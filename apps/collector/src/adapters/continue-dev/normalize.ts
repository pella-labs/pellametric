import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import type {
  ContinueChatInteractionLine,
  ContinueEditOutcomeLine,
  ContinueTokensGeneratedLine,
  ContinueToolUsageLine,
} from "./types";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

/**
 * USD per million tokens. Keep the table narrow to what Continue users run;
 * unknown models return `undefined` cost and the event simply omits cost_usd
 * (no ∞ values, no silent recomputation — see CLAUDE.md §Scoring Rules D21).
 */
const MODEL_PRICING_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheRead?: number; cacheWrite?: number }
> = {
  "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-6": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-7": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-5": { input: 5.0, output: 20.0 },
  "o4-mini": { input: 1.1, output: 4.4 },
};

export function computeCostUsd(
  model: string | undefined,
  usage: {
    input?: number | undefined;
    output?: number | undefined;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
  },
): number | undefined {
  if (!model) return undefined;
  const p = MODEL_PRICING_PER_MTOK[model];
  if (!p) return undefined;
  const input = (usage.input ?? 0) / 1_000_000;
  const output = (usage.output ?? 0) / 1_000_000;
  const cacheRead = (usage.cacheRead ?? 0) / 1_000_000;
  const cacheWrite = (usage.cacheWrite ?? 0) / 1_000_000;
  const cost =
    input * p.input +
    output * p.output +
    cacheRead * (p.cacheRead ?? 0) +
    cacheWrite * (p.cacheWrite ?? 0);
  return Math.round(cost * 1e6) / 1e6;
}

function sha256Uuid(parts: unknown[]): string {
  const raw = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("|");
  const hex = createHash("sha256").update(raw).digest("hex");
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    `4${hex.substring(12, 15)}`,
    `${((Number.parseInt(hex.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hex.substring(16, 19)}`,
    hex.substring(19, 31),
  ].join("-");
}

/** Deterministic client_event_id keyed on adapter, stream, row identity. */
export function deterministicId(
  stream: string,
  sessionId: string,
  ordinal: number,
  kind: string,
  line: unknown,
): string {
  return sha256Uuid(["continue", stream, sessionId, ordinal, kind, line]);
}

export interface BaseArgs {
  id: ServerIdentity;
  sourceVersion: string;
  ts: string;
  sessionId: string;
  seq: number;
}

function baseEvent(args: BaseArgs) {
  return {
    schema_version: 1 as const,
    ts: args.ts,
    tenant_id: args.id.tenantId,
    engineer_id: args.id.engineerId,
    device_id: args.id.deviceId,
    source: "continue" as const,
    source_version: args.sourceVersion,
    fidelity: "full" as const,
    cost_estimated: false,
    tier: args.id.tier,
    session_id: args.sessionId,
    event_seq: args.seq,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureSession(raw: string | undefined): string {
  return raw && raw.length > 0 ? raw : "unknown";
}

export function normalizeChatInteraction(
  lines: ContinueChatInteractionLine[],
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const sessionId = ensureSession(line.sessionId);
    const ts = line.timestamp ?? nowIso();
    const role = line.role ?? "assistant";

    if (role === "user") {
      out.push({
        ...baseEvent({ id, sourceVersion, ts, sessionId, seq: out.length }),
        client_event_id: deterministicId("chatInteraction", sessionId, i, "llm_request", line),
        gen_ai: {
          system: line.modelProvider ?? "continue",
          request: {
            model: line.modelTitle,
          },
        },
        dev_metrics: {
          event_kind: "llm_request",
        },
      } as Event);
      continue;
    }

    const cost = computeCostUsd(line.modelTitle, {
      input: line.promptTokens,
      output: line.generatedTokens,
    });
    out.push({
      ...baseEvent({ id, sourceVersion, ts, sessionId, seq: out.length }),
      client_event_id: deterministicId("chatInteraction", sessionId, i, "llm_response", line),
      gen_ai: {
        system: line.modelProvider ?? "continue",
        response: {
          model: line.modelTitle,
          finish_reasons: line.finishReason ? [line.finishReason] : undefined,
        },
        usage: {
          input_tokens: line.promptTokens,
          output_tokens: line.generatedTokens,
        },
      },
      dev_metrics: {
        event_kind: "llm_response",
        cost_usd: cost,
        pricing_version: cost !== undefined ? pricingVersionString() : undefined,
      },
    } as Event);
  }
  return out;
}

export function normalizeTokensGenerated(
  lines: ContinueTokensGeneratedLine[],
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const sessionId = ensureSession(line.sessionId);
    const ts = line.timestamp ?? nowIso();
    const cost = computeCostUsd(line.modelTitle, {
      input: line.promptTokens,
      output: line.generatedTokens,
      cacheRead: line.cacheReadTokens,
      cacheWrite: line.cacheWriteTokens,
    });
    out.push({
      ...baseEvent({ id, sourceVersion, ts, sessionId, seq: i }),
      client_event_id: deterministicId("tokensGenerated", sessionId, i, "llm_response", line),
      gen_ai: {
        system: line.modelProvider ?? "continue",
        response: {
          model: line.modelTitle,
        },
        usage: {
          input_tokens: line.promptTokens,
          output_tokens: line.generatedTokens,
          cache_read_input_tokens: line.cacheReadTokens,
          cache_creation_input_tokens: line.cacheWriteTokens,
        },
      },
      dev_metrics: {
        event_kind: "llm_response",
        cost_usd: cost,
        pricing_version: cost !== undefined ? pricingVersionString() : undefined,
      },
    } as Event);
  }
  return out;
}

export function normalizeEditOutcome(
  lines: ContinueEditOutcomeLine[],
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const sessionId = ensureSession(line.sessionId);
    const ts = line.timestamp ?? nowIso();
    // Emit the proposal first, then the decision, so downstream attribution
    // sees (proposed → decision) in order regardless of line ordering.
    out.push({
      ...baseEvent({ id, sourceVersion, ts, sessionId, seq: out.length }),
      client_event_id: deterministicId("editOutcome", sessionId, i, "code_edit_proposed", line),
      dev_metrics: {
        event_kind: "code_edit_proposed",
        tool_name: line.editKind,
        hunk_sha256: line.hunkSha256,
        file_path_hash: line.filePathHash,
      },
    } as Event);
    out.push({
      ...baseEvent({ id, sourceVersion, ts, sessionId, seq: out.length }),
      client_event_id: deterministicId("editOutcome", sessionId, i, "code_edit_decision", line),
      dev_metrics: {
        event_kind: "code_edit_decision",
        tool_name: line.editKind,
        hunk_sha256: line.hunkSha256,
        file_path_hash: line.filePathHash,
        edit_decision: line.accepted === true ? "accept" : "reject",
        duration_ms: line.decisionLatencyMs,
      },
    } as Event);
  }
  return out;
}

export function normalizeToolUsage(
  lines: ContinueToolUsageLine[],
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const sessionId = ensureSession(line.sessionId);
    const ts = line.timestamp ?? nowIso();
    // A single Continue `toolUsage` row represents a completed call; we emit
    // both `tool_call` and `tool_result` for parity with the claude-code
    // canonical stream so downstream MVs don't special-case per-adapter.
    out.push({
      ...baseEvent({ id, sourceVersion, ts, sessionId, seq: out.length }),
      client_event_id: deterministicId("toolUsage", sessionId, i, "tool_call", line),
      dev_metrics: {
        event_kind: "tool_call",
        tool_name: line.toolName,
      },
    } as Event);
    const status = line.status === "denied" ? "denied" : line.status === "error" ? "error" : "ok";
    out.push({
      ...baseEvent({ id, sourceVersion, ts, sessionId, seq: out.length }),
      client_event_id: deterministicId("toolUsage", sessionId, i, "tool_result", line),
      dev_metrics: {
        event_kind: "tool_result",
        tool_name: line.toolName,
        tool_status: status,
        duration_ms: line.durationMs,
        first_try_failure: status === "error" ? true : undefined,
      },
    } as Event);
  }
  return out;
}
