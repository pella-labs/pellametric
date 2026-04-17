// Webhook router (Sprint-1 Phase 6, PRD §Phase 6, D-S1-17, D-S1-32).
//
// Short pipeline — NO enforceTier (webhooks carry no `tier` field). Flow:
//
//   1. Flag gate (WEBHOOKS_ENABLED). Off → 503.
//   2. ?org=<slug> → orgResolver.bySlug. Missing → 400 MISSING_ORG.
//   3. Raw body via arrayBuffer() (must NOT JSON-parse before verifying HMAC).
//   4. verifiers[source].verify(delivery, secret, {allowlistIps}). False → 401.
//   5. Transport dedup: webhookDedup.setnx(`dedup:webhook:<src>:<id>`, 7d).
//      Duplicate → 200 {dedup:true}. (D-S1-17 layer 1.)
//   6. Parse → GitEventRow | null | throw. Bad payload → 400.
//      Unknown event type (null) → 200 {ignored:true}.
//   7. gitEventsStore.upsert(row, orgId) — row dedup via UNIQUE(pr_node_id).
//      (D-S1-17 layer 2.)
//   8. 200 {inserted, pr_node_id}.

import type { Deps } from "../deps";
import { logger } from "../logger";
import { parseBitbucketWebhook } from "./bitbucket";
import type { GitEventRow } from "./gitEventsStore";
import { parseGitHubWebhook } from "./github";
import { parseGitLabWebhook } from "./gitlab";
import { verifiers, type WebhookDelivery, type WebhookSource } from "./verify";

const WEBHOOK_DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function headerOr(req: Request, name: string, fallback = ""): string {
  return req.headers.get(name) ?? fallback;
}

function extractDelivery(
  req: Request,
  source: WebhookSource,
  rawBody: Uint8Array,
): WebhookDelivery {
  // M1 fix: XFF is a comma-separated chain appended by each proxy
  // ("client, proxy1, proxy2"). The originating client's IP is the leftmost
  // entry, whitespace-stripped. An attacker can only spoof the leftmost
  // if our ingress fails to strip incoming XFF from untrusted sources
  // (deployment concern). Prefer `x-real-ip` when our reverse proxy sets it.
  const xRealIp = req.headers.get("x-real-ip")?.trim();
  const xff = req.headers.get("x-forwarded-for");
  const ip = xRealIp || (xff ? (xff.split(",")[0]?.trim() ?? undefined) : undefined);
  const ipField = ip ? { sourceIp: ip } : {};
  if (source === "github") {
    return {
      source,
      deliveryId: headerOr(req, "x-github-delivery"),
      event: headerOr(req, "x-github-event"),
      rawBody,
      signature: headerOr(req, "x-hub-signature-256"),
      ...ipField,
    };
  }
  if (source === "gitlab") {
    return {
      source,
      deliveryId: headerOr(req, "x-gitlab-event-uuid"),
      event: headerOr(req, "x-gitlab-event"),
      rawBody,
      signature: headerOr(req, "x-gitlab-token"),
      ...ipField,
    };
  }
  return {
    source,
    deliveryId: headerOr(req, "x-request-uuid"),
    event: headerOr(req, "x-event-key"),
    rawBody,
    signature: headerOr(req, "x-hub-signature"),
    ...ipField,
  };
}

function parse(source: WebhookSource, event: string, body: unknown): GitEventRow | null {
  if (source === "github") return parseGitHubWebhook(event, body);
  if (source === "gitlab") return parseGitLabWebhook(event, body);
  return parseBitbucketWebhook(event, body);
}

