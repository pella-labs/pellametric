import { assertRole, type Ctx } from "../auth";
import type {
  EffectivePolicy,
  GetEffectivePolicyInput,
  GetEffectivePolicyOutput,
} from "../schemas/policy";

/**
 * Effective policy for the caller's tenant. Read-only.
 *
 * Default values reflect the locked choices in CLAUDE.md / PRD D7:
 *   - tier B (counters + redacted envelopes)
 *   - 90-day retention (partition-drop, never TTL for Tier A)
 *   - TruffleHog + Gitleaks + Presidio all on (server-side is authoritative)
 *   - daily manager-view notification digest (D30 transparency default)
 *   - AI-Assisted trailer off by default (D29 — opt-in per IC)
 *
 * Fixture-backed until Walid's policies table lands; swap the body when the
 * Postgres layer is live. Contract unchanged.
 */
export async function getEffectivePolicy(
  ctx: Ctx,
  _input: GetEffectivePolicyInput,
): Promise<GetEffectivePolicyOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "auditor", "viewer"]);

  return defaultsFor(ctx.tenant_id);
}

export function defaultsFor(tenantId: string): EffectivePolicy {
  return {
    tenant_id: tenantId,
    tier: "B",
    retention_days: 90,
    redaction: {
      trufflehog: true,
      gitleaks: true,
      presidio_ner: true,
    },
    ai_assisted_trailer: false,
    notifications: {
      manager_view: "daily",
    },
    ingest_only_to: null,
    tier_c_signed_config: null,
    tier_c_managed_cloud_optin: false,
  };
}
