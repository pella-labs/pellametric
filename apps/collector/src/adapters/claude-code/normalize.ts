import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import type { ParsedSession } from "./parsers/parseSessionFile";
import type { RawClaudeContentBlock, RawClaudeSessionLine, RawClaudeUsage } from "./parsers/types";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

/** Extra context the adapter resolves outside the JSONL (git branch / HEAD). */
export interface NormalizeExtras {
  /** Active git branch at poll time. Falls back to each line's `gitBranch`
   *  field (Claude Code v2.1.x+) when the adapter can't resolve from cwd. */
  branch?: string;
  /** HEAD commit SHA for the session's cwd; feeds the GitHub-App linker that
   *  joins sessions to PRs and merged commits. */
  commit_sha?: string;
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
  extras: NormalizeExtras = {},
): Event[] {
  const session_id = parsed.sessionId ?? "unknown";
  const events: Event[] = [];
  let seq = 0;

  // Fall back to the in-line `gitBranch` field Claude Code stamps on every
  // line (v2.1.x+) when the adapter didn't resolve a branch from cwd.
  const resolvedExtras: NormalizeExtras = { ...extras };
  if (!resolvedExtras.branch) {
    const firstBranch = parsed.entries.find((l) => l.gitBranch)?.gitBranch;
    if (firstBranch) resolvedExtras.branch = firstBranch;
  }

  // Real-format sessions (`~/.claude/projects/**.jsonl`) never emit an explicit
  // `session_start` line — the session begins at the first user message. The
  // fixture format does emit one. Synthesize one here if we're dealing with
  // real-format data (detected by the presence of any top-level `user` /
  // `assistant` type) and there's no explicit session_start in the stream.
  const hasRealFormat = parsed.entries.some((l) => l.type === "user" || l.type === "assistant");
  const hasExplicitStart = parsed.entries.some((l) => l.type === "session_start");
  if (hasRealFormat && !hasExplicitStart && parsed.firstTimestamp) {
    const synthetic: RawClaudeSessionLine = {
      type: "session_start",
      timestamp: parsed.firstTimestamp,
    };
    if (parsed.sessionId) synthetic.sessionId = parsed.sessionId;
    const startEvents = mapLine(
      synthetic,
      -1,
      parsed,
      id,
      sourceVersion,
      session_id,
      seq,
      resolvedExtras,
    );
    for (const e of startEvents) {
      events.push(e);
      seq++;
    }
  }

  for (let idx = 0; idx < parsed.entries.length; idx++) {
    const line = parsed.entries[idx];
    if (!line) continue;
    const eventsForLine = mapLine(
      line,
      idx,
      parsed,
      id,
      sourceVersion,
      session_id,
      seq,
      resolvedExtras,
    );
    for (const e of eventsForLine) {
      events.push(e);
      seq++;
    }
  }
  return events.map((e, i) => ({ ...e, event_seq: i }));
}

function mapLine(
  line: RawClaudeSessionLine,
  idx: number,
  parsed: ParsedSession,
  id: ServerIdentity,
  sourceVersion: string,
  session_id: string,
  seq: number,
  extras: NormalizeExtras,
): Event[] {
  // Branch: adapter-resolved (extras.branch) is the session-wide authoritative
  // value; fall back to the per-line `gitBranch` only when the adapter
  // couldn't resolve one. Matches codex-adapter semantics — a session
  // targets one working tree, and denormalizing the session's HEAD branch on
  // every event is what the outcome linker expects.
  const lineBranch = extras.branch ?? line.gitBranch;
  const rawAttrsAccum: Record<string, unknown> = {};
  if (lineBranch) rawAttrsAccum.branch = lineBranch;
  if (extras.commit_sha) rawAttrsAccum.commit_sha = extras.commit_sha;
  const raw_attrs = Object.keys(rawAttrsAccum).length > 0 ? rawAttrsAccum : undefined;

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
    ...(raw_attrs ? { raw_attrs } : {}),
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
    const isOwner = parsed.usageOwnerEntryIdx.has(idx);
    const key = usageKeyFor(line);
    const usage = isOwner && key ? parsed.perUsageKey.get(key) : undefined;
    const cost = isOwner && usage && model ? computeCostUsd(model, usage) : undefined;
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

  // Real Claude Code JSONL format: top-level `type` is `"user"` / `"assistant"`
  // (vs. the fixture format's `"message"` + nested `role`). Tool calls come
  // embedded in `message.content[]` as typed blocks.
  if (line.type === "user") {
    return mapRealUserLine(line, base, session_id, seq);
  }
  if (line.type === "assistant") {
    return mapRealAssistantLine(line, idx, parsed, base, session_id, seq);
  }
  // `file-history-snapshot`, `system`, and any other unknown kinds are skipped.
  return [];
}

/**
 * Map a real-format `type: "user"` line. User messages in the real format are
 * either plain text (prompt from the developer) or a `tool_result` envelope
 * whose `message.content[]` contains one or more `tool_result` blocks.
 */