export async function handleWebhook(
  req: Request,
  source: WebhookSource,
  deps: Deps,
): Promise<Response> {
  const requestId = crypto.randomUUID();

  if (!deps.flags.WEBHOOKS_ENABLED) {
    return json(
      { error: "webhooks disabled", code: "WEBHOOKS_DISABLED", request_id: requestId },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get("org");
  if (!slug) {
    return json(
      { error: "missing org query param", code: "MISSING_ORG", request_id: requestId },
      { status: 400 },
    );
  }
  const orgId = await deps.orgResolver.bySlug(slug);
  if (!orgId) {
    return json(
      { error: "unknown org", code: "UNKNOWN_ORG", request_id: requestId },
      { status: 404 },
    );
  }

  // Raw body capture MUST precede JSON parse — the HMAC is computed over
  // the exact on-the-wire bytes. Re-stringifying would change whitespace and
  // break verification (Phase-6 test 4).
  const rawBody = new Uint8Array(await req.arrayBuffer());
  const delivery = extractDelivery(req, source, rawBody);

  const policy = await deps.orgPolicyStore.get(orgId);
  if (!policy) {
    return json(
      { error: "org policy missing", code: "ORG_POLICY_MISSING", request_id: requestId },
      { status: 500 },
    );
  }
  const secretStr = policy.webhook_secrets?.[source];
  if (!secretStr) {
    return json(
      {
        error: "webhook secret not configured",
        code: "WEBHOOK_SECRET_MISSING",
        request_id: requestId,
      },
      { status: 401 },
    );
  }
  const secret = Buffer.from(secretStr, "utf8");
  const allowlistIps = policy.webhook_source_ip_allowlist;
  const extra = allowlistIps ? { allowlistIps } : {};
  const ok = verifiers[source].verify(delivery, secret, extra);
  if (!ok) {
    logger.warn(
      { source, delivery_id: delivery.deliveryId, request_id: requestId },
      "webhook hmac verification failed",
    );
    return json(
      { error: "invalid signature", code: "BAD_SIGNATURE", request_id: requestId },
      {
        status: 401,
      },
    );
  }

  // Transport dedup — authoritative layer 1 per D-S1-17. Delivery IDs are
  // unique per provider; same delivery ID twice → second is a retry storm,
  // 200 with dedup:true (no second row write).
  if (delivery.deliveryId.length > 0) {
    const dedupKey = `dedup:webhook:${source}:${delivery.deliveryId}`;
    let firstSight: boolean;
    try {
      firstSight = await deps.webhookDedup.setnx(dedupKey, WEBHOOK_DEDUP_TTL_MS);
    } catch (err) {
      logger.error(
        {
          source,
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

  // JSON parse NOW that HMAC is verified. Invalid JSON → 400 BAD_JSON.
  let body: unknown;
  try {
    const text = new TextDecoder().decode(rawBody);
    body = JSON.parse(text);
  } catch {
    return json(
      { error: "invalid json", code: "BAD_JSON", request_id: requestId },
      {
        status: 400,
      },
    );
  }

  let row: GitEventRow | null;
  try {
    row = parse(source, delivery.event, body);
  } catch (err) {
    logger.warn(
      {
        source,
        request_id: requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      "webhook payload parse error",
    );
    return json(
      { error: "bad payload", code: "BAD_PAYLOAD", request_id: requestId },
      { status: 400 },
    );
  }
  if (row === null) {
    // Unsupported event type — accept (provider will think we received it)
    // but record nothing. Matches PRD test-14 "Unknown event type → stored
    // with pr_node_id=null OR logged+ignored"; we pick ignored.
    logger.info({ source, event: delivery.event, request_id: requestId }, "webhook event ignored");
    return json({ ignored: true, request_id: requestId }, { status: 200 });
  }

  const result = await deps.gitEventsStore.upsert(row, orgId);
  logger.info(
    {
      source,
      event_kind: row.event_kind,
      pr_node_id: row.pr_node_id,
      inserted: result.inserted,
      request_id: requestId,
      org_id: orgId,
    },
    "webhook accepted",
  );
  return json(
    { inserted: result.inserted, pr_node_id: row.pr_node_id, request_id: requestId },
    { status: 200 },
  );
}
