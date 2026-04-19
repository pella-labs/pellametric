// Same-transaction writer for `session_repo_links` + `session_repo_eligibility`
// (PRD §10 final SQL block).
//
// Contract:
//   - Atomic: if the txn fails, BOTH tables are untouched.
//   - Idempotent: `inputs_sha256` is the skip gate — if the eligibility row
//     already has the same inputs_sha256, we rewrite nothing.
//   - RLS: wraps the txn in `SELECT set_config('app.current_org_id', $1, true)`
//     so the NOBYPASSRLS `app_bematist` role can reach the partitioned table
//     without smuggling across tenants.
//   - Forbidden-field gate: `assertEvidenceSafe` runs on every link row
//     before the INSERT (D57).
//
// Downstream dict-sync (Postgres→CH) is out of scope for this PR — the
// `session_repo_eligibility_dict` publication lands in G2.

import type { Sql } from "postgres";
import {
  assertEvidenceSafe,
  type LinkerState,
  type SessionRepoEligibilityRow,
  type SessionRepoLinkRow,
} from "./state";

type SqlLike = Sql;

export interface WriteResult {
  /** Count of new link rows actually INSERTed (excluding conflicts). */
  insertedLinks: number;
  /** Count of rows updated to stale (different inputs_sha256 → old rows marked stale). */
  staledLinks: number;
  /** Whether the eligibility row was touched this call. */
  eligibilityRewritten: boolean;
  /** Whether the txn was skipped entirely (inputs_sha256 unchanged). */
  skipped: boolean;
}

export async function writeLinkerState(
  sql: SqlLike,
  state: LinkerState,
  tenantId: string,
): Promise<WriteResult> {
  // Forbidden-field gate runs OUTSIDE the txn — no point opening a transaction
  // only to abort on a developer mistake.
  for (const link of state.links) assertEvidenceSafe(link.evidence);

  let result: WriteResult = {
    insertedLinks: 0,
    staledLinks: 0,
    eligibilityRewritten: false,
    skipped: false,
  };

  await sql.begin(async (tx) => {
    await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [tenantId]);

    // Idempotency gate: if eligibility.inputs_sha256 hasn't changed, skip.
    const [existing] = (await tx.unsafe(
      `SELECT inputs_sha256 FROM session_repo_eligibility WHERE tenant_id = $1 AND session_id = $2`,
      [tenantId, state.eligibility.session_id],
    )) as unknown as Array<{ inputs_sha256: Buffer | null } | undefined>;
    if (existing?.inputs_sha256?.equals(state.inputs_sha256)) {
      result = { ...result, skipped: true };
      return;
    }

    // Stale mark existing links whose inputs_sha256 differs (PRD §10).
    const staleRes = (await tx.unsafe(
      `UPDATE session_repo_links
         SET stale_at = now()
         WHERE tenant_id = $1
           AND session_id = $2
           AND inputs_sha256 IS DISTINCT FROM $3::bytea
           AND stale_at IS NULL`,
      [tenantId, state.eligibility.session_id, state.inputs_sha256],
    )) as unknown as { count?: number };
    const staled = Number(staleRes.count ?? 0);

    // INSERT new link rows. Partitioned tables require any ON CONFLICT
    // target to include the partition-routing column (`computed_at`) which
    // we can't guarantee uniqueness on. Instead: INSERT ... WHERE NOT EXISTS
    // against the partial unique index (B5, migration 0008): uniqueness is
    // scoped to `stale_at IS NULL`, so a stale historical row for the same
    // PK tuple no longer blocks a fresh insert. The guard below must
    // mirror that partial predicate.
    let inserted = 0;
    for (const link of state.links) {
      const res = (await tx.unsafe(
        `INSERT INTO session_repo_links
           (tenant_id, session_id, repo_id_hash, match_reason, provider_repo_id,
            evidence, confidence, inputs_sha256, computed_at, stale_at)
         SELECT $1, $2, $3::bytea, $4, $5, $6::jsonb, $7, $8::bytea, $9::timestamptz, $10
         WHERE NOT EXISTS (
           SELECT 1 FROM session_repo_links
             WHERE tenant_id = $1
               AND session_id = $2
               AND repo_id_hash = $3::bytea
               AND match_reason = $4
               AND stale_at IS NULL
         )`,
        [
          link.tenant_id,
          link.session_id,
          link.repo_id_hash,
          link.match_reason,
          link.provider_repo_id,
          JSON.stringify(link.evidence),
          link.confidence,
          link.inputs_sha256,
          link.computed_at,
          link.stale_at,
        ],
      )) as unknown as { count?: number };
      inserted += Number(res.count ?? 0);
    }

    // UPSERT eligibility row.
    await tx.unsafe(
      `INSERT INTO session_repo_eligibility
         (tenant_id, session_id, effective_at, eligibility_reasons, eligible, inputs_sha256, updated_at)
       VALUES ($1, $2, $3::timestamptz, $4::jsonb, $5, $6::bytea, now())
       ON CONFLICT (tenant_id, session_id) DO UPDATE
         SET effective_at        = EXCLUDED.effective_at,
             eligibility_reasons = EXCLUDED.eligibility_reasons,
             eligible            = EXCLUDED.eligible,
             inputs_sha256       = EXCLUDED.inputs_sha256,
             updated_at          = now()
         WHERE session_repo_eligibility.inputs_sha256 IS DISTINCT FROM EXCLUDED.inputs_sha256`,
      [
        state.eligibility.tenant_id,
        state.eligibility.session_id,
        state.eligibility.effective_at,
        JSON.stringify(state.eligibility.eligibility_reasons),
        state.eligibility.eligible,
        state.eligibility.inputs_sha256,
      ],
    );

    result = {
      insertedLinks: inserted,
      staledLinks: staled,
      eligibilityRewritten: true,
      skipped: false,
    };
  });

  return result;
}

