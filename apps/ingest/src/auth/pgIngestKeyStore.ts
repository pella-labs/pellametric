// Postgres-backed IngestKeyStore.
//
// Looks up `ingest_keys` rows by `(bearer_org_id, key_id)`. Because the bearer
// regex in verifyIngestKey.ts restricts the `<orgId>` segment to `[A-Za-z0-9]+`
// (no hyphens, no underscores) while `orgs.id` is a UUID, bearers embed the
// alphanumeric `orgs.slug` and this store joins through it:
//
//   SELECT ik.* FROM ingest_keys ik
//   JOIN orgs o ON o.id = ik.org_id
//   WHERE o.slug = $1 AND ik.id = $2
//
// The returned `IngestKeyRow.org_id` is the UUID from `ingest_keys.org_id`
// (not the slug) so downstream tier enforcement and partition routing see the
// canonical tenant id.
//
// Single-row 60s LRU is applied by verifyBearer's caller; this store is a
// thin read layer with no internal cache.

import { ingestKeys, orgs } from "@bematist/schema/postgres";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { IngestKeyRow, IngestKeyStore, Tier } from "./verifyIngestKey";

export interface PgIngestKeyStoreDeps {
  db: PostgresJsDatabase<Record<string, unknown>>;
}

export function createPgIngestKeyStore(deps: PgIngestKeyStoreDeps): IngestKeyStore {
  return {
    async get(orgSlug: string, keyId: string): Promise<IngestKeyRow | null> {
      const rows = await deps.db
        .select({
          id: ingestKeys.id,
          org_id: ingestKeys.org_id,
          engineer_id: ingestKeys.engineer_id,
          key_sha256: ingestKeys.key_sha256,
          tier_default: ingestKeys.tier_default,
          revoked_at: ingestKeys.revoked_at,
        })
        .from(ingestKeys)
        .innerJoin(orgs, eq(orgs.id, ingestKeys.org_id))
        .where(and(eq(orgs.slug, orgSlug), eq(ingestKeys.id, keyId)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        org_id: row.org_id,
        engineer_id: row.engineer_id ?? null,
        key_sha256: row.key_sha256,
        tier_default: normalizeTier(row.tier_default),
        revoked_at: row.revoked_at ?? null,
      };
    },
  };
}

function normalizeTier(raw: string): Tier {
  const t = raw.trim().toUpperCase();
  if (t === "A" || t === "B" || t === "C") return t;
  throw new Error(`pgIngestKeyStore: unexpected tier_default '${raw}' on ingest_keys row`);
}
