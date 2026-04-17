// Proto3 binary decoder for OTLP Export*ServiceRequest payloads.
//
// Backed by @bufbuild/protobuf's descriptor-based runtime + buf-generated
// bindings from the vendored opentelemetry-proto v1.5.0 tree (see
// packages/otel/vendor/opentelemetry-proto/VERSION + buf.yaml + buf.gen.yaml).
// Sprint-1 Phase 5 shipped a hand-rolled parser; this file replaces it per
// D-S1-12 — public API (decodeTracesProto / decodeMetricsProto / decodeLogsProto
// / OtlpDecodeError) is unchanged, and the mapping layer (`./map.ts`) plus the
// ingest OTLP server keep the same interface.
//
// The generated runtime uses bigint + Uint8Array + discriminated-union oneofs;
// we bridge to the public shape in `./adapt.ts` so `./types.ts` stays the
// stable contract.

import { fromBinary } from "@bufbuild/protobuf";
import { exportLogsToPublic, exportMetricsToPublic, exportTracesToPublic } from "./adapt";
import { OtlpDecodeError } from "./decode_json";
import { ExportLogsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb";
import { ExportMetricsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb";
import { ExportTraceServiceRequestSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import type {
  ExportLogsServiceRequest,
  ExportMetricsServiceRequest,
  ExportTraceServiceRequest,
} from "./types";

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof OtlpDecodeError) throw e;
    throw new OtlpDecodeError(e instanceof Error ? e.message : String(e));
  }
}

function assertUint8(buf: unknown, fn: string): asserts buf is Uint8Array {
  if (!(buf instanceof Uint8Array)) {
    throw new OtlpDecodeError(`${fn}: input must be Uint8Array`);
  }
}

export function decodeTracesProto(buf: Uint8Array): ExportTraceServiceRequest {
  assertUint8(buf, "decodeTracesProto");
  return wrap(() => exportTracesToPublic(fromBinary(ExportTraceServiceRequestSchema, buf)));
}

export function decodeMetricsProto(buf: Uint8Array): ExportMetricsServiceRequest {
  assertUint8(buf, "decodeMetricsProto");
  return wrap(() => exportMetricsToPublic(fromBinary(ExportMetricsServiceRequestSchema, buf)));
}

export function decodeLogsProto(buf: Uint8Array): ExportLogsServiceRequest {
  assertUint8(buf, "decodeLogsProto");
  return wrap(() => exportLogsToPublic(fromBinary(ExportLogsServiceRequestSchema, buf)));
}

// `OtlpDecodeError` is defined in `./decode_json` and re-exported via
// `./index`. Imports from `@bematist/otel` (not `./decode_proto` directly)
// continue to resolve it unchanged.
