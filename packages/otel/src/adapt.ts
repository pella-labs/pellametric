// Adapter: @bufbuild/protobuf generated OTLP messages → bematist public shape.
//
// The public TS interfaces in ./types.ts are the boundary the mapping layer
// (map.ts) depends on. They predate the @bufbuild/protobuf swap (D-S1-12) and
// stay the stable contract. The generated runtime uses bigint for int64 and
// Uint8Array for bytes + discriminated-union `oneof` for AnyValue / Metric.data
// / NumberDataPoint.value; this module normalizes those down to the hex-string
// + string|number + flat-field shape callers expect.
//
// Public shape rules:
//   - trace_id / span_id / parent_span_id → lowercase hex string (never bytes).
//   - start_time_unix_nano etc. → number when ≤ Number.MAX_SAFE_INTEGER, else
//     decimal string (matches the existing JSON decoder behaviour).
//   - AnyValue oneof → flattened into stringValue / boolValue / intValue /
//     doubleValue / arrayValue / kvlistValue / bytesValue.
//   - Metric Sum / Gauge envelopes → flattened to `dataPoints` on the Metric
//     itself (mapper only reads Sum/Gauge; Histogram/Summary out of scope).
//   - NumberDataPoint.value oneof → flattened to asDouble / asInt.
//
// Unknown / unused fields are dropped silently — the mapper never reads them.

import type { ExportLogsServiceRequest as PbExportLogs } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb";
import type { ExportMetricsServiceRequest as PbExportMetrics } from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb";
import type { ExportTraceServiceRequest as PbExportTraces } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import type {
  AnyValue as PbAnyValue,
  KeyValue as PbKeyValue,
  InstrumentationScope as PbScope,
} from "./gen/opentelemetry/proto/common/v1/common_pb";
import type { LogRecord as PbLogRecord } from "./gen/opentelemetry/proto/logs/v1/logs_pb";
import type {
  Metric as PbMetric,
  NumberDataPoint as PbNumberDataPoint,
} from "./gen/opentelemetry/proto/metrics/v1/metrics_pb";
import type { Resource as PbResource } from "./gen/opentelemetry/proto/resource/v1/resource_pb";
import type {
  Span as PbSpan,
  Status as PbStatus,
} from "./gen/opentelemetry/proto/trace/v1/trace_pb";
import type {
  AnyValue,
  ExportLogsServiceRequest,
  ExportMetricsServiceRequest,
  ExportTraceServiceRequest,
  InstrumentationScope,
  KeyValue,
  LogRecord,
  Metric,
  NumberDataPoint,
  Resource,
  ResourceLogs,
  ResourceMetrics,
  ResourceSpans,
  ScopeLogs,
  ScopeMetrics,
  ScopeSpans,
  Span,
} from "./types";

// ---- Primitives ---------------------------------------------------------

function bytesToHex(b: Uint8Array | undefined): string {
  if (!b || b.length === 0) return "";
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i]?.toString(16).padStart(2, "0");
  return out;
}

function bigintToNanoPublic(v: bigint | undefined): string | number {
  if (v === undefined) return "0";
  // Safe-int fits a JS number exactly; bigger values stay as decimal strings.
  if (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(v);
  }
  return v.toString();
}

function bigintToIntPublic(v: bigint | undefined): string | number | undefined {
  if (v === undefined) return undefined;
  if (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(v);
  }
  return v.toString();
}

// ---- AnyValue -----------------------------------------------------------

function anyValueToPublic(v: PbAnyValue | undefined): AnyValue {
  const out: AnyValue = {};
  if (!v) return out;
  const inner = v.value;
  if (!inner || inner.case === undefined) return out;
  switch (inner.case) {
    case "stringValue":
      out.stringValue = inner.value;
      break;
    case "boolValue":
      out.boolValue = inner.value;
      break;
    case "intValue": {
      const n = bigintToIntPublic(inner.value);
      if (n !== undefined) out.intValue = n;
      break;
    }
    case "doubleValue":
      out.doubleValue = inner.value;
      break;
    case "arrayValue":
      out.arrayValue = { values: inner.value.values.map(anyValueToPublic) };
      break;
    case "kvlistValue":
      out.kvlistValue = { values: inner.value.values.map(keyValueToPublic) };
      break;
    case "bytesValue":
      out.bytesValue = bytesToHex(inner.value);
      break;
  }
  return out;
}

function keyValueToPublic(kv: PbKeyValue): KeyValue {
  return { key: kv.key, value: anyValueToPublic(kv.value) };
}

function keyValuesToPublic(kvs: PbKeyValue[] | undefined): KeyValue[] {
  if (!kvs || kvs.length === 0) return [];
  return kvs.map(keyValueToPublic);
}

// ---- Resource / Scope ---------------------------------------------------

function resourceToPublic(r: PbResource | undefined): Resource | undefined {
  if (!r) return undefined;
  return { attributes: keyValuesToPublic(r.attributes) };
}

function scopeToPublic(s: PbScope | undefined): InstrumentationScope | undefined {
  if (!s) return undefined;
  const out: InstrumentationScope = {};
  if (s.name) out.name = s.name;
  if (s.version) out.version = s.version;
  const attrs = keyValuesToPublic(s.attributes);
  if (attrs.length > 0) out.attributes = attrs;
  return out;
}

// ---- Traces -------------------------------------------------------------

