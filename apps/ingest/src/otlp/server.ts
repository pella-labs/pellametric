// OTLP HTTP receiver (Sprint-1 Phase-5, PRD §Phase 5).
//
// Bun.serve on :4318. Three endpoints — `/v1/traces`, `/v1/metrics`, `/v1/logs` —
// dispatched on Content-Type:
//   - `application/x-protobuf` → hand-rolled proto3 decoder (decode_proto.ts).
//   - `application/json`       → proto3-JSON decoder (decode_json.ts).
//   - anything else            → 415 UNSUPPORTED_MEDIA_TYPE.
//
// Content-Encoding:
//   - none / unset             → consume body as-is.
//   - `gzip`                   → DecompressionStream("gzip") via Bun native.
//   - anything else (incl. zstd) → 415 UNSUPPORTED_ENCODING.
//
// Body size guard: `Content-Length > 16 * 1024 * 1024` → 413.
//
// The handler reuses the SAME server-side pipeline as `/v1/events` —
// `enforceTier` + `EventSchema.parse` + `checkDedup` + `wal.append`. Tier or
// zod rejects are counted into the OTLP `partialSuccess.rejectedSpans`
// response field; the receiver never returns 4xx for individual span
// rejections (per OTLP spec §"Failures and Retries").
//
// Auth: caller (route fetch) verifies bearer + applies rate-limit ahead of
// `handleOtlp`. Missing `auth` → 401. This mirrors `/v1/events` and lets the
// shared limiter apply per-request cost.
//
// D-S1-12: hand-rolled decoder is the Sprint-1 stop-gap; Sprint-2 swaps to
// `@bufbuild/protobuf` when Bun ≥ 1.3.4 + buf CI step land.

import { gunzipSync } from "node:zlib";
import {
  decodeLogsJson,
  decodeLogsProto,
  decodeMetricsJson,
  decodeMetricsProto,
  decodeTracesJson,
  decodeTracesProto,
  type EventDraft,
  mapLogsToEvents,
  mapMetricsToEvents,
  mapTracesToEvents,
  OtlpDecodeError,
} from "@bematist/otel";
import { EventSchema } from "@bematist/schema";
import type { AuthContext } from "../auth";
import type { RateLimiter } from "../auth/rateLimit";
import { checkDedup, type DedupStore } from "../dedup/checkDedup";
import type { Flags } from "../flags";
import { logger } from "../logger";
import { enforceTier, type OrgPolicyStore } from "../tier/enforceTier";
import { canonicalize, type WalAppender } from "../wal/append";

const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

export type OtlpKind = "traces" | "metrics" | "logs";

export interface OtlpDeps {
  flags: Flags;
  wal: WalAppender;
  dedupStore: DedupStore;
  orgPolicyStore: OrgPolicyStore;
  rateLimiter: RateLimiter;
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * M3 fix: the OTLP spec uses a different `partialSuccess` field name per
 * signal kind:
 *   - traces  → rejectedSpans
 *   - metrics → rejectedDataPoints
 *   - logs    → rejectedLogRecords
 * Collectors that consume partialSuccess for retry decisions will misparse
 * metrics/logs if we use the traces key everywhere.
 */
function partialSuccessResp(
  rejected: number,
  kind: "traces" | "metrics" | "logs",
  contentType: string,
): Response {
  // Sprint-1 returns the JSON form for both content types — the OTel spec
  // permits either as long as the payload is valid OTLP. Real protobuf
  // response encoding lands with @bufbuild/protobuf.
  void contentType;
  const body =
    kind === "traces"
      ? { partialSuccess: { rejectedSpans: rejected } }
      : kind === "metrics"
        ? { partialSuccess: { rejectedDataPoints: rejected } }
        : { partialSuccess: { rejectedLogRecords: rejected } };
  return jsonResp(body, 200);
}

async function readBody(req: Request, requestId: string): Promise<Uint8Array | Response> {
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > MAX_REQUEST_BODY_BYTES) {
      return jsonResp(
        { error: "payload too large", code: "BODY_TOO_LARGE", request_id: requestId },
        413,
      );
    }
  }
  const enc = (req.headers.get("content-encoding") ?? "").toLowerCase().trim();
  if (enc && enc !== "gzip" && enc !== "identity") {
    return jsonResp(
      {
        error: "unsupported content-encoding",
        code: "UNSUPPORTED_ENCODING",
        request_id: requestId,
      },
      415,
    );
  }
  try {
    if (enc === "gzip") {
      // Use node:zlib gunzipSync — Bun 1.0.7 lacks DecompressionStream. The
      // PRD spec line ("DecompressionStream("gzip")") is a Bun ≥ 1.2 path;
      // until then this is the supported API. Behavior is identical.
      const raw = await req.arrayBuffer();
      if (raw.byteLength > MAX_REQUEST_BODY_BYTES) {
        return jsonResp(
          { error: "payload too large", code: "BODY_TOO_LARGE", request_id: requestId },
          413,
        );
      }
      const decoded = gunzipSync(Buffer.from(raw));
      if (decoded.byteLength > MAX_REQUEST_BODY_BYTES) {
        return jsonResp(
          { error: "payload too large", code: "BODY_TOO_LARGE", request_id: requestId },
          413,
        );
      }
      return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    }
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_REQUEST_BODY_BYTES) {
      return jsonResp(
        { error: "payload too large", code: "BODY_TOO_LARGE", request_id: requestId },
        413,
      );
    }
    return new Uint8Array(buf);
  } catch (e) {
    logger.warn(
      { request_id: requestId, err: e instanceof Error ? e.message : String(e) },
      "otlp body read failed",
    );
    return jsonResp({ error: "body read failed", code: "BAD_BODY", request_id: requestId }, 400);
  }
}

