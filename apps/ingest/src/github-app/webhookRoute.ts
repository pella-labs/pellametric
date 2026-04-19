// POST /v1/webhooks/github/:installation_id (PRD §7.1).
//
// This is the G1 path-param route. It runs ALONGSIDE the legacy
// `?org=<slug>` route (kept for G0 fixture tests) — both converge on the
// same body-handling pipeline:
//
//   1. Extract the installation_id from the path.
//   2. Look up the installation via InstallationResolver.
//      · not found → 404 UNKNOWN_INSTALLATION
//      · status=revoked → 404 INSTALLATION_REVOKED (never process)
//   3. Read raw body bytes BEFORE JSON parse (HMAC invariant).
//   4. Verify HMAC with dual-accept (D55). On fail → 401 BAD_SIGNATURE.
//      Write an audit_log row so on-call can triage spoof attempts.
//   5. SETNX on X-GitHub-Delivery with 7-day TTL. Duplicate → 200
//      dedup:true, no bus write.
//   6. Emit to Redpanda `github.webhooks`. On success → 200 OK.
//      Worker does the UPSERTs out-of-band.

import type { DedupStore } from "../dedup/checkDedup";
import { getDeps } from "../deps";
import { logger } from "../logger";
import { emitTrailerOutcomes } from "../webhooks/emitTrailerOutcomes";
import type { OutcomesStore } from "../webhooks/outcomesStore";
import { verifiers, type WebhookDelivery } from "../webhooks/verify";
import type { InstallationResolver } from "./installationResolver";
import { incrCounter, observeHistogram } from "./metrics";
import type { WebhookSecretResolver } from "./secretsResolver";
import { verifyWithRotation } from "./verifyWithRotation";
import {
  encodePayload,
  GITHUB_WEBHOOKS_TOPIC,
  type WebhookBusPayload,
  type WebhookBusProducer,
} from "./webhookBus";

const WEBHOOK_DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type AuditLogSink = (row: {
  tenant_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
}) => Promise<void>;

