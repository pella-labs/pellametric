// Shared types for the Tier-C admin-flip flow (D20).
//
// Lives next to the orchestrator (apps/ingest/src/policy-flip/handler.ts) so
// the test doubles in this directory can import without pulling the orchestrator.

import type { SignedConfigPayload } from "@bematist/config";

export type Tier = "A" | "B" | "C";

/** Persisted shape on `policies` row — see packages/schema/postgres/schema.ts. */
export interface TierCPolicyRow {
  org_id: string;
  tier_c_managed_cloud_optin: boolean;
  tier_default: Tier;
  tier_c_signed_config: string | null;
  tier_c_activated_at: Date | null;
}

/**
 * Storage seam — `apps/ingest/src/policy-flip/handler.ts` does not know about
 * Drizzle. The boot wiring picks an impl; tests inject `InMemoryPolicyFlipStore`.
 */
export interface PolicyFlipStore {
  /** Returns null if the org has no policy row yet (caller → 500 ORG_POLICY_MISSING). */
  get(orgId: string): Promise<TierCPolicyRow | null>;
  /** Activates Tier-C with the signed envelope; returns the new row state. */
  activate(input: {
    orgId: string;
    signedConfigEnvelope: string;
    activatedAt: Date;
  }): Promise<TierCPolicyRow>;
}

/**
 * Audit-row shape per D20: signer fingerprint, tenant, timestamp, previous tier,
 * new tier. Persisted to `audit_log` via `target_type='policy'`,
 * `target_id=org_id`, `action='tier_c_admin_flip'`. The cooldown / signer
 * details live in `metadata_json`.
 */
export interface AuditRow {
  ts: Date;
  org_id: string;
  actor_user_id: string;
  action: "tier_c_admin_flip";
  target_type: "policy";
  target_id: string;
  reason: string | null;
  metadata_json: {
    signer_fingerprint: string;
    previous_tier: Tier;
    new_tier: Tier;
    nonce: string;
    issued_at: string;
    request_id: string;
  };
}

export interface AuditWriter {
  write(row: AuditRow): Promise<void>;
}

/**
 * IC-banner alert per D20 — a row in `alerts` with `kind='policy_flip'`,
 * `signal='tier_c_activated'`. The dashboard SSE channel that ICs subscribe
 * to picks this up and renders the banner. Per CLAUDE.md §Security Rules
 * (D20) every IC must be informed of a tenant-wide Tier-C activation.
 */
export interface AlertRow {
  ts: Date;
  org_id: string;
  kind: "policy_flip";
  signal: "tier_c_activated";
  /** Always 1.0 for boolean-style alerts; the value is informational. */
  value: number;
  threshold: number;
  /** Always null for tenant-wide alerts (no per-dev target). */
  dev_id_hash: string | null;
}

export interface AlertEmitter {
  emit(row: AlertRow): Promise<void>;
}

/**
 * Caller's authenticated identity — populated upstream by the dashboard auth
 * middleware (Better Auth session). Must NOT be self-signed by the same key
 * used for the signed-config envelope; this is enforced at the dashboard
 * layer (RBAC: Admin role only) and re-asserted here by requiring a
 * `user_id`.
 */
export interface AdminFlipCaller {
  user_id: string;
  /** Tenant scope — must equal `payload.tenant_id` or the request is rejected. */
  org_id: string;
}

export interface PolicyFlipRequest {
  envelope: { payload: string; signature: string };
  caller: AdminFlipCaller;
  request_id: string;
}

export type PolicyFlipResult =
  | {
      ok: true;
      row: TierCPolicyRow;
      payload: SignedConfigPayload;
      signer_fingerprint: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 409 | 500;
      code: PolicyFlipErrorCode;
      reason?: string;
    };

export type PolicyFlipErrorCode =
  | "ORG_POLICY_MISSING"
  | "TENANT_MISMATCH"
  | "INVALID_PREVIOUS_TIER"
  | "COOLDOWN_NOT_ELAPSED"
  | "SIGNATURE_REJECTED"
  | "SIGNED_CONFIG_NO_KEYS";