/**
 * Synthetic "installation suspend" path: stale_at := now() on all active
 * link rows for (tenant, session), without changing the eligibility state or
 * inputs_sha256. Separate from the normal recompute because suspend-events
 * deliberately DO NOT re-derive state (no new inputs, just lifecycle).
 */
export async function markLinksStaleForInstallation(
  sql: SqlLike,
  tenantId: string,
  installationId: string,
): Promise<number> {
  // We stale rows by matching via `repos.provider_repo_id` where the session
  // previously linked — but we don't have a direct (install → repo) map in
  // this table. The conservative choice: stale everything for this tenant.
  // An installation in practice owns most/all of a tenant's repos; the audit
  // trail is preserved either way.
  //
  // This is good-enough-for-G1; the hook to scope on actual repo membership
  // lands with the reconciliation runner in G3.
  void installationId;
  const res = (await sql.unsafe(
    `UPDATE session_repo_links
       SET stale_at = now()
       WHERE tenant_id = $1 AND stale_at IS NULL`,
    [tenantId],
  )) as unknown as { count?: number };
  return Number(res.count ?? 0);
}

/**
 * Clear stale_at after an installation comes back online, for rows whose
 * inputs_sha256 still matches the current eligibility row. The commutativity
 * invariant guarantees an unchanged input-set produces an identical
 * inputs_sha256 — so unchanged rows clear; genuinely-changed rows re-compute
 * via the normal stream.
 */
export async function clearStaleForInstallation(
  sql: SqlLike,
  tenantId: string,
  installationId: string,
): Promise<number> {
  void installationId;
  const res = (await sql.unsafe(
    `UPDATE session_repo_links l
       SET stale_at = NULL
       WHERE l.tenant_id = $1
         AND l.stale_at IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM session_repo_eligibility e
             WHERE e.tenant_id = l.tenant_id
               AND e.session_id = l.session_id
               AND e.inputs_sha256 = l.inputs_sha256
         )`,
    [tenantId],
  )) as unknown as { count?: number };
  return Number(res.count ?? 0);
}

// re-export for tests that assert type compatibility
export type { SessionRepoEligibilityRow, SessionRepoLinkRow };
