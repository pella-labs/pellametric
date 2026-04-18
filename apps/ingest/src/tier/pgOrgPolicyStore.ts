// Postgres-backed OrgPolicyStore.
//
// Reads `policies` rows by org UUID. A TTL cache (default 60s) fronts the
// query so hot-path /v1/events bursts don't hammer PG — once a policy row is
// cached, every subsequent batch in the window is a map hit.
//
// The `policies` row is auto-created by the `orgs_insert_default_policy`
// trigger on INSERT INTO orgs (migration 0002_sprint1_policies.sql) with the
// Tier-B, tier_c_managed_cloud_optin=false default per CLAUDE.md D7.

import { policies } from "@bematist/schema/postgres";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { OrgPolicy, OrgPolicyStore, Tier } from "./enforceTier";

export interface PgOrgPolicyStoreDeps {
  db: PostgresJsDatabase<Record<string, unknown>>;
  ttlMs?: number;
  clock?: () => number;
}

interface CacheEntry {
  value: OrgPolicy | null;
  expiresAt: number;
}

export function createPgOrgPolicyStore(deps: PgOrgPolicyStoreDeps): OrgPolicyStore {
  const ttlMs = deps.ttlMs ?? 60_000;
  const clock = deps.clock ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  return {
    async get(orgId: string): Promise<OrgPolicy | null> {
      const now = clock();
      const cached = cache.get(orgId);
      if (cached && cached.expiresAt > now) return cached.value;

      const rows = await deps.db
        .select({
          tier_c_managed_cloud_optin: policies.tier_c_managed_cloud_optin,
          tier_default: policies.tier_default,
          raw_attrs_allowlist_extra: policies.raw_attrs_allowlist_extra,
          webhook_secrets: policies.webhook_secrets,
          webhook_source_ip_allowlist: policies.webhook_source_ip_allowlist,
        })
        .from(policies)
        .where(eq(policies.org_id, orgId))
        .limit(1);

      const row = rows[0];
      let value: OrgPolicy | null = null;
      if (row) {
        const base: OrgPolicy = {
          tier_c_managed_cloud_optin: row.tier_c_managed_cloud_optin,
          tier_default: normalizeTier(row.tier_default),
        };
        const allowlistExtra = coerceStringArray(row.raw_attrs_allowlist_extra);
        if (allowlistExtra !== undefined) base.raw_attrs_allowlist_extra = allowlistExtra;
        const webhookSecrets = coerceWebhookSecrets(row.webhook_secrets);
        if (webhookSecrets !== undefined) base.webhook_secrets = webhookSecrets;
        const ipAllowlist = coerceStringArray(row.webhook_source_ip_allowlist);
        if (ipAllowlist !== undefined) base.webhook_source_ip_allowlist = ipAllowlist;
        value = base;
      }

      cache.set(orgId, { value, expiresAt: now + ttlMs });
      return value;
    },
  };
}

function normalizeTier(raw: string): Tier {
  const t = raw.trim().toUpperCase();
  if (t === "A" || t === "B" || t === "C") return t;
  throw new Error(`pgOrgPolicyStore: unexpected tier_default '${raw}' on policies row`);
}

function coerceStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const v of raw) if (typeof v === "string") out.push(v);
  return out;
}

function coerceWebhookSecrets(
  raw: unknown,
): Partial<Record<"github" | "gitlab" | "bitbucket", string>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Partial<Record<"github" | "gitlab" | "bitbucket", string>> = {};
  const r = raw as Record<string, unknown>;
  for (const k of ["github", "gitlab", "bitbucket"] as const) {
    if (typeof r[k] === "string") out[k] = r[k] as string;
  }
  return out;
}
