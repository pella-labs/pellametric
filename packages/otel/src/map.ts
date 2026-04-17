// Map decoded OTLP envelopes to bematist Event drafts.
//
// The drafts produced here are partial Events — server-derived identity
// (tenant_id, engineer_id, tier) is always pulled from the verified `auth`
// context, NEVER from OTel resource attributes (contract 01 §Invariant 3).
// The OTLP HTTP handler runs the same `enforceTier` + zod validate path as
// `/v1/events` after this mapping.
//
// `client_event_id` derivation:
//   When the collector did not stamp a UUID-shaped `client_event_id` span
//   attribute, we synthesize a deterministic UUID-v5-like id from the
//   `<traceId>|<spanId>` pair using SHA-256 + RFC-4122 v4 layout patches.
//   Same trace/span pair → same uuid → idempotent under retry. (We pick UUID
//   v4 layout instead of v5 because v5 needs a namespace; the deterministic
//   hash itself is what matters, not the version bits.)

import { createHash } from "node:crypto";
import type { Event } from "@bematist/schema";
import { getAttrBool, getAttrDouble, getAttrInt, getAttrString } from "./kv";
import type {
  ExportLogsServiceRequest,
  ExportMetricsServiceRequest,
  ExportTraceServiceRequest,
  KeyValue,
  Span,
} from "./types";

export interface OtlpAuth {
  tenantId: string;
  engineerId: string;
  tier: "A" | "B" | "C";
}

/** A partial Event ready to flow into the existing enforceTier + zod pipe. */
export type EventDraft = Partial<Event> & {
  client_event_id: string;
  schema_version: number;
  ts: string;
  tenant_id: string;
  engineer_id: string;
  device_id: string;
  source: Event["source"];
  fidelity: Event["fidelity"];
  tier: Event["tier"];
  session_id: string;
  event_seq: number;
  dev_metrics: Event["dev_metrics"];
};

const KNOWN_SOURCES: ReadonlySet<Event["source"]> = new Set<Event["source"]>([
  "claude-code",
  "codex",
  "cursor",
  "opencode",
  "continue",
  "vscode-generic",
  "goose",
  "copilot-ide",
  "copilot-cli",
  "cline",
  "roo",
  "kilo",
  "antigravity",
]);

function pickSource(serviceName: string | undefined): Event["source"] {
  if (serviceName && (KNOWN_SOURCES as ReadonlySet<string>).has(serviceName)) {
    return serviceName as Event["source"];
  }
  return "vscode-generic";
}

function pickFidelity(
  spanAttrs: KeyValue[] | undefined,
  resourceAttrs: KeyValue[] | undefined,
): Event["fidelity"] {
  const v =
    getAttrString(spanAttrs, "dev_metrics.fidelity") ??
    getAttrString(resourceAttrs, "dev_metrics.fidelity");
  if (v === "full" || v === "estimated" || v === "aggregate-only" || v === "post-migration") {
    return v;
  }
  return "full";
}

