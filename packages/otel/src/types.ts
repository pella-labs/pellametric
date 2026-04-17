// OTel proto3 message TypeScript types — minimal subset.
//
// We intentionally do NOT pull in `@bufbuild/protobuf` runtime in Sprint 1
// (Bun 1.0.7 + no buf CI step). These are plain TS interfaces sufficient to
// drive the hand-rolled proto3 + proto3-JSON decoders and the OTLP→Event
// mapping. When the `@bufbuild/protobuf` swap lands (D-S1-12, coord
// Jorge/Sebastian, Sprint 2), the public mapping API stays stable — only the
// `decode_*.ts` files are replaced.
//
// Field naming follows OTel proto3-JSON: lowerCamelCase. Int64 fields land as
// `string | number` (proto3-JSON canonical encoding) and are normalized inside
// the decoders.

export interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values: AnyValue[] };
  kvlistValue?: { values: KeyValue[] };
  bytesValue?: string;
}

export interface KeyValue {
  key: string;
  value: AnyValue;
}

export interface Resource {
  attributes: KeyValue[];
}

export interface InstrumentationScope {
  name?: string;
  version?: string;
  attributes?: KeyValue[];
}

export interface Span {
  /** Hex-encoded; never base64-decoded. 32 hex chars (16 bytes) per OTel spec. */
  traceId: string;
  /** Hex-encoded; 16 hex chars (8 bytes) per OTel spec. */
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** Enum int — left as a number; we don't expand to string. */
  kind?: number;
  /** Int64 as string (proto3-JSON) or number (small, dev). */
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  attributes?: KeyValue[];
  status?: { code?: number; message?: string };
}

export interface ScopeSpans {
  scope?: InstrumentationScope;
  spans: Span[];
}

export interface ResourceSpans {
  resource?: Resource;
  scopeSpans: ScopeSpans[];
}

export interface ExportTraceServiceRequest {
  resourceSpans: ResourceSpans[];
}

// ---- Metrics (minimal — only what the mapper touches) --------------------

export interface NumberDataPoint {
  attributes?: KeyValue[];
  startTimeUnixNano?: string | number;
  timeUnixNano?: string | number;
  asDouble?: number;
  asInt?: string | number;
}

export interface Metric {
  name: string;
  unit?: string;
  /** Sum / Gauge envelopes flatten to dataPoints here for our minimal mapper. */
  dataPoints?: NumberDataPoint[];
}

export interface ScopeMetrics {
  scope?: InstrumentationScope;
  metrics: Metric[];
}

export interface ResourceMetrics {
  resource?: Resource;
  scopeMetrics: ScopeMetrics[];
}

export interface ExportMetricsServiceRequest {
  resourceMetrics: ResourceMetrics[];
}

// ---- Logs (minimal) ------------------------------------------------------

export interface LogRecord {
  timeUnixNano?: string | number;
  observedTimeUnixNano?: string | number;
  severityNumber?: number;
  body?: AnyValue;
  attributes?: KeyValue[];
  traceId?: string;
  spanId?: string;
}

export interface ScopeLogs {
  scope?: InstrumentationScope;
  logRecords: LogRecord[];
}

export interface ResourceLogs {
  resource?: Resource;
  scopeLogs: ScopeLogs[];
}

export interface ExportLogsServiceRequest {
  resourceLogs: ResourceLogs[];
}
