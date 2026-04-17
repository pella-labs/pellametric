// Bematist — @bematist/otel public surface.
//
// Sprint-1 Phase 5 shipped a hand-rolled proto3 + proto3-JSON decoder as a
// stop-gap; the Sprint-1 follow-up (D-S1-12) replaces it with
// @bufbuild/protobuf + vendored opentelemetry-proto v1.5.0 + buf-generated
// bindings in `src/gen/`. The public mapping API stays stable across the
// swap — callers continue to import `decodeTracesProto`, `decodeTracesJson`,
// `OtlpDecodeError`, `mapTracesToEvents`, etc. exactly as before.

export * from "./decode_json";
export * from "./decode_proto";
export * from "./kv";
export * from "./map";
export * from "./types";
// Test-only wire helpers kept for map.test.ts fixtures (the fixture code is
// self-describing — every wire byte visible). New code should use `create()`
// + `toBinary()` from @bufbuild/protobuf + the schemas in ./gen/ instead.
export * from "./varint";
