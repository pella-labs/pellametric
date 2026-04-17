import { describe, expect, test } from "bun:test";
import { create, toBinary } from "@bufbuild/protobuf";
import { ExportTraceServiceRequestSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import {
  decodeLogsJson,
  decodeMetricsJson,
  decodeTracesJson,
  decodeTracesProto,
  OtlpDecodeError,
} from "./index";

describe("decodeTracesProto", () => {
  test("round-trips an ExportTraceServiceRequest with 1 span (bufbuild-built fixture)", () => {
    // Build the request via the generated `create()` factory, serialize with
    // `toBinary`, then run the public decoder — exercises the full
    // bufbuild-descriptors → public-shape adapter path.
    const traceIdBytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) traceIdBytes[i] = i + 1;
    const spanIdBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) spanIdBytes[i] = i + 1;

    const req = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { value: { case: "stringValue", value: "claude-code" } },
              },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: traceIdBytes,
                  spanId: spanIdBytes,
                  name: "gen_ai.request.create",
                  startTimeUnixNano: 1_737_000_000_000_000_000n,
                  endTimeUnixNano: 1_737_000_000_500_000_000n,
                  attributes: [
                    {
                      key: "gen_ai.system",
                      value: { value: { case: "stringValue", value: "anthropic" } },
                    },
                    {
                      key: "dev_metrics.event_kind",
                      value: { value: { case: "stringValue", value: "llm_request" } },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const buf = toBinary(ExportTraceServiceRequestSchema, req);
    const decoded = decodeTracesProto(buf);
    expect(decoded.resourceSpans.length).toBe(1);
    const rs = decoded.resourceSpans[0]!;
    expect(rs.resource?.attributes[0]?.key).toBe("service.name");
    expect(rs.resource?.attributes[0]?.value.stringValue).toBe("claude-code");
    expect(rs.scopeSpans.length).toBe(1);
    const sp = rs.scopeSpans[0]?.spans[0];
    if (!sp) throw new Error("sp missing");
    expect(sp.name).toBe("gen_ai.request.create");
    expect(sp.traceId).toBe("0102030405060708090a0b0c0d0e0f10");
    expect(sp.spanId).toBe("0102030405060708");
    expect(sp.attributes?.find((a) => a.key === "gen_ai.system")?.value.stringValue).toBe(
      "anthropic",
    );
    expect(sp.attributes?.find((a) => a.key === "dev_metrics.event_kind")?.value.stringValue).toBe(
      "llm_request",
    );
  });

  test("int64 nano values past 2^53 come back as decimal strings", () => {
    const req = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: new Uint8Array(16).fill(1),
                  spanId: new Uint8Array(8).fill(2),
                  name: "x",
                  startTimeUnixNano: 1_737_000_000_000_000_000n,
                  endTimeUnixNano: 1_737_000_000_500_000_000n,
                },
              ],
            },
          ],
        },
      ],
    });
    const decoded = decodeTracesProto(toBinary(ExportTraceServiceRequestSchema, req));
    const sp = decoded.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    if (!sp) throw new Error("sp missing");
    expect(typeof sp.startTimeUnixNano).toBe("string");
    expect(sp.startTimeUnixNano).toBe("1737000000000000000");
  });

  test("non-Uint8Array input → OtlpDecodeError", () => {
    // @ts-expect-error intentional bad type for runtime guard
    expect(() => decodeTracesProto("not bytes")).toThrow(OtlpDecodeError);
  });
});

describe("decodeTracesJson", () => {
  test("accepts a known-good payload with hex traceId/spanId", () => {
    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "abcd1234abcd1234abcd1234abcd1234",
                  spanId: "1234567890abcdef",
                  name: "gen_ai.request.create",
                  startTimeUnixNano: "1737000000000000000",
                  endTimeUnixNano: "1737000000500000000",
                  attributes: [
                    { key: "gen_ai.system", value: { stringValue: "anthropic" } },
                    { key: "dev_metrics.event_kind", value: { stringValue: "llm_request" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const req = decodeTracesJson(body);
    const sp = req.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    if (!sp) throw new Error("sp missing");
    expect(sp.traceId).toBe("abcd1234abcd1234abcd1234abcd1234");
    expect(sp.spanId).toBe("1234567890abcdef");
    expect(sp.startTimeUnixNano).toBe("1737000000000000000");
  });

  test("throws OtlpDecodeError on missing resourceSpans", () => {
    expect(() => decodeTracesJson({})).toThrow(OtlpDecodeError);
  });

  test("Int64 nano accepted as both string and number", () => {
    const asString = decodeTracesJson({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "00112233445566778899aabbccddeeff",
                  spanId: "0011223344556677",
                  name: "x",
                  startTimeUnixNano: "1737000000000000000",
                  endTimeUnixNano: "1737000000500000000",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(typeof asString.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.startTimeUnixNano).toBe(
      "string",
    );
    const asNumber = decodeTracesJson({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "00112233445566778899aabbccddeeff",
                  spanId: "0011223344556677",
                  name: "x",
                  // Small enough to be safe-int; bufbuild's proto3-JSON accepts a
                  // JS number for int64 fields as long as it fits without
                  // precision loss, and our adapter lowers safe-int bigints
                  // back to JS numbers.
                  startTimeUnixNano: 1_737_000_000,
                  endTimeUnixNano: 1_737_000_500,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(typeof asNumber.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.startTimeUnixNano).toBe(
      "number",
    );
  });
});

describe("decodeMetricsJson / decodeLogsJson", () => {
  test("metrics: decodes minimal sum-shaped envelope", () => {
    const req = decodeMetricsJson({
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "dev_metrics.session_start",
                  sum: {
                    dataPoints: [
                      {
                        timeUnixNano: "1737000000000000000",
                        asInt: "1",
                        attributes: [
                          { key: "dev_metrics.session_id", value: { stringValue: "sess_1" } },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(req.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.name).toBe(
      "dev_metrics.session_start",
    );
  });

  test("logs: decodes minimal logRecord with body and attributes", () => {
    const req = decodeLogsJson({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: "1737000000000000000",
                  body: { stringValue: "tool_call:read_file" },
                  attributes: [
                    { key: "dev_metrics.event_kind", value: { stringValue: "tool_call" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(req.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.body?.stringValue).toBe(
      "tool_call:read_file",
    );
  });
});
