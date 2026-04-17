import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync as fsRead } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  concat,
  encodeBytes,
  encodeFixed64,
  encodeLengthDelimited,
  encodeString,
} from "@bematist/otel";
import type { AuthContext } from "../auth";
import { permissiveRateLimiter, type RateLimiter } from "../auth/rateLimit";
import { InMemoryDedupStore } from "../dedup/checkDedup";
import { parseFlags } from "../flags";
import { InMemoryOrgPolicyStore } from "../tier/enforceTier";
import { createInMemoryWalAppender, type InMemoryWalAppender } from "../wal/append";
import { handleOtlp, type OtlpDeps } from "./server";

// Default in-memory deps for handleOtlp tests. Each test resets via
// beforeEach to keep WAL/dedup state independent.
let wal: InMemoryWalAppender;
let dedup: InMemoryDedupStore;
let policy: InMemoryOrgPolicyStore;
let rateLimiter: RateLimiter;

const auth: AuthContext = {
  tenantId: "tenant_real",
  engineerId: "eng_real",
  tier: "B",
  keyId: "key_1",
};

function makeDeps(overrides: Partial<OtlpDeps> = {}): OtlpDeps {
  return {
    flags: parseFlags({ OTLP_RECEIVER_ENABLED: "1", WAL_CONSUMER_ENABLED: "1" }),
    wal,
    dedupStore: dedup,
    orgPolicyStore: policy,
    rateLimiter,
    ...overrides,
  };
}

function buildSimpleTracesProto(spanName = "gen_ai.request.create"): Uint8Array {
  const traceId = new Uint8Array(16);
  for (let i = 0; i < 16; i++) traceId[i] = i + 1;
  const spanId = new Uint8Array(8);
  for (let i = 0; i < 8; i++) spanId[i] = i + 1;
  const sysKv = concat(
    encodeString(1, "gen_ai.system"),
    encodeLengthDelimited(2, encodeString(1, "anthropic")),
  );
  const kindKv = concat(
    encodeString(1, "dev_metrics.event_kind"),
    encodeLengthDelimited(2, encodeString(1, "llm_request")),
  );
  const spanBody = concat(
    encodeBytes(1, traceId),
    encodeBytes(2, spanId),
    encodeString(5, spanName),
    encodeFixed64(7, 1_737_000_000_000_000_000n),
    encodeFixed64(8, 1_737_000_000_500_000_000n),
    encodeLengthDelimited(9, sysKv),
    encodeLengthDelimited(9, kindKv),
  );
  const scopeSpansBody = encodeLengthDelimited(2, spanBody);
  const scopeSpans = encodeLengthDelimited(2, scopeSpansBody);

  // service.name = claude-code AND service.namespace = spoof_tenant
  const svcNameKv = concat(
    encodeString(1, "service.name"),
    encodeLengthDelimited(2, encodeString(1, "claude-code")),
  );
  const svcNsKv = concat(
    encodeString(1, "service.namespace"),
    encodeLengthDelimited(2, encodeString(1, "spoof_tenant")),
  );
  const resourceBody = concat(
    encodeLengthDelimited(1, svcNameKv),
    encodeLengthDelimited(1, svcNsKv),
  );
  const resource = encodeLengthDelimited(1, resourceBody);
  const resourceSpans = concat(resource, scopeSpans);
  return encodeLengthDelimited(1, resourceSpans);
}

