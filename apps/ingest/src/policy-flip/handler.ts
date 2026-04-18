// Tenant-wide Tier-C admin-flip orchestrator (D20).
//
// Pipeline:
//   1. Resolve current `policies` row. Missing → 500 ORG_POLICY_MISSING.
//   2. `verifySignedConfig(envelope, pinnedKeys)`. Reject → 401 / 400 per
//      reason mapping (NO_PUBLIC_KEYS is a server config bug → 500).
//   3. `payload.tenant_id === caller.org_id`. Mismatch → 403 TENANT_MISMATCH.
//      Defends against admin from org A presenting an envelope minted for org B.
//   4. `payload.previous_tier === current.tier_default`. Mismatch → 409
//      INVALID_PREVIOUS_TIER. Defends against re-applying a stale envelope
//      after another flip already moved the tenant somewhere else.
//   5. `checkCooldown(current.tier_c_activated_at, now)`. Not elapsed → 403
//      COOLDOWN_NOT_ELAPSED + `retry_after_ms`.
//   6. `store.activate(...)` — flips `tier_c_managed_cloud_optin=true`,
//      stores envelope JSON, stamps `tier_c_activated_at=now`.
//   7. Audit row → `audit_log` (signer fingerprint, prev/new tier, nonce).
//   8. IC banner → `alerts` row (kind=policy_flip, signal=tier_c_activated)
//      → SSE consumers fan out to every IC dashboard session.
//
// Audit + alert writes happen AFTER successful activation and are best-effort
// in the sense that a Postgres outage between activate() and audit-write
// returns 500 to the admin (caller retries; activation is idempotent on the
// nonce stored in the envelope JSON — Postgres-side dedup recommended via
// audit_log unique-by-(target_id, metadata->>'nonce') in production).

import { type SignedConfigPayload, verifySignedConfig } from "@bematist/config";
import { logger } from "../logger";
import { COOLDOWN_WINDOW_MS, checkCooldown } from "./cooldown";
import type {
  AlertEmitter,
  AlertRow,
  AuditRow,
  AuditWriter,
  PolicyFlipErrorCode,
  PolicyFlipRequest,
  PolicyFlipResult,
  PolicyFlipStore,
  TierCPolicyRow,
} from "./types";

export interface PolicyFlipDeps {
  store: PolicyFlipStore;
  audit: AuditWriter;
  alerts: AlertEmitter;
  /** Pinned signer keys parsed from `SIGNED_CONFIG_PUBLIC_KEYS`. */
  publicKeysRaw: Uint8Array[];
  now: () => Date;
}

const REASON_TO_HTTP: Record<string, { status: 400 | 401 | 403 | 500; code: PolicyFlipErrorCode }> =
  {
    NO_PUBLIC_KEYS: { status: 500, code: "SIGNED_CONFIG_NO_KEYS" },
    MALFORMED_ENVELOPE: { status: 400, code: "SIGNATURE_REJECTED" },
    MALFORMED_PAYLOAD: { status: 400, code: "SIGNATURE_REJECTED" },
    BAD_SIGNATURE: { status: 401, code: "SIGNATURE_REJECTED" },
    FINGERPRINT_MISMATCH: { status: 401, code: "SIGNATURE_REJECTED" },
    UNSUPPORTED_ACTION: { status: 400, code: "SIGNATURE_REJECTED" },
    INVALID_TIER_TRANSITION: { status: 400, code: "SIGNATURE_REJECTED" },
    INVALID_TIMESTAMP: { status: 400, code: "SIGNATURE_REJECTED" },
  };

