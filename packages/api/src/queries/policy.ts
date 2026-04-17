import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
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
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads the `policies` Postgres row for this tenant.
 *   - Otherwise (default) returns the D7 defaults. Byte-identical to Sprint-1
 *     fixture behavior.
 */
export async function getEffectivePolicy(
  ctx: Ctx,
  input: GetEffectivePolicyInput,
): Promise<GetEffectivePolicyOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "auditor", "viewer"]);
  if (useFixtures()) return getEffectivePolicyFixture(ctx, input);
  return getEffectivePolicyReal(ctx, input);
}

async function getEffectivePolicyFixture(
  ctx: Ctx,
  _input: GetEffectivePolicyInput,
): Promise<GetEffectivePolicyOutput> {
  return defaultsFor(ctx.tenant_id);
}

/**
 * Real-branch Postgres read. Joins `orgs` + `policies` keyed on `tenant_id`.
 * Falls back to D7 defaults when no row exists yet (fresh tenant, pre-onboarding).
 *
 * EXPLAIN: single-row pkey lookup on `policies.org_id`. Index is
 * `policies_org_id_idx` (created by Walid's migration).
 */
async function getEffectivePolicyReal(
  ctx: Ctx,
  _input: GetEffectivePolicyInput,
): Promise<GetEffectivePolicyOutput> {
  const rows = await ctx.db.pg.query<PolicyRow>(
    `SELECT
       p.tier,
       p.retention_days,
       p.redaction_trufflehog,
       p.redaction_gitleaks,
       p.redaction_presidio_ner,
       p.ai_assisted_trailer,
       p.manager_view_notification,
       p.ingest_only_to,
       p.tier_c_signed_config_effective_at,
       p.tier_c_signed_config_cooldown_ends_at,
       p.tier_c_managed_cloud_optin
     FROM policies p
     WHERE p.org_id = $1
     LIMIT 1`,
    [ctx.tenant_id],
  );

  const row = rows[0];
  if (!row) return defaultsFor(ctx.tenant_id);

  return {
    tenant_id: ctx.tenant_id,
    tier: row.tier,
    retention_days: row.retention_days,
    redaction: {
      trufflehog: row.redaction_trufflehog,
      gitleaks: row.redaction_gitleaks,
      presidio_ner: row.redaction_presidio_ner,
    },
    ai_assisted_trailer: row.ai_assisted_trailer,
    notifications: {
      manager_view: row.manager_view_notification,
    },
    ingest_only_to: row.ingest_only_to,
    tier_c_signed_config:
      row.tier_c_signed_config_effective_at && row.tier_c_signed_config_cooldown_ends_at
        ? {
            effective_at: row.tier_c_signed_config_effective_at,
            cooldown_ends_at: row.tier_c_signed_config_cooldown_ends_at,
          }
        : null,
    tier_c_managed_cloud_optin: row.tier_c_managed_cloud_optin,
  };
}

interface PolicyRow {
  tier: "A" | "B" | "C";
  retention_days: number;
  redaction_trufflehog: boolean;
  redaction_gitleaks: boolean;
  redaction_presidio_ner: boolean;
  ai_assisted_trailer: boolean;
  manager_view_notification: "immediate" | "daily" | "off";
  ingest_only_to: string | null;
  tier_c_signed_config_effective_at: string | null;
  tier_c_signed_config_cooldown_ends_at: string | null;
  tier_c_managed_cloud_optin: boolean;
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