function jsonTracesPayload() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "claude-code" } },
            { key: "service.namespace", value: { stringValue: "spoof_tenant" } },
          ],
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
                  { key: "dev_metrics.event_kind", value: { stringValue: "llm_request" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeRequest(opts: {
  body: Uint8Array | string;
  contentType: string;
  contentEncoding?: string;
  contentLength?: number;
}): Request {
  const headers: Record<string, string> = { "content-type": opts.contentType };
  if (opts.contentEncoding) headers["content-encoding"] = opts.contentEncoding;
  if (opts.contentLength !== undefined) headers["content-length"] = String(opts.contentLength);
  return new Request("http://localhost:4318/v1/traces", {
    method: "POST",
    headers,
    body: opts.body,
  });
}

beforeEach(() => {
  wal = createInMemoryWalAppender();
  dedup = new InMemoryDedupStore();
  policy = new InMemoryOrgPolicyStore();
  policy.seed("tenant_real", { tier_c_managed_cloud_optin: false, tier_default: "B" });
  rateLimiter = permissiveRateLimiter();
});

describe("handleOtlp /v1/traces (Phase 5 PRD tests 1–13)", () => {
  test("1. protobuf single-span request → 1 row in WAL", async () => {
    const buf = buildSimpleTracesProto();
    const res = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partialSuccess?: { rejectedSpans?: number } };
    expect(body).toEqual({ partialSuccess: { rejectedSpans: 0 } });
    expect(wal.drain().length).toBe(1);
  });

  test("2. JSON same-payload → 1 row in WAL", async () => {
    const res = await handleOtlp(
      makeRequest({ body: JSON.stringify(jsonTracesPayload()), contentType: "application/json" }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    expect(wal.drain().length).toBe(1);
  });

  test("3. Unknown content-type → 415", async () => {
    const res = await handleOtlp(makeRequest({ body: "x", contentType: "text/plain" }), "traces", {
      auth,
      deps: makeDeps(),
      skipRateLimit: true,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  test("4. Content-Encoding: zstd → 415", async () => {
    const res = await handleOtlp(
      makeRequest({
        body: "x",
        contentType: "application/x-protobuf",
        contentEncoding: "zstd",
      }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("UNSUPPORTED_ENCODING");
  });

  test("5. Content-Length > 16MB → 413", async () => {
    const res = await handleOtlp(
      makeRequest({
        body: "x",
        contentType: "application/x-protobuf",
        contentLength: 17_000_000,
      }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("BODY_TOO_LARGE");
  });

  test("6. Hex traceId preserved as session_id fallback in WAL row", async () => {
    const buf = buildSimpleTracesProto();
    const res = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    const rows = wal.drain();
    expect(rows.length).toBe(1);
    expect(rows[0]?.row.session_id).toBe("0102030405060708090a0b0c0d0e0f10");
  });

  test("7. gen_ai.system='anthropic' mapped into WAL row", async () => {
    const buf = buildSimpleTracesProto();
    const res = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    const rows = wal.drain();
    expect(rows[0]?.row.gen_ai_system).toBe("anthropic");
  });

  test("8. resource service.namespace='spoof_tenant' IGNORED — WAL row uses auth.tenantId", async () => {
    const buf = buildSimpleTracesProto();
    const res = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    const rows = wal.drain();
    expect(rows[0]?.row.org_id).toBe("tenant_real");
    expect(rows[0]?.tenant_id).toBe("tenant_real");
  });

  test("9. Gzip round-trip: gzipped protobuf body decodes and writes 1 row", async () => {
    const buf = buildSimpleTracesProto();
    // Node's gzipSync expects Buffer; wrap our Uint8Array.
    const gz = gzipSync(Buffer.from(buf));
    const res = await handleOtlp(
      makeRequest({
        body: new Uint8Array(gz.buffer, gz.byteOffset, gz.byteLength),
        contentType: "application/x-protobuf",
        contentEncoding: "gzip",
      }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    expect(wal.drain().length).toBe(1);
  });

  test("10. OTLP response shape is {partialSuccess: {rejectedSpans: N}}", async () => {
    // Send a Tier-C event when org has tier_c opt-in = false → tier-rejected,
    // counted into partial_success.rejectedSpans.
    const buf = buildSimpleTracesProto();
    const res = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth: { ...auth, tier: "C" }, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partialSuccess?: { rejectedSpans?: number } };
    expect(body).toEqual({ partialSuccess: { rejectedSpans: 1 } });
    expect(wal.drain().length).toBe(0);
  });

  test("11. docker-compose.dev.yml otel-collector has profiles:['otel-collector']", () => {
    // Port-collision documentation guard. We do NOT modify docker-compose
    // in Phase 5; this asserts the existing guard is still in place so
    // `:4318` doesn't double-bind in dev.
    const yml = fsRead(
      // From this test file's location: apps/ingest/src/otlp/server.test.ts
      // → ../../../../docker-compose.dev.yml
      `${__dirname}/../../../../docker-compose.dev.yml`,
      "utf8",
    );
    expect(yml).toMatch(/otel-collector:[\s\S]*profiles:\s*\[\s*"otel-collector"\s*\]/);
  });

  test("12. Missing bearer → 401", async () => {
    const buf = buildSimpleTracesProto();
    const res = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth: null, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(401);
  });

  test("13. Rate limit shared with events path: throttled limiter → 429", async () => {
    let calls = 0;
    const throttled: RateLimiter = {
      async consume() {
        calls++;
        if (calls === 1) {
          return { allowed: true, remaining: 999, retryAfterMs: 0 };
        }
        return { allowed: false, remaining: 0, retryAfterMs: 1000 };
      },
    };
    const buf = buildSimpleTracesProto();
    const deps = makeDeps({ rateLimiter: throttled });
    const r1 = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps },
    );
    expect(r1.status).toBe(200);
    const r2 = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps },
    );
    expect(r2.status).toBe(429);
    const body = (await r2.json()) as { code?: string };
    expect(body.code).toBe("RATE_LIMITED");
  });

  test("OTLP receiver disabled → 503 OTLP_DISABLED", async () => {
    const buf = buildSimpleTracesProto();
    const flags = parseFlags({ OTLP_RECEIVER_ENABLED: "0" });
    const res = await handleOtlp(
      makeRequest({ body: buf, contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps: makeDeps({ flags }), skipRateLimit: true },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("OTLP_DISABLED");
  });

  test("malformed protobuf → 400 OTLP_DECODE", async () => {
    const res = await handleOtlp(
      makeRequest({ body: new Uint8Array([0x80]), contentType: "application/x-protobuf" }),
      "traces",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("OTLP_DECODE");
  });

  test("M3: metrics partial_success uses rejectedDataPoints (OTLP spec)", async () => {
    // Empty metrics payload → 0 rejected; the shape must still have the
    // metrics-specific key name.
    const emptyJson = JSON.stringify({ resourceMetrics: [] });
    const res = await handleOtlp(
      makeRequest({
        body: new TextEncoder().encode(emptyJson),
        contentType: "application/json",
      }),
      "metrics",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      partialSuccess?: { rejectedDataPoints?: number; rejectedSpans?: number };
    };
    expect(body.partialSuccess).toBeDefined();
    expect(body.partialSuccess?.rejectedDataPoints).toBe(0);
    expect(body.partialSuccess?.rejectedSpans).toBeUndefined();
  });

  test("M3: logs partial_success uses rejectedLogRecords (OTLP spec)", async () => {
    const emptyJson = JSON.stringify({ resourceLogs: [] });
    const res = await handleOtlp(
      makeRequest({
        body: new TextEncoder().encode(emptyJson),
        contentType: "application/json",
      }),
      "logs",
      { auth, deps: makeDeps(), skipRateLimit: true },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      partialSuccess?: { rejectedLogRecords?: number; rejectedSpans?: number };
    };
    expect(body.partialSuccess).toBeDefined();
    expect(body.partialSuccess?.rejectedLogRecords).toBe(0);
    expect(body.partialSuccess?.rejectedSpans).toBeUndefined();
  });
});