export async function handlePolicyFlip(
  req: PolicyFlipRequest,
  deps: PolicyFlipDeps,
): Promise<PolicyFlipResult> {
  const { caller, envelope, request_id } = req;

  const current = await deps.store.get(caller.org_id);
  if (current === null) {
    logger.warn(
      { tenant_id: caller.org_id, request_id, code: "ORG_POLICY_MISSING" },
      "policy-flip: org policy row missing",
    );
    return { ok: false, status: 500, code: "ORG_POLICY_MISSING" };
  }

  const verifyResult = await verifySignedConfig(envelope, deps.publicKeysRaw, {
    now: () => deps.now().getTime(),
  });

  if (!verifyResult.valid) {
    const map = REASON_TO_HTTP[verifyResult.reason];
    const status = map?.status ?? 401;
    const code = map?.code ?? "SIGNATURE_REJECTED";
    logger.warn(
      {
        tenant_id: caller.org_id,
        request_id,
        actor_user_id: caller.user_id,
        reason: verifyResult.reason,
        code,
      },
      "policy-flip: signed-config verification failed",
    );
    return { ok: false, status, code, reason: verifyResult.reason };
  }

  const payload = verifyResult.payload;

  if (payload.tenant_id !== caller.org_id) {
    logger.warn(
      {
        tenant_id: caller.org_id,
        envelope_tenant: payload.tenant_id,
        request_id,
        actor_user_id: caller.user_id,
      },
      "policy-flip: envelope tenant_id does not match caller org",
    );
    return { ok: false, status: 403, code: "TENANT_MISMATCH" };
  }

  if (payload.previous_tier !== current.tier_default) {
    logger.warn(
      {
        tenant_id: caller.org_id,
        envelope_previous_tier: payload.previous_tier,
        current_tier_default: current.tier_default,
        request_id,
      },
      "policy-flip: envelope previous_tier does not match live policy",
    );
    return { ok: false, status: 409, code: "INVALID_PREVIOUS_TIER" };
  }

  const now = deps.now();
  const cooldown = checkCooldown(current.tier_c_activated_at, now);
  if (!cooldown.elapsed) {
    logger.warn(
      {
        tenant_id: caller.org_id,
        previous_activation_at: cooldown.previousActivationAt?.toISOString(),
        remaining_ms: cooldown.remainingMs,
        cooldown_window_ms: COOLDOWN_WINDOW_MS,
        request_id,
      },
      "policy-flip: 7-day cooldown not yet elapsed",
    );
    return {
      ok: false,
      status: 403,
      code: "COOLDOWN_NOT_ELAPSED",
      reason: `retry_after_ms=${cooldown.remainingMs}`,
    };
  }

  const envelopeJson = JSON.stringify(envelope);
  const newRow: TierCPolicyRow = await deps.store.activate({
    orgId: caller.org_id,
    signedConfigEnvelope: envelopeJson,
    activatedAt: now,
  });

  const auditRow = makeAuditRow({
    now,
    caller,
    payload,
    signerFingerprint: verifyResult.signerFingerprint,
    request_id,
  });
  await deps.audit.write(auditRow);

  const alertRow = makeAlertRow({ now, orgId: caller.org_id });
  await deps.alerts.emit(alertRow);

  logger.info(
    {
      tenant_id: caller.org_id,
      actor_user_id: caller.user_id,
      signer_fingerprint: verifyResult.signerFingerprint,
      previous_tier: payload.previous_tier,
      new_tier: payload.new_tier,
      nonce: payload.nonce,
      request_id,
    },
    "policy-flip: tier-c activated",
  );

  return {
    ok: true,
    row: newRow,
    payload,
    signer_fingerprint: verifyResult.signerFingerprint,
  };
}

function makeAuditRow(input: {
  now: Date;
  caller: { user_id: string; org_id: string };
  payload: SignedConfigPayload;
  signerFingerprint: string;
  request_id: string;
}): AuditRow {
  return {
    ts: input.now,
    org_id: input.caller.org_id,
    actor_user_id: input.caller.user_id,
    action: "tier_c_admin_flip",
    target_type: "policy",
    target_id: input.caller.org_id,
    reason: null,
    metadata_json: {
      signer_fingerprint: input.signerFingerprint,
      previous_tier: input.payload.previous_tier,
      new_tier: input.payload.new_tier,
      nonce: input.payload.nonce,
      issued_at: input.payload.issued_at,
      request_id: input.request_id,
    },
  };
}

function makeAlertRow(input: { now: Date; orgId: string }): AlertRow {
  return {
    ts: input.now,
    org_id: input.orgId,
    kind: "policy_flip",
    signal: "tier_c_activated",
    value: 1,
    threshold: 1,
    dev_id_hash: null,
  };
}

export const _testHooks = { makeAuditRow, makeAlertRow };
