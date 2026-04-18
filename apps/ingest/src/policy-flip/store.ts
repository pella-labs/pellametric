// In-memory PolicyFlipStore for tests and dev. Production wiring lives in
// `apps/ingest/src/index.ts` (boot) and reads/writes the `policies` Drizzle
// row directly — same row consumed by `enforceTier.ts`.

import type { PolicyFlipStore, Tier, TierCPolicyRow } from "./types";

export class InMemoryPolicyFlipStore implements PolicyFlipStore {
  private readonly rows = new Map<string, TierCPolicyRow>();

  seed(orgId: string, row: Omit<TierCPolicyRow, "org_id"> & { org_id?: string }): void {
    this.rows.set(orgId, { ...row, org_id: orgId });
  }

  clear(): void {
    this.rows.clear();
  }

  /** Test helper — peek without going through the activate path. */
  peek(orgId: string): TierCPolicyRow | undefined {
    const r = this.rows.get(orgId);
    return r ? { ...r } : undefined;
  }

  async get(orgId: string): Promise<TierCPolicyRow | null> {
    const r = this.rows.get(orgId);
    return r ? { ...r } : null;
  }

  async activate(input: {
    orgId: string;
    signedConfigEnvelope: string;
    activatedAt: Date;
  }): Promise<TierCPolicyRow> {
    const cur = this.rows.get(input.orgId);
    if (!cur) {
      throw new Error(`policy-flip activate: row missing for org ${input.orgId}`);
    }
    const next: TierCPolicyRow = {
      ...cur,
      tier_c_managed_cloud_optin: true,
      tier_c_signed_config: input.signedConfigEnvelope,
      tier_c_activated_at: input.activatedAt,
    };
    this.rows.set(input.orgId, next);
    return { ...next };
  }
}

export function defaultPolicyRow(
  orgId: string,
  override: Partial<TierCPolicyRow> = {},
): TierCPolicyRow {
  return {
    org_id: orgId,
    tier_c_managed_cloud_optin: false,
    tier_default: "B" as Tier,
    tier_c_signed_config: null,
    tier_c_activated_at: null,
    ...override,
  };
}