function mapRealUserLine(
  line: RawClaudeSessionLine,
  base: EventBase,
  session_id: string,
  seq: number,
): Event[] {
  const content = line.message?.content;
  if (Array.isArray(content)) {
    const out: Event[] = [];
    let i = 0;
    for (const block of content as RawClaudeContentBlock[]) {
      if (block?.type === "tool_result") {
        out.push({
          ...base,
          event_seq: seq + i,
          client_event_id: deterministicId(
            `tool_result:${block.tool_use_id ?? ""}`,
            session_id,
            seq + i,
            line,
          ),
          dev_metrics: {
            event_kind: "tool_result",
            tool_status: block.is_error ? "error" : "ok",
            first_try_failure: block.is_error ? true : undefined,
          },
        } as Event);
        i++;
      }
    }
    return out;
  }
  // Plain user prompt — one llm_request-style event with no model info.
  return [
    {
      ...base,
      client_event_id: deterministicId("user_prompt", session_id, seq, line),
      dev_metrics: { event_kind: "llm_request" },
    } as Event,
  ];
}

/**
 * Map a real-format `type: "assistant"` line. Emits one `llm_response` event
 * (with usage + cost) plus one `tool_call` event per `tool_use` content block.
 */
function mapRealAssistantLine(
  line: RawClaudeSessionLine,
  idx: number,
  parsed: ParsedSession,
  base: EventBase,
  session_id: string,
  seq: number,
): Event[] {
  const model = line.message?.model;
  const isOwner = parsed.usageOwnerEntryIdx.has(idx);
  const key = usageKeyFor(line);
  const usage = isOwner && key ? parsed.perUsageKey.get(key) : undefined;
  const cost = isOwner && usage && model ? computeCostUsd(model, usage) : undefined;

  const events: Event[] = [
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

  // tool_use blocks embedded in message.content[] → tool_call events.
  const content = line.message?.content;
  if (Array.isArray(content)) {
    let i = 1; // event_seq offset — `llm_response` took seq+0.
    for (const block of content as RawClaudeContentBlock[]) {
      if (block?.type === "tool_use") {
        events.push({
          ...base,
          event_seq: seq + i,
          client_event_id: deterministicId(
            `tool_call:${block.id ?? ""}`,
            session_id,
            seq + i,
            line,
          ),
          dev_metrics: {
            event_kind: "tool_call",
            tool_name: block.name,
          },
        } as Event);
        i++;
      }
    }
  }
  return events;
}

type EventBase = {
  schema_version: 1;
  ts: string;
  tenant_id: string;
  engineer_id: string;
  device_id: string;
  source: "claude-code";
  source_version: string;
  fidelity: "full";
  cost_estimated: boolean;
  tier: "A" | "B" | "C";
  session_id: string;
  event_seq: number;
};

/**
 * Resolve a per-MTok price sheet for a Claude model slug. Matches grammata's
 * `getClaudePricing`: exact match → longest-prefix exact match → family
 * fallback (`claude-opus-4-*`, `claude-sonnet-4-*`, `claude-haiku-4-*`) →
 * last-resort sonnet pricing. This keeps dated variants (`claude-opus-4-7`,
 * `claude-opus-4-5-20251101`, etc.) priced instead of dropping to $0.
 */
function getClaudePricing(model: string): {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
} {
  const exact = MODEL_PRICING_PER_MTOK[model];
  if (exact) return exact;
  const normalized = model.toLowerCase();
  const prefixMatch = Object.entries(MODEL_PRICING_PER_MTOK)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([key]) => normalized.startsWith(key.toLowerCase()));
  if (prefixMatch) return prefixMatch[1];
  if (normalized.startsWith("claude-opus-4")) {
    // biome-ignore lint/style/noNonNullAssertion: key is statically present.
    return MODEL_PRICING_PER_MTOK["claude-opus-4-6"]!;
  }
  if (normalized.startsWith("claude-sonnet-4")) {
    // biome-ignore lint/style/noNonNullAssertion: key is statically present.
    return MODEL_PRICING_PER_MTOK["claude-sonnet-4-6"]!;
  }
  if (normalized.startsWith("claude-haiku-4")) {
    // biome-ignore lint/style/noNonNullAssertion: key is statically present.
    return MODEL_PRICING_PER_MTOK["claude-haiku-4-5-20251001"]!;
  }
  if (normalized.startsWith("claude-haiku-3-5")) {
    // biome-ignore lint/style/noNonNullAssertion: key is statically present.
    return MODEL_PRICING_PER_MTOK["claude-haiku-3-5"]!;
  }
  return { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 };
}

function computeCostUsd(model: string, u: RawClaudeUsage): number {
  const p = getClaudePricing(model);
  const input = (u.input_tokens ?? 0) / 1_000_000;
  const output = (u.output_tokens ?? 0) / 1_000_000;
  const cacheRead = (u.cache_read_input_tokens ?? 0) / 1_000_000;
  const cacheCreation = (u.cache_creation_input_tokens ?? 0) / 1_000_000;
  const cost =
    input * p.input + output * p.output + cacheRead * p.cacheRead + cacheCreation * p.cacheCreation;
  return Math.round(cost * 1e6) / 1e6;
}

function usageKeyFor(line: RawClaudeSessionLine): string | undefined {
  return line.message?.id ?? line.requestId ?? line.uuid;
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