function nanoToIso(nano: string | number): string {
  let ms: number;
  if (typeof nano === "number") {
    ms = nano / 1e6;
  } else {
    // string nanos — convert by string slicing to avoid precision loss past
    // 53 bits when converting to Number directly.
    const s = nano.length > 6 ? nano.slice(0, -6) : "0";
    const n = Number(s);
    ms = Number.isFinite(n) ? n : 0;
  }
  if (!Number.isFinite(ms) || ms <= 0) ms = 0;
  return new Date(ms).toISOString();
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Deterministic UUID-shaped id from a string. SHA-256 → take first 16 bytes,
 * then patch RFC-4122 v4 layout bits so the output passes uuid validators.
 * This is NOT a real UUIDv4 (no entropy) — it's a stable id derived from the
 * `<traceId>|<spanId>` pair so retries hit the same dedup key.
 */
function hashToUuid(input: string): string {
  const buf = createHash("sha256").update(input).digest();
  // RFC-4122 v4 patch
  buf[6] = (buf[6]! & 0x0f) | 0x40;
  buf[8] = (buf[8]! & 0x3f) | 0x80;
  const hex = buf.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function pickClientEventId(span: Span): string {
  const declared = getAttrString(span.attributes, "client_event_id");
  if (declared && UUID_RE.test(declared)) return declared;
  return hashToUuid(`${span.traceId}|${span.spanId}`);
}

const SUPPORTED_KINDS: ReadonlySet<Event["dev_metrics"]["event_kind"]> = new Set<
  Event["dev_metrics"]["event_kind"]
>([
  "session_start",
  "session_end",
  "llm_request",
  "llm_response",
  "tool_call",
  "tool_result",
  "code_edit_proposed",
  "code_edit_decision",
  "exec_command_start",
  "exec_command_end",
  "patch_apply_start",
  "patch_apply_end",
]);

function pickEventKind(span: Span): Event["dev_metrics"]["event_kind"] | null {
  const explicit = getAttrString(span.attributes, "dev_metrics.event_kind");
  if (explicit && (SUPPORTED_KINDS as ReadonlySet<string>).has(explicit)) {
    return explicit as Event["dev_metrics"]["event_kind"];
  }
  // Derive from span name: `gen_ai.<verb>.*` → llm_request / llm_response;
  // `dev_metrics.<kind>` → that kind; `tool.*` → tool_call.
  const name = span.name;
  if (name.startsWith("gen_ai.request") || name === "gen_ai.client.request") return "llm_request";
  if (name.startsWith("gen_ai.response")) return "llm_response";
  if (name.startsWith("tool.") || name === "execute_tool") return "tool_call";
  if (name.startsWith("dev_metrics.")) {
    const tail = name.slice("dev_metrics.".length);
    if ((SUPPORTED_KINDS as ReadonlySet<string>).has(tail)) {
      return tail as Event["dev_metrics"]["event_kind"];
    }
  }
  return null;
}

function pickTier(span: Span, fallback: Event["tier"]): Event["tier"] {
  const t =
    getAttrString(span.attributes, "bematist.tier") ??
    getAttrString(span.attributes, "dev_metrics.tier");
  if (t === "A" || t === "B" || t === "C") return t;
  return fallback;
}

function pickSessionId(span: Span): string {
  return (
    getAttrString(span.attributes, "dev_metrics.session_id") ??
    getAttrString(span.attributes, "session.id") ??
    span.traceId
  );
}

function pickEventSeq(span: Span, fallback: number): number {
  const v = getAttrInt(span.attributes, "dev_metrics.event_seq");
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  return fallback;
}

function spanToDraft(
  span: Span,
  resourceAttrs: KeyValue[] | undefined,
  auth: OtlpAuth,
  indexInRequest: number,
): EventDraft | null {
  const kind = pickEventKind(span);
  if (kind === null) return null;

  const draft: EventDraft = {
    client_event_id: pickClientEventId(span),
    schema_version: 1,
    ts: nanoToIso(span.startTimeUnixNano),
    tenant_id: auth.tenantId, // server-derived; resource service.namespace IGNORED
    engineer_id: auth.engineerId,
    device_id: getAttrString(resourceAttrs, "device.id") ?? "unknown",
    source: pickSource(getAttrString(resourceAttrs, "service.name")),
    fidelity: pickFidelity(span.attributes, resourceAttrs),
    cost_estimated: getAttrBool(span.attributes, "dev_metrics.cost_estimated") ?? false,
    tier: pickTier(span, auth.tier),
    session_id: pickSessionId(span),
    event_seq: pickEventSeq(span, indexInRequest),
    dev_metrics: {
      event_kind: kind,
      cost_usd: getAttrDouble(span.attributes, "dev_metrics.cost_usd"),
      pricing_version: getAttrString(span.attributes, "dev_metrics.pricing_version"),
      duration_ms: getAttrInt(span.attributes, "dev_metrics.duration_ms"),
      tool_name: getAttrString(span.attributes, "dev_metrics.tool_name"),
    },
  };
  const sourceVersion = getAttrString(resourceAttrs, "service.version");
  if (sourceVersion !== undefined) draft.source_version = sourceVersion;

  const system = getAttrString(span.attributes, "gen_ai.system");
  const reqModel = getAttrString(span.attributes, "gen_ai.request.model");
  const respModel = getAttrString(span.attributes, "gen_ai.response.model");
  const inputTok = getAttrInt(span.attributes, "gen_ai.usage.input_tokens");
  const outputTok = getAttrInt(span.attributes, "gen_ai.usage.output_tokens");
  const cacheRead = getAttrInt(span.attributes, "gen_ai.usage.cache_read_input_tokens");
  const cacheCreate = getAttrInt(span.attributes, "gen_ai.usage.cache_creation_input_tokens");
  if (
    system !== undefined ||
    reqModel !== undefined ||
    respModel !== undefined ||
    inputTok !== undefined ||
    outputTok !== undefined ||
    cacheRead !== undefined ||
    cacheCreate !== undefined
  ) {
    draft.gen_ai = {};
    if (system !== undefined) draft.gen_ai.system = system;
    if (reqModel !== undefined) draft.gen_ai.request = { model: reqModel };
    if (respModel !== undefined) draft.gen_ai.response = { model: respModel };
    if (
      inputTok !== undefined ||
      outputTok !== undefined ||
      cacheRead !== undefined ||
      cacheCreate !== undefined
    ) {
      draft.gen_ai.usage = {};
      if (inputTok !== undefined) draft.gen_ai.usage.input_tokens = inputTok;
      if (outputTok !== undefined) draft.gen_ai.usage.output_tokens = outputTok;
      if (cacheRead !== undefined) draft.gen_ai.usage.cache_read_input_tokens = cacheRead;
      if (cacheCreate !== undefined) draft.gen_ai.usage.cache_creation_input_tokens = cacheCreate;
    }
  }

  return draft;
}

export function mapTracesToEvents(req: ExportTraceServiceRequest, auth: OtlpAuth): EventDraft[] {
  const out: EventDraft[] = [];
  let idx = 0;
  for (const rs of req.resourceSpans) {
    const resourceAttrs = rs.resource?.attributes;
    for (const ss of rs.scopeSpans) {
      for (const span of ss.spans) {
        const draft = spanToDraft(span, resourceAttrs, auth, idx);
        idx++;
        if (draft !== null) out.push(draft);
      }
    }
  }
  return out;
}

// ---- Metrics → Events (minimal: session_start / session_end counters) ----

export function mapMetricsToEvents(req: ExportMetricsServiceRequest, auth: OtlpAuth): EventDraft[] {
  const out: EventDraft[] = [];
  let idx = 0;
  for (const rm of req.resourceMetrics) {
    const resourceAttrs = rm.resource?.attributes;
    for (const sm of rm.scopeMetrics) {
      for (const metric of sm.metrics) {
        let kind: Event["dev_metrics"]["event_kind"] | null = null;
        if (metric.name === "dev_metrics.session_start") kind = "session_start";
        else if (metric.name === "dev_metrics.session_end") kind = "session_end";
        if (kind === null) continue;
        for (const dp of metric.dataPoints ?? []) {
          const ts = dp.timeUnixNano ?? dp.startTimeUnixNano ?? "0";
          const sessionId =
            getAttrString(dp.attributes, "dev_metrics.session_id") ??
            getAttrString(dp.attributes, "session.id") ??
            "unknown";
          out.push({
            client_event_id: hashToUuid(`${metric.name}|${sessionId}|${idx}`),
            schema_version: 1,
            ts: nanoToIso(ts),
            tenant_id: auth.tenantId,
            engineer_id: auth.engineerId,
            device_id: getAttrString(resourceAttrs, "device.id") ?? "unknown",
            source: pickSource(getAttrString(resourceAttrs, "service.name")),
            fidelity: pickFidelity(dp.attributes, resourceAttrs),
            tier: auth.tier,
            session_id: sessionId,
            event_seq: idx,
            dev_metrics: { event_kind: kind },
          });
          idx++;
        }
      }
    }
  }
  return out;
}

// ---- Logs → Events (minimal: tool_call / tool_result / exec_command_*) --

export function mapLogsToEvents(req: ExportLogsServiceRequest, auth: OtlpAuth): EventDraft[] {
  const out: EventDraft[] = [];
  let idx = 0;
  for (const rl of req.resourceLogs) {
    const resourceAttrs = rl.resource?.attributes;
    for (const sl of rl.scopeLogs) {
      for (const lr of sl.logRecords) {
        const explicit = getAttrString(lr.attributes, "dev_metrics.event_kind");
        if (
          explicit !== "tool_call" &&
          explicit !== "tool_result" &&
          explicit !== "exec_command_start" &&
          explicit !== "exec_command_end"
        ) {
          continue;
        }
        const sessionId =
          getAttrString(lr.attributes, "dev_metrics.session_id") ??
          getAttrString(lr.attributes, "session.id") ??
          "unknown";
        const seq = getAttrInt(lr.attributes, "dev_metrics.event_seq") ?? idx;
        out.push({
          client_event_id: hashToUuid(`${explicit}|${sessionId}|${seq}|${idx}`),
          schema_version: 1,
          ts: nanoToIso(lr.timeUnixNano ?? lr.observedTimeUnixNano ?? "0"),
          tenant_id: auth.tenantId,
          engineer_id: auth.engineerId,
          device_id: getAttrString(resourceAttrs, "device.id") ?? "unknown",
          source: pickSource(getAttrString(resourceAttrs, "service.name")),
          fidelity: pickFidelity(lr.attributes, resourceAttrs),
          tier: auth.tier,
          session_id: sessionId,
          event_seq: seq,
          dev_metrics: { event_kind: explicit },
        });
        idx++;
      }
    }
  }
  return out;
}
