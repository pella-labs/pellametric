import { describe, expect, test } from "bun:test";
import {
  concat,
  decodeTracesJson,
  decodeTracesProto,
  encodeBytes,
  encodeFixed64,
  encodeLengthDelimited,
  encodeString,
  mapLogsToEvents,
  mapMetricsToEvents,
  mapTracesToEvents,
  OtlpDecodeError,
} from "./index";

const auth = { tenantId: "tenant_real", engineerId: "eng_real", tier: "B" } as const;

function buildSimpleTracesProto(opts: {
  serviceName?: string;
  serviceNamespace?: string;
  traceIdHex?: string;
  spanIdHex?: string;
  spanName?: string;
}): Uint8Array {
  const traceId = new Uint8Array(16);
  for (let i = 0; i < 16; i++) traceId[i] = i + 1;
  const spanId = new Uint8Array(8);
  for (let i = 0; i < 8; i++) spanId[i] = i + 1;

  // gen_ai.system = "anthropic"
  const sysKv = concat(
    encodeString(1, "gen_ai.system"),
    encodeLengthDelimited(2, encodeString(1, "anthropic")),
  );
  // gen_ai.request.model = "claude-haiku-4-5"
  const reqModelKv = concat(
    encodeString(1, "gen_ai.request.model"),
    encodeLengthDelimited(2, encodeString(1, "claude-haiku-4-5")),
  );
  // dev_metrics.event_kind = "llm_request"
  const kindKv = concat(
    encodeString(1, "dev_metrics.event_kind"),
    encodeLengthDelimited(2, encodeString(1, "llm_request")),
  );

  const spanBody = concat(
    encodeBytes(1, traceId),
    encodeBytes(2, spanId),
    encodeString(5, opts.spanName ?? "gen_ai.request.create"),
    encodeFixed64(7, 1_737_000_000_000_000_000n),
    encodeFixed64(8, 1_737_000_000_500_000_000n),
    encodeLengthDelimited(9, sysKv),
    encodeLengthDelimited(9, reqModelKv),
    encodeLengthDelimited(9, kindKv),
  );

  // ScopeSpans { spans = 2: repeated Span } — wrap each Span at field 2.
  const scopeSpansBody = encodeLengthDelimited(2, spanBody);
  // ResourceSpans { scope_spans = 2 } — wrap ScopeSpans at field 2.
  const scopeSpans = encodeLengthDelimited(2, scopeSpansBody);

  // Resource attributes
  const resourceAttrs: Uint8Array[] = [];
  if (opts.serviceName) {
    resourceAttrs.push(
      encodeLengthDelimited(
        1,
        concat(
          encodeString(1, "service.name"),
          encodeLengthDelimited(2, encodeString(1, opts.serviceName)),
        ),
      ),
    );
  }
  if (opts.serviceNamespace) {
    resourceAttrs.push(
      encodeLengthDelimited(
        1,
        concat(
          encodeString(1, "service.namespace"),
          encodeLengthDelimited(2, encodeString(1, opts.serviceNamespace)),
        ),
      ),
    );
  }
  const resource = concat(...resourceAttrs);
  const resourceSpans = concat(encodeLengthDelimited(1, resource), scopeSpans);
  return encodeLengthDelimited(1, resourceSpans);
}

describe("mapTracesToEvents (proto path)", () => {
  test("1 span → 1 EventDraft with mapped gen_ai.system + event_kind + source", () => {
    const buf = buildSimpleTracesProto({ serviceName: "claude-code" });
    const req = decodeTracesProto(buf);
    const events = mapTracesToEvents(req, auth);
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.source).toBe("claude-code");
    expect(e.gen_ai?.system).toBe("anthropic");
    expect(e.gen_ai?.request?.model).toBe("claude-haiku-4-5");
    expect(e.dev_metrics.event_kind).toBe("llm_request");
    expect(e.tenant_id).toBe("tenant_real");
    expect(e.engineer_id).toBe("eng_real");
    expect(e.tier).toBe("B");
    expect(e.schema_version).toBe(1);
  });

  test("hex traceId preserved in session_id fallback", () => {
    const buf = buildSimpleTracesProto({ serviceName: "claude-code" });
    const req = decodeTracesProto(buf);
    const events = mapTracesToEvents(req, auth);
    expect(events[0]?.session_id).toBe("0102030405060708090a0b0c0d0e0f10");
  });

  test("service.namespace IGNORED for tenant identity (auth wins)", () => {
    const buf = buildSimpleTracesProto({
      serviceName: "claude-code",
      serviceNamespace: "spoof_tenant",
    });
    const req = decodeTracesProto(buf);
    const events = mapTracesToEvents(req, auth);
    expect(events[0]?.tenant_id).toBe(auth.tenantId);
    expect(events[0]?.tenant_id).not.toBe("spoof_tenant");
  });

  test("unknown service.name → source 'vscode-generic'", () => {
    const buf = buildSimpleTracesProto({ serviceName: "weird-tool" });
    const req = decodeTracesProto(buf);
    const events = mapTracesToEvents(req, auth);
    expect(events[0]?.source).toBe("vscode-generic");
  });
});

