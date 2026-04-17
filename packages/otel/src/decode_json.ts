// Proto3-JSON decoder for OTLP Export*ServiceRequest payloads.
//
// Backed by @bufbuild/protobuf's `fromJson` + buf-generated bindings from the
// vendored opentelemetry-proto v1.5.0 tree. The runtime follows the
// proto3-JSON spec natively — hex trace/span IDs, int64-as-string,
// lowerCamelCase keys, enum-as-int-or-name — exactly what the collector
// emits. Sprint-1 Phase 5 shipped a duck-typed hand-rolled version; this file
// replaces it per D-S1-12. Public exports (`decodeTracesJson` /
// `decodeMetricsJson` / `decodeLogsJson` / `OtlpDecodeError`) are unchanged.
//
// Unknown fields ignored by default (bufbuild's `fromJson` option
// `ignoreUnknownFields` is false by default — we opt into `true` to match the
// old handler's tolerant behaviour; the OTLP spec marks unknown fields as MAY
// be ignored, and rejecting would fight forward compatibility).

import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { exportLogsToPublic, exportMetricsToPublic, exportTracesToPublic } from "./adapt";
import { ExportLogsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb";
import { ExportMetricsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb";
import { ExportTraceServiceRequestSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import type {
  ExportLogsServiceRequest,
  ExportMetricsServiceRequest,
  ExportTraceServiceRequest,
} from "./types";

export class OtlpDecodeError extends Error {
  code: "OTLP_DECODE" = "OTLP_DECODE";
  constructor(message: string) {
    super(message);
    this.name = "OtlpDecodeError";
  }
}

const FROM_JSON_OPTS = { ignoreUnknownFields: true } as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// OTLP/JSON spec override: trace_id / span_id / parent_span_id are encoded as
// LOWERCASE HEX strings, NOT base64. Everywhere else, `bytes` fields follow
// the default proto3-JSON base64 encoding. @bufbuild/protobuf's `fromJson`
// doesn't know about that per-field override (nothing in the .proto file
// carries it — the OTLP HTTP spec defines it out-of-band), so we walk the
// incoming JSON tree and convert hex → base64 for those three fields before
// handing off to `fromJson`.
//
// Ref: https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding
// Ref: ExportTraceServiceRequest shape — `Span.trace_id` (32 hex),
//      `Span.span_id` (16 hex), `Span.parent_span_id` (16 hex).
//
// We also convert LogRecord.trace_id / LogRecord.span_id (same field names).

const HEX_RE = /^[0-9a-fA-F]*$/;

function hexToBase64(hex: string): string {
  if (hex.length === 0) return "";
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  // btoa via binary string — bytes are all 0..255 so String.fromCharCode is
  // safe for our trace/span ID lengths (≤32 bytes).
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function convertIdField(
  obj: Record<string, unknown>,
  field: "traceId" | "spanId" | "parentSpanId",
): void {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) return;
  // Heuristic: a valid hex string of even length → convert. If it's already
  // base64 (would contain non-hex chars like '+' / '/' / '='), leave it alone.
  if (v.length % 2 === 0 && HEX_RE.test(v)) {
    obj[field] = hexToBase64(v);
  }
}

function normalizeIdsInSpan(sp: unknown): void {
  if (!isObject(sp)) return;
  convertIdField(sp, "traceId");
  convertIdField(sp, "spanId");
  convertIdField(sp, "parentSpanId");
}

function normalizeIdsInLogRecord(lr: unknown): void {
  if (!isObject(lr)) return;
  convertIdField(lr, "traceId");
  convertIdField(lr, "spanId");
}

function normalizeTraceIdsInBody(body: Record<string, unknown>): void {
  const resourceSpans = body.resourceSpans;
  if (!Array.isArray(resourceSpans)) return;
  for (const rs of resourceSpans) {
    if (!isObject(rs)) continue;
    const scopeSpans = (rs as { scopeSpans?: unknown }).scopeSpans;
    if (!Array.isArray(scopeSpans)) continue;
    for (const ss of scopeSpans) {
      if (!isObject(ss)) continue;
      const spans = (ss as { spans?: unknown }).spans;
      if (!Array.isArray(spans)) continue;
      for (const sp of spans) normalizeIdsInSpan(sp);
    }
  }
}

function normalizeLogIdsInBody(body: Record<string, unknown>): void {
  const resourceLogs = body.resourceLogs;
  if (!Array.isArray(resourceLogs)) return;
  for (const rl of resourceLogs) {
    if (!isObject(rl)) continue;
    const scopeLogs = (rl as { scopeLogs?: unknown }).scopeLogs;
    if (!Array.isArray(scopeLogs)) continue;
    for (const sl of scopeLogs) {
      if (!isObject(sl)) continue;
      const logRecords = (sl as { logRecords?: unknown }).logRecords;
      if (!Array.isArray(logRecords)) continue;
      for (const lr of logRecords) normalizeIdsInLogRecord(lr);
    }
  }
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof OtlpDecodeError) throw e;
    throw new OtlpDecodeError(e instanceof Error ? e.message : String(e));
  }
}

function cloneJson<T>(v: T): T {
  // We deep-clone the incoming JSON (structuredClone) before mutating ID
  // fields so we don't surprise the caller. The OTLP request bodies are
  // already JSON-parsed objects — structuredClone is fast enough.
  return structuredClone(v);
}

export function decodeTracesJson(body: unknown): ExportTraceServiceRequest {
  if (!isObject(body)) {
    throw new OtlpDecodeError("ExportTraceServiceRequest must be an object");
  }
  if (!Array.isArray(body.resourceSpans)) {
    throw new OtlpDecodeError("ExportTraceServiceRequest.resourceSpans missing or not an array");
  }
  const normalized = cloneJson(body);
  normalizeTraceIdsInBody(normalized);
  return wrap(() =>
    exportTracesToPublic(
      fromJson(ExportTraceServiceRequestSchema, normalized as JsonValue, FROM_JSON_OPTS),
    ),
  );
}

export function decodeMetricsJson(body: unknown): ExportMetricsServiceRequest {
  if (!isObject(body)) {
    throw new OtlpDecodeError("ExportMetricsServiceRequest must be an object");
  }
  if (!Array.isArray(body.resourceMetrics)) {
    throw new OtlpDecodeError(
      "ExportMetricsServiceRequest.resourceMetrics missing or not an array",
    );
  }
  return wrap(() =>
    exportMetricsToPublic(
      fromJson(ExportMetricsServiceRequestSchema, body as JsonValue, FROM_JSON_OPTS),
    ),
  );
}

export function decodeLogsJson(body: unknown): ExportLogsServiceRequest {
  if (!isObject(body)) {
    throw new OtlpDecodeError("ExportLogsServiceRequest must be an object");
  }
  if (!Array.isArray(body.resourceLogs)) {
    throw new OtlpDecodeError("ExportLogsServiceRequest.resourceLogs missing or not an array");
  }
  const normalized = cloneJson(body);
  normalizeLogIdsInBody(normalized);
  return wrap(() =>
    exportLogsToPublic(
      fromJson(ExportLogsServiceRequestSchema, normalized as JsonValue, FROM_JSON_OPTS),
    ),
  );
}
