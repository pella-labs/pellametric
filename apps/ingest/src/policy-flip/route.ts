// HTTP adapter for the D20 Tier-C admin-flip handler.
//
// POST /v1/admin/policy-flip
//   Auth: Authorization: Bearer bm_<orgId>_<keyId>_<secret> — same ingest-key
//         verification as /v1/events. The bearer's org_id becomes `caller.org_id`;
//         must match the envelope's `tenant_id` or the handler returns 403
//         TENANT_MISMATCH (defence against an admin from org A presenting an
//         envelope minted for org B).
//   Body (application/json):
//     {
//       "envelope": { "payload": "<base64url>", "signature": "<base64url>" },
//       "actor_user_id": "<uuid>"
//     }
//   actor_user_id is the Better-Auth user performing the flip; persisted to
//   audit_log.actor_user_id. Validated as UUID string; caller is responsible
//   for asserting the identity upstream (Better-Auth session → signed header).
//   With Better-Auth tenant binding still in flight (m3 follow-up #1), the
//   ingest boundary trusts the admin-console to carry a valid actor UUID.
//
// Responses (matching PolicyFlipResult):
//   200 + { ok: true, signer_fingerprint, activated_at }
//   400 — BAD_JSON / BAD_SHAPE / SIGNATURE_REJECTED with malformed envelope
//   401 — SIGNATURE_REJECTED (bad signature, tampered payload, fingerprint mismatch)
//   403 — TENANT_MISMATCH (envelope tenant_id ≠ bearer org_id)
//   403 — COOLDOWN_NOT_ELAPSED + { retry_after_ms }
//   409 — INVALID_PREVIOUS_TIER (envelope previous_tier ≠ live tier_default)
//   500 — ORG_POLICY_MISSING | SIGNED_CONFIG_NO_KEYS

import type { SignedConfigEnvelope } from "@bematist/config";
import type { AuthContext } from "../auth/verifyIngestKey";
import { logger } from "../logger";
import { COOLDOWN_WINDOW_MS } from "./cooldown";
import { handlePolicyFlip, type PolicyFlipDeps } from "./handler";
import type { PolicyFlipRequest } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function isEnvelope(x: unknown): x is SignedConfigEnvelope {
  if (!x || typeof x !== "object") return false;
  const e = x as { payload?: unknown; signature?: unknown };
  return typeof e.payload === "string" && typeof e.signature === "string";
}

interface HandlePolicyFlipHttpDeps {
  policyFlip: PolicyFlipDeps | null;
}

export async function handlePolicyFlipRequest(
  req: Request,
  auth: AuthContext,
  requestId: string,
  deps: HandlePolicyFlipHttpDeps,
): Promise<Response> {
  if (!deps.policyFlip) {
    // Boot didn't wire the Drizzle-backed deps — policies/audit/alert writes
    // would silently no-op. Refuse with 500 so ops notices in the response
    // rather than in an audit-log gap weeks later.
    logger.error(
      { request_id: requestId, tenant_id: auth.tenantId, code: "POLICY_FLIP_NOT_CONFIGURED" },
      "policy-flip endpoint hit but PolicyFlipDeps not wired",
    );
    return json(
      {
        error: "policy-flip not configured",
        code: "POLICY_FLIP_NOT_CONFIGURED",
        request_id: requestId,
      },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(
      { error: "invalid json", code: "BAD_JSON", request_id: requestId },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return json(
      { error: "missing body", code: "BAD_SHAPE", request_id: requestId },
      { status: 400 },
    );
  }

  const { envelope, actor_user_id } = body as {
    envelope?: unknown;
    actor_user_id?: unknown;
  };

  if (!isEnvelope(envelope)) {
    return json(
      { error: "missing envelope", code: "BAD_SHAPE", request_id: requestId },
      { status: 400 },
    );
  }

  if (typeof actor_user_id !== "string" || !UUID_RE.test(actor_user_id)) {
    return json(
      { error: "actor_user_id must be a UUID", code: "BAD_SHAPE", request_id: requestId },
      { status: 400 },
    );
  }

  const flipReq: PolicyFlipRequest = {
    envelope,
    caller: { user_id: actor_user_id, org_id: auth.tenantId },
    request_id: requestId,
  };

  const result = await handlePolicyFlip(flipReq, deps.policyFlip);

  if (result.ok) {
    logger.info(
      {
        tenant_id: auth.tenantId,
        request_id: requestId,
        actor_user_id,
        signer_fingerprint: result.signer_fingerprint,
        previous_tier: result.payload.previous_tier,
        new_tier: result.payload.new_tier,
      },
      "policy-flip: http 200",
    );
    return json(
      {
        ok: true,
        signer_fingerprint: result.signer_fingerprint,
        activated_at:
          result.row.tier_c_activated_at instanceof Date
            ? result.row.tier_c_activated_at.toISOString()
            : result.row.tier_c_activated_at,
        request_id: requestId,
      },
      { status: 200 },
    );
  }

  const payload: Record<string, unknown> = {
    ok: false,
    error: result.code,
    code: result.code,
    request_id: requestId,
  };
  if (result.reason !== undefined) {
    payload.reason = result.reason;
  }
  if (result.code === "COOLDOWN_NOT_ELAPSED") {
    const retry = parseRetryAfterMs(result.reason ?? "");
    if (retry !== null) {
      payload.retry_after_ms = retry;
    }
  }
  return json(payload, { status: result.status });
}

function parseRetryAfterMs(reason: string): number | null {
  const match = /retry_after_ms=(\d+)/.exec(reason);
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 0 || n > COOLDOWN_WINDOW_MS) return null;
  return n;
}