function mapByKind(kind: OtlpKind, decoded: unknown, auth: AuthContext): EventDraft[] {
  const otlpAuth = { tenantId: auth.tenantId, engineerId: auth.engineerId, tier: auth.tier };
  if (kind === "traces") {
    // biome-ignore lint/suspicious/noExplicitAny: decoded shape is opaque here; mapper validates.
    return mapTracesToEvents(decoded as any, otlpAuth);
  }
  if (kind === "metrics") {
    // biome-ignore lint/suspicious/noExplicitAny: decoded shape is opaque here; mapper validates.
    return mapMetricsToEvents(decoded as any, otlpAuth);
  }
  // biome-ignore lint/suspicious/noExplicitAny: decoded shape is opaque here; mapper validates.
  return mapLogsToEvents(decoded as any, otlpAuth);
}

export interface HandleOtlpArgs {
  auth: AuthContext | null;
  deps: OtlpDeps;
  requestId?: string;
  /** Optional override for testing — bypasses rate-limit when provided. */
  skipRateLimit?: boolean;
  /** Device id for rate-limit bucket; defaults to "default". */
  deviceId?: string;
}

export async function handleOtlp(
  req: Request,
  kind: OtlpKind,
  args: HandleOtlpArgs,
): Promise<Response> {
  const requestId = args.requestId ?? crypto.randomUUID();
  const { flags, wal, dedupStore, orgPolicyStore, rateLimiter } = args.deps;

  if (!flags.OTLP_RECEIVER_ENABLED) {
    return jsonResp(
      { error: "OTLP receiver disabled", code: "OTLP_DISABLED", request_id: requestId },
      503,
    );
  }

  if (!args.auth) {
    return new Response(null, { status: 401 });
  }
  // Hoist narrowed non-null into a local so closures (e.g. .map callbacks
  // below) don't widen back to `AuthContext | null`.
  const auth: AuthContext = args.auth;

  if (!args.skipRateLimit) {
    const rl = await rateLimiter.consume(auth.tenantId, args.deviceId ?? "default", 1);
    if (!rl.allowed) {
      const retryAfter = Math.max(1, Math.ceil(rl.retryAfterMs / 1000)).toString();
      return new Response(
        JSON.stringify({
          error: "rate limit exceeded",
          code: "RATE_LIMITED",
          retry_after_ms: rl.retryAfterMs,
          request_id: requestId,
        }),
        {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": retryAfter },
        },
      );
    }
  }

  const ct = (req.headers.get("content-type") ?? "").toLowerCase().split(";")[0]?.trim();
  if (ct !== "application/x-protobuf" && ct !== "application/json") {
    return jsonResp(
      { error: "unsupported content-type", code: "UNSUPPORTED_MEDIA_TYPE", request_id: requestId },
      415,
    );
  }

  const bodyOrResp = await readBody(req, requestId);
  if (bodyOrResp instanceof Response) return bodyOrResp;
  const body = bodyOrResp;

  let decoded: unknown;
  try {
    if (ct === "application/x-protobuf") {
      if (kind === "traces") decoded = decodeTracesProto(body);
      else if (kind === "metrics") decoded = decodeMetricsProto(body);
      else decoded = decodeLogsProto(body);
    } else {
      const parsed = JSON.parse(new TextDecoder().decode(body));
      if (kind === "traces") decoded = decodeTracesJson(parsed);
      else if (kind === "metrics") decoded = decodeMetricsJson(parsed);
      else decoded = decodeLogsJson(parsed);
    }
  } catch (e) {
    if (e instanceof OtlpDecodeError) {
      return jsonResp({ error: e.message, code: "OTLP_DECODE", request_id: requestId }, 400);
    }
    return jsonResp({ error: "bad payload", code: "BAD_BODY", request_id: requestId }, 400);
  }

  const drafts = mapByKind(kind, decoded, auth);

  // Per-tenant policy fetched once per request.
  const policy = await orgPolicyStore.get(auth.tenantId);
  if (policy === null) {
    return jsonResp(
      { error: "org policy not configured", code: "ORG_POLICY_MISSING", request_id: requestId },
      500,
    );
  }

  // Generic reject counter — the partial_success response field name depends
  // on the signal kind (traces/metrics/logs) per OTLP spec; picked below.
  let rejected = 0;
  const acceptedDrafts: ReturnType<typeof EventSchema.parse>[] = [];
  for (const draft of drafts) {
    const tierRes = await enforceTier(draft, auth, policy);
    if (tierRes.reject) {
      rejected++;
      continue;
    }
    const parsed = EventSchema.safeParse(draft);
    if (!parsed.success) {
      rejected++;
      continue;
    }
    acceptedDrafts.push(parsed.data);
  }

  // Dedup + WAL append. Same shape as /v1/events handler.
  const firstSightEvents: ReturnType<typeof EventSchema.parse>[] = [];
  for (const ev of acceptedDrafts) {
    try {
      const { firstSight } = await checkDedup(dedupStore, {
        tenantId: auth.tenantId,
        sessionId: ev.session_id,
        eventSeq: ev.event_seq,
      });
      if (firstSight) firstSightEvents.push(ev);
    } catch (err) {
      logger.error(
        {
          tenant_id: auth.tenantId,
          request_id: requestId,
          err: err instanceof Error ? err.message : String(err),
        },
        "otlp dedup unavailable",
      );
      return jsonResp(
        { error: "dedup store unavailable", code: "REDIS_UNAVAILABLE", request_id: requestId },
        503,
      );
    }
  }

  const walEnabled = flags.WAL_APPEND_ENABLED;
  if (walEnabled && firstSightEvents.length > 0) {
    try {
      const canonical = firstSightEvents.map((ev) =>
        canonicalize(ev, { tenantId: auth.tenantId, engineerId: auth.engineerId }),
      );
      await wal.append(canonical);
    } catch (err) {
      logger.error(
        {
          tenant_id: auth.tenantId,
          request_id: requestId,
          err: err instanceof Error ? err.message : String(err),
        },
        "otlp wal append failed",
      );
      return jsonResp(
        { error: "wal unavailable", code: "WAL_UNAVAILABLE", request_id: requestId },
        503,
      );
    }
  }

  logger.info(
    {
      kind,
      accepted: firstSightEvents.length,
      rejected,
      tenant_id: auth.tenantId,
      request_id: requestId,
    },
    "otlp accepted",
  );

  return partialSuccessResp(rejected, kind, ct);
}

