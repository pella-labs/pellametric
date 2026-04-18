// Drizzle-backed PolicyFlipStore. Reads and writes the `policies` row against
// the columns seeded by migration 0002 (PR #34): `tier_c_managed_cloud_optin`,
// `tier_default`, `tier_c_signed_config`, `tier_c_activated_at`. The activate()
// write happens inside a single UPDATE ... RETURNING so the handler observes a
// consistent post-flip snapshot without a second SELECT round-trip.

import { policies } from "@bematist/schema/postgres";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PolicyFlipStore, Tier, TierCPolicyRow } from "./types";

export interface DrizzlePolicyFlipStoreDeps {
  db: PostgresJsDatabase<Record<string, unknown>>;
}

export class DrizzlePolicyFlipStore implements PolicyFlipStore {
  constructor(private readonly deps: DrizzlePolicyFlipStoreDeps) {}

  async get(orgId: string): Promise<TierCPolicyRow | null> {
    const rows = await this.deps.db
      .select({
        org_id: policies.org_id,
        tier_c_managed_cloud_optin: policies.tier_c_managed_cloud_optin,
        tier_default: policies.tier_default,
        tier_c_signed_config: policies.tier_c_signed_config,
        tier_c_activated_at: policies.tier_c_activated_at,
      })
      .from(policies)
      .where(eq(policies.org_id, orgId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toTierCPolicyRow(row);
  }

  async activate(input: {
    orgId: string;
    signedConfigEnvelope: string;
    activatedAt: Date;
  }): Promise<TierCPolicyRow> {
    const returned = await this.deps.db
      .update(policies)
      .set({
        tier_c_managed_cloud_optin: true,
        tier_c_signed_config: input.signedConfigEnvelope,
        tier_c_activated_at: input.activatedAt,
        updated_at: input.activatedAt,
      })
      .where(eq(policies.org_id, input.orgId))
      .returning({
        org_id: policies.org_id,
        tier_c_managed_cloud_optin: policies.tier_c_managed_cloud_optin,
        tier_default: policies.tier_default,
        tier_c_signed_config: policies.tier_c_signed_config,
        tier_c_activated_at: policies.tier_c_activated_at,
      });
    const row = returned[0];
    if (!row) {
      throw new Error(
        `policy-flip activate: UPDATE affected 0 rows for org ${input.orgId} — row vanished between SELECT and UPDATE`,
      );
    }
    return toTierCPolicyRow(row);
  }
}

function toTierCPolicyRow(row: {
  org_id: string;
  tier_c_managed_cloud_optin: boolean;
  tier_default: string;
  tier_c_signed_config: string | null;
  tier_c_activated_at: Date | null;
}): TierCPolicyRow {
  return {
    org_id: row.org_id,
    tier_c_managed_cloud_optin: row.tier_c_managed_cloud_optin,
    tier_default: normalizeTier(row.tier_default),
    tier_c_signed_config: row.tier_c_signed_config,
    tier_c_activated_at: row.tier_c_activated_at,
  };
}

function normalizeTier(raw: string): Tier {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "A" || trimmed === "B" || trimmed === "C") return trimmed;
  throw new Error(`policy-flip: unexpected tier_default value '${raw}' on policies row`);
}