function statusToPublic(st: PbStatus | undefined): { code?: number; message?: string } | undefined {
  if (!st) return undefined;
  const out: { code?: number; message?: string } = {};
  if (st.code !== undefined && st.code !== 0) out.code = st.code;
  else if (st.code !== undefined) out.code = st.code; // keep 0 too so tests can read it
  if (st.message) out.message = st.message;
  return out;
}

function spanToPublic(s: PbSpan): Span {
  const span: Span = {
    traceId: bytesToHex(s.traceId),
    spanId: bytesToHex(s.spanId),
    name: s.name,
    startTimeUnixNano: bigintToNanoPublic(s.startTimeUnixNano),
    endTimeUnixNano: bigintToNanoPublic(s.endTimeUnixNano),
    attributes: keyValuesToPublic(s.attributes),
  };
  const parent = bytesToHex(s.parentSpanId);
  if (parent) span.parentSpanId = parent;
  if (s.kind !== undefined && s.kind !== 0) span.kind = s.kind;
  const status = statusToPublic(s.status);
  if (status !== undefined) span.status = status;
  return span;
}

export function exportTracesToPublic(req: PbExportTraces): ExportTraceServiceRequest {
  const resourceSpans: ResourceSpans[] = req.resourceSpans.map((rs): ResourceSpans => {
    const scopeSpans: ScopeSpans[] = rs.scopeSpans.map((ss): ScopeSpans => {
      const out: ScopeSpans = { spans: ss.spans.map(spanToPublic) };
      const sc = scopeToPublic(ss.scope);
      if (sc !== undefined) out.scope = sc;
      return out;
    });
    const out: ResourceSpans = { scopeSpans };
    const res = resourceToPublic(rs.resource);
    if (res !== undefined) out.resource = res;
    return out;
  });
  return { resourceSpans };
}

// ---- Metrics ------------------------------------------------------------

function numberDataPointToPublic(p: PbNumberDataPoint): NumberDataPoint {
  const out: NumberDataPoint = { attributes: keyValuesToPublic(p.attributes) };
  if (p.startTimeUnixNano !== undefined && p.startTimeUnixNano !== 0n) {
    out.startTimeUnixNano = bigintToNanoPublic(p.startTimeUnixNano);
  }
  if (p.timeUnixNano !== undefined && p.timeUnixNano !== 0n) {
    out.timeUnixNano = bigintToNanoPublic(p.timeUnixNano);
  }
  const inner = p.value;
  if (inner && inner.case === "asDouble") out.asDouble = inner.value;
  else if (inner && inner.case === "asInt") {
    const n = bigintToIntPublic(inner.value);
    if (n !== undefined) out.asInt = n;
  }
  return out;
}

function metricToPublic(m: PbMetric): Metric {
  const out: Metric = { name: m.name };
  if (m.unit) out.unit = m.unit;
  const data = m.data;
  if (data && (data.case === "sum" || data.case === "gauge")) {
    out.dataPoints = data.value.dataPoints.map(numberDataPointToPublic);
  }
  return out;
}

export function exportMetricsToPublic(req: PbExportMetrics): ExportMetricsServiceRequest {
  const resourceMetrics: ResourceMetrics[] = req.resourceMetrics.map((rm): ResourceMetrics => {
    const scopeMetrics: ScopeMetrics[] = rm.scopeMetrics.map((sm): ScopeMetrics => {
      const out: ScopeMetrics = { metrics: sm.metrics.map(metricToPublic) };
      const sc = scopeToPublic(sm.scope);
      if (sc !== undefined) out.scope = sc;
      return out;
    });
    const out: ResourceMetrics = { scopeMetrics };
    const res = resourceToPublic(rm.resource);
    if (res !== undefined) out.resource = res;
    return out;
  });
  return { resourceMetrics };
}

// ---- Logs ---------------------------------------------------------------

function logRecordToPublic(lr: PbLogRecord): LogRecord {
  const out: LogRecord = { attributes: keyValuesToPublic(lr.attributes) };
  if (lr.timeUnixNano !== undefined && lr.timeUnixNano !== 0n) {
    out.timeUnixNano = bigintToNanoPublic(lr.timeUnixNano);
  }
  if (lr.observedTimeUnixNano !== undefined && lr.observedTimeUnixNano !== 0n) {
    out.observedTimeUnixNano = bigintToNanoPublic(lr.observedTimeUnixNano);
  }
  if (lr.severityNumber !== undefined && lr.severityNumber !== 0) {
    out.severityNumber = lr.severityNumber;
  }
  if (lr.body) out.body = anyValueToPublic(lr.body);
  const traceHex = bytesToHex(lr.traceId);
  if (traceHex) out.traceId = traceHex;
  const spanHex = bytesToHex(lr.spanId);
  if (spanHex) out.spanId = spanHex;
  return out;
}

export function exportLogsToPublic(req: PbExportLogs): ExportLogsServiceRequest {
  const resourceLogs: ResourceLogs[] = req.resourceLogs.map((rl): ResourceLogs => {
    const scopeLogs: ScopeLogs[] = rl.scopeLogs.map((sl): ScopeLogs => {
      const out: ScopeLogs = { logRecords: sl.logRecords.map(logRecordToPublic) };
      const sc = scopeToPublic(sl.scope);
      if (sc !== undefined) out.scope = sc;
      return out;
    });
    const out: ResourceLogs = { scopeLogs };
    const res = resourceToPublic(rl.resource);
    if (res !== undefined) out.resource = res;
    return out;
  });
  return { resourceLogs };
}