// --- Bun.serve entry point ------------------------------------------------

export interface OtlpServerHandle {
  server: ReturnType<typeof Bun.serve>;
  stop: () => Promise<void>;
}

export interface StartOtlpServerArgs {
  port?: number;
  deps: OtlpDeps;
  /** Bearer verifier — same path as /v1/events. */
  verify: (header: string | null) => Promise<AuthContext | null>;
}

export function startOtlpServer({
  port = 4318,
  deps,
  verify,
}: StartOtlpServerArgs): OtlpServerHandle {
  const server = Bun.serve({
    port,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    async fetch(req) {
      const url = new URL(req.url);
      let kind: OtlpKind | null = null;
      if (url.pathname === "/v1/traces") kind = "traces";
      else if (url.pathname === "/v1/metrics") kind = "metrics";
      else if (url.pathname === "/v1/logs") kind = "logs";
      if (!kind) return new Response(null, { status: 404 });
      if (req.method !== "POST") return new Response(null, { status: 405 });
      const auth = await verify(req.headers.get("authorization"));
      const deviceId = req.headers.get("x-device-id") ?? "default";
      return handleOtlp(req, kind, { auth, deps, deviceId });
    },
  });
  logger.info({ port }, "otlp receiver listening");
  return {
    server,
    async stop() {
      server.stop(true);
    },
  };
}