export interface WebhookRouteDeps {
  installationResolver: InstallationResolver;
  secretsResolver: WebhookSecretResolver;
  webhookDedup: DedupStore;
  bus: WebhookBusProducer;
  auditSink: AuditLogSink;
  /**
   * Outcomes store for D29 Layer-2 trailer attribution. Optional so the
   * in-memory tests that don't care about trailers can leave it unset —
   * production boot always wires it from `getDeps().outcomesStore`.
   */
  outcomesStore?: OutcomesStore;
  clock?: () => Date;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function hdr(req: Request, name: string, fallback = ""): string {
  return req.headers.get(name) ?? fallback;
}

export async function handleGithubWebhookByInstallation(
  req: Request,
  installationIdStr: string,
  deps: WebhookRouteDeps,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const clock = deps.clock ?? (() => new Date());
  const tStart = performance.now();

  let installationId: bigint;
  try {
    installationId = BigInt(installationIdStr);
  } catch {
    return json(
      { error: "invalid installation id", code: "BAD_INSTALLATION_ID", request_id: requestId },
      { status: 400 },
    );
  }

  const installation = await deps.installationResolver.byInstallationId(installationId);
  if (!installation) {
    incrCounter("github_webhook_redelivery_requests_total", { reason: "unknown_installation" });
    return json(
      {
        error: "unknown installation",
        code: "UNKNOWN_INSTALLATION",
        request_id: requestId,
      },
      { status: 404 },
    );
  }

  // H6 — strict allowlist: only status='active' may proceed. Any other state
  // is rejected with a distinct error code, counter reason, and audit row so
  // on-call can distinguish suspended vs. revoked vs. reconnecting without
  // cross-referencing installation state.
  if (installation.status !== "active") {
    const statusCodeMap: Record<string, string> = {
      suspended: "INSTALLATION_SUSPENDED",
      revoked: "INSTALLATION_REVOKED",
      reconnecting: "INSTALLATION_RECONNECTING",
    };
    const code = statusCodeMap[installation.status] ?? "INSTALLATION_NOT_ACTIVE";
    incrCounter("github_webhook_redelivery_requests_total", {
      reason: `installation_${installation.status}`,
    });
    await deps
      .auditSink({
        tenant_id: installation.tenant_id,
        action: "github.webhook.installation_not_active",
        target_type: "github_installation",
        target_id: installationIdStr,
        metadata: {
          status: installation.status,
          code,
          event: hdr(req, "x-github-event"),
          delivery_id: hdr(req, "x-github-delivery"),
          request_id: requestId,
        },
      })
      .catch((err) => {
        logger.warn(
          { request_id: requestId, err: err instanceof Error ? err.message : String(err) },
          "audit sink failed (installation_not_active)",
        );
      });
    return json(
      {
        error: `installation ${installation.status}`,
        code,
        request_id: requestId,
      },
      { status: 404 },
    );
  }

  const rawBody = new Uint8Array(await req.arrayBuffer());
  const deliveryId = hdr(req, "x-github-delivery");
  const event = hdr(req, "x-github-event");
  const delivery: WebhookDelivery = {
    source: "github",
    deliveryId,
    event,
    rawBody,
    signature: hdr(req, "x-hub-signature-256"),
  };

  const verifyResult = await verifyWithRotation({
    installation,
    resolver: deps.secretsResolver,
    delivery,
    now: clock,
  });
  if (!verifyResult.ok) {
    await deps
      .auditSink({
        tenant_id: installation.tenant_id,
        action: "github.webhook.signature_reject",
        target_type: "github_installation",
        target_id: installationIdStr,
        metadata: {
          reason: verifyResult.reason,
          event,
          delivery_id: deliveryId,
          request_id: requestId,
        },
      })
      .catch((err) => {
        logger.warn(
          { request_id: requestId, err: err instanceof Error ? err.message : String(err) },
          "audit sink failed (signature_reject)",
        );
      });
    logger.warn(
      {
        source: "github",
        tenant_id: installation.tenant_id,
        installation_id: installationIdStr,
        delivery_id: deliveryId,
        request_id: requestId,
        reason: verifyResult.reason,
      },
      "webhook hmac verification failed",
    );
    return json(
      {
        error: "invalid signature",
        code: "BAD_SIGNATURE",
        reason: verifyResult.reason,
        request_id: requestId,
      },
      { status: 401 },
    );
  }

  // Transport dedup — authoritative first layer.
  if (deliveryId.length > 0) {
    const dedupKey = `wh:${deliveryId}`;
    let firstSight: boolean;
    try {
      firstSight = await deps.webhookDedup.setnx(dedupKey, WEBHOOK_DEDUP_TTL_MS);
    } catch (err) {
      incrCounter("github_webhook_redelivery_requests_total", { reason: "redis_unavailable" });
      logger.error(
        {
          tenant_id: installation.tenant_id,
          request_id: requestId,
          err: err instanceof Error ? err.message : String(err),
        },
        "webhook dedup unavailable",
      );
      return json(
        {
          error: "webhook dedup unavailable",
          code: "REDIS_UNAVAILABLE",
          request_id: requestId,
        },
        { status: 503 },
      );
    }
    if (!firstSight) {
      return json({ dedup: true, request_id: requestId }, { status: 200 });
    }
  }

  // D29 Layer-2 trailer outcome emission. We JSON-parse the body inline here
  // (post-HMAC, post-dedup) so trailer-derived outcome rows land in Postgres
  // synchronously — the bus-fed worker path doesn't know about the outcomes
  // table and re-parsing the body twice is cheap. On parse failure we log
  // and skip; the bus still receives the raw bytes so the worker can try
  // again. NEVER let trailer extraction fail the HTTP response.
  //
  // The store defaults to `getDeps().outcomesStore` when the caller (server.ts
  // wiring) doesn't pass one explicitly — keeps server.ts out of this change.
  const outcomesStore: OutcomesStore | undefined = deps.outcomesStore ?? getDeps().outcomesStore;
  if (outcomesStore && (event === "push" || event === "pull_request")) {
    try {
      const parsedBody = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
      await emitTrailerOutcomes({
        orgId: installation.tenant_id,
        event,
        body: parsedBody,
        outcomesStore,
        requestId,
      });
    } catch (err) {
      logger.warn(
        {
          request_id: requestId,
          tenant_id: installation.tenant_id,
          event,
          err: err instanceof Error ? err.message : String(err),
        },
        "trailer outcome extraction skipped (bad json)",
      );
    }
  }

  const payload: WebhookBusPayload = {
    delivery_id: deliveryId,
    event,
    tenant_id: installation.tenant_id,
    installation_id: installationIdStr,
    body_b64: Buffer.from(rawBody).toString("base64"),
    received_at: clock().toISOString(),
  };

  try {
    await deps.bus.publish(GITHUB_WEBHOOKS_TOPIC, {
      key: `${installation.tenant_id}:${installationIdStr}`,
      value: encodePayload(payload),
      headers: {
        "x-github-event": event,
        "x-github-delivery": deliveryId,
      },
    });
  } catch (err) {
    incrCounter("github_webhook_redelivery_requests_total", { reason: "bus_publish_failed" });
    logger.error(
      {
        tenant_id: installation.tenant_id,
        request_id: requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      "webhook bus publish failed",
    );
    return json(
      {
        error: "bus publish failed",
        code: "BUS_UNAVAILABLE",
        request_id: requestId,
      },
      { status: 503 },
    );
  }

  const elapsedSec = (performance.now() - tStart) / 1000;
  observeHistogram(
    "github_webhook_lag_seconds",
    { tenant: installation.tenant_id, event_type: event || "unknown" },
    elapsedSec,
  );

  return json(
    {
      accepted: true,
      request_id: requestId,
      path: verifyResult.path,
      event,
    },
    { status: 200 },
  );
}

// Unused re-export so downstream code can discover the verifiers import site.
export { verifiers as _forTests };