describe("JSON ↔ proto parity", () => {
  test("identical EventDraft from JSON-decoded same payload", () => {
    const protoBuf = buildSimpleTracesProto({ serviceName: "claude-code" });
    const fromProto = mapTracesToEvents(decodeTracesProto(protoBuf), auth);

    const jsonReq = decodeTracesJson({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "0102030405060708090a0b0c0d0e0f10",
                  spanId: "0102030405060708",
                  name: "gen_ai.request.create",
                  startTimeUnixNano: "1737000000000000000",
                  endTimeUnixNano: "1737000000500000000",
                  attributes: [
                    { key: "gen_ai.system", value: { stringValue: "anthropic" } },
                    {
                      key: "gen_ai.request.model",
                      value: { stringValue: "claude-haiku-4-5" },
                    },
                    {
                      key: "dev_metrics.event_kind",
                      value: { stringValue: "llm_request" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const fromJson = mapTracesToEvents(jsonReq, auth);

    expect(fromJson.length).toBe(fromProto.length);
    expect(fromJson[0]?.source).toBe(fromProto[0]?.source);
    expect(fromJson[0]?.session_id).toBe(fromProto[0]?.session_id);
    expect(fromJson[0]?.gen_ai?.system).toBe(fromProto[0]?.gen_ai?.system);
    expect(fromJson[0]?.dev_metrics.event_kind).toBe(fromProto[0]?.dev_metrics.event_kind);
    expect(fromJson[0]?.client_event_id).toBe(fromProto[0]?.client_event_id);
  });
});

describe("mapTracesToEvents edge cases", () => {
  test("empty resourceSpans → []", () => {
    expect(mapTracesToEvents({ resourceSpans: [] }, auth)).toEqual([]);
  });

  test("span name not mappable → dropped", () => {
    const req = decodeTracesJson({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "00112233445566778899aabbccddeeff",
                  spanId: "0011223344556677",
                  name: "some.unrelated.span",
                  startTimeUnixNano: "1737000000000000000",
                  endTimeUnixNano: "1737000000500000000",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(mapTracesToEvents(req, auth)).toEqual([]);
  });

  test("OTLP decode error throws OtlpDecodeError with code 'OTLP_DECODE'", () => {
    try {
      decodeTracesJson({});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OtlpDecodeError);
      expect((e as OtlpDecodeError).code).toBe("OTLP_DECODE");
    }
  });
});

describe("metrics + logs minimal mappers", () => {
  test("mapMetricsToEvents emits session_start for matching counter", () => {
    const events = mapMetricsToEvents(
      {
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "dev_metrics.session_start",
                    dataPoints: [
                      {
                        timeUnixNano: "1737000000000000000",
                        asInt: 1,
                        attributes: [
                          { key: "dev_metrics.session_id", value: { stringValue: "sess_x" } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      auth,
    );
    expect(events.length).toBe(1);
    expect(events[0]?.dev_metrics.event_kind).toBe("session_start");
    expect(events[0]?.session_id).toBe("sess_x");
  });

  test("mapLogsToEvents emits tool_call when attribute present", () => {
    const events = mapLogsToEvents(
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: "1737000000000000000",
                    body: { stringValue: "tool" },
                    attributes: [
                      { key: "dev_metrics.event_kind", value: { stringValue: "tool_call" } },
                      { key: "dev_metrics.session_id", value: { stringValue: "sess_y" } },
                    ],
                  },
                  {
                    timeUnixNano: "1737000000000000000",
                    body: { stringValue: "ignored" },
                    attributes: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      auth,
    );
    expect(events.length).toBe(1);
    expect(events[0]?.dev_metrics.event_kind).toBe("tool_call");
  });
});
