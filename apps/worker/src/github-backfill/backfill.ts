// G1 step 1 — GitHub-integration backfill worker.
//
// PRD §9.9 "Backfill plan":
//   1. ALTER ... NOT VALID + app writes populate new columns.
//   2. Worker streams through repos / git_events in 10k chunks writing new
//      columns from existing data.
//   3. VALIDATE CONSTRAINT once scan completes (separate post-backfill migration).
//   4. Rollback rehearsed.
//
// Scope of THIS worker (step 1 of G1):
//   - `repos`: for rows WHERE provider='github' AND provider_repo_id IS NULL,
//     leave provider_repo_id NULL (we don't have a reliable source in the
//     existing repos table — repo_id_hash is an HMAC of (full_name, salt),
//     so we cannot recover provider_repo_id from it). Future work: the
//     per-installation initial sync (G1-linker) is the canonical writer.
//     This worker is still valuable: it walks the pending rows in 10k-row
//     chunks so we can emit progress + a count for observability.
//   - `git_events`: for rows with a non-null `repo_id` + resolvable
//     provider_repo_id on the joined `repos` row, compute
//     `repo_id_hash := hmac(tenant_salt, 'github:' || provider_repo_id)`
//     per D33. Rows without a matching provider_repo_id get repo_id_hash
//     left NULL — they'll be picked up after G1-linker lands.
//
// Chunking: 10k rows per iteration, driven by a monotonic id cursor. Every
// update is gated on `repo_id_hash IS NULL` so re-running is idempotent
// (no double-writes, no overwrites of already-populated hashes).
//
// Uses the raw postgres.js `Sql` client rather than drizzle — drizzle's
// sql-template serializes JS arrays as positional-param tuples (which can't
// be cast to `uuid[]`/`bytea[]`), but postgres.js passes arrays as single
// parameters natively. Bulk UPDATE lands the whole chunk in one round-trip.
//
// Tenant-salt note: for v1 we DERIVE the per-tenant salt from a stable per-org
// value (org.id prefix) rather than reading a dedicated secrets-store entry.
// This matches the existing D12 convention seen in packages/scoring; G1-linker
// promotes this to a real KMS reference when the linker lands. The hash is
// written once; re-computing requires the alias table (§9.8) — handled by
// G1-linker, not this worker.

import { createHmac } from "node:crypto";
import type { Sql } from "postgres";

export interface BackfillDeps {
  /**
   * postgres.js client. Native array binding is required (drizzle's sql
   * template can't bind `uuid[]` / `bytea[]` cleanly).
   */
  sql: Sql;
  /**
   * Per-tenant salt resolver. In production this is a KMS read; for v1 we
   * default to `hmac('bematist-repo-id-hash', org.id)`. Overridable so
   * tests can pin a deterministic salt.
   */
  tenantSalt?: (orgId: string) => Buffer;
  /**
   * Chunk size (rows per iteration). 10k per PRD §9.9. Overridable for
   * testing so we can force >1 chunk with a smaller seed.
   */
  chunkSize?: number;
  /**
   * Sink for structured progress logs. Defaults to console.log.
   * Overridable so tests can assert on emitted events without stdout noise.
   */
  log?: (event: BackfillLogEvent) => void;
}

export interface BackfillLogEvent {
  level: "info" | "warn" | "error";
  stage:
    | "repos_start"
    | "repos_chunk"
    | "repos_done"
    | "git_events_start"
    | "git_events_chunk"
    | "git_events_done";
  rows?: number;
  chunk?: number;
  elapsed_ms?: number;
  msg: string;
}

export interface BackfillReport {
  repos: { scanned: number; updated: number; chunks: number };
  git_events: { scanned: number; updated: number; chunks: number };
}

const DEFAULT_CHUNK = 10_000;

function defaultTenantSalt(orgId: string): Buffer {
  return Buffer.from(createHmac("sha256", "bematist-repo-id-hash").update(orgId).digest());
}

/**
 * Compute the canonical repo_id_hash per D33.
 * `repo_id_hash := hmac(tenant_salt, 'github:' || provider_repo_id)`.
 */
export function computeRepoIdHash(tenantSalt: Buffer, providerRepoId: string): Buffer {
  return Buffer.from(createHmac("sha256", tenantSalt).update(`github:${providerRepoId}`).digest());
}

/**
 * Backfill `git_events.repo_id_hash` for every row where a joined
 * `repos.provider_repo_id` is resolvable. Idempotent: only scans rows where
 * `repo_id_hash IS NULL`; re-running produces no additional writes.
 */
export async function runBackfill(deps: BackfillDeps): Promise<BackfillReport> {
  const chunk = deps.chunkSize ?? DEFAULT_CHUNK;
  const salt = deps.tenantSalt ?? defaultTenantSalt;
  const log = deps.log ?? defaultLogger;
  const sql = deps.sql;

  // -----------------------------------------------------------------------
  // Stage 1 — `repos`. This worker does NOT synthesize provider_repo_id from
  // repo_id_hash (one-way HMAC); all we do here is walk the pending rows in
  // deterministic 10k-row chunks so we can emit progress + a count. Returns
  // (scanned, updated=0) so callers can observe that G1-linker still owns
  // the actual provider_repo_id writes.
  // -----------------------------------------------------------------------
  const reposReport = { scanned: 0, updated: 0, chunks: 0 };
  {
    const startedAt = Date.now();
    log({
      level: "info",
      stage: "repos_start",
      msg: "backfill: scanning repos (provider=github + provider_repo_id IS NULL)",
    });

    let cursor = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const rows = (await sql.unsafe(
        `SELECT id::text AS id
         FROM repos
         WHERE provider = 'github'
           AND provider_repo_id IS NULL
           AND id::text > $1
         ORDER BY id::text
         LIMIT $2`,
        [cursor, chunk],
      )) as unknown as Array<{ id: string }>;

      if (rows.length === 0) break;
      reposReport.scanned += rows.length;
      reposReport.chunks += 1;
      const last = rows[rows.length - 1];
      if (!last) break;
      cursor = last.id;

      log({
        level: "info",
        stage: "repos_chunk",
        rows: rows.length,
        chunk: reposReport.chunks,
        msg: "backfill: repos chunk scanned",
      });

      if (rows.length < chunk) break;
    }

    log({
      level: "info",
      stage: "repos_done",
      rows: reposReport.scanned,
      elapsed_ms: Date.now() - startedAt,
      msg: `backfill: repos done — ${reposReport.scanned} scanned, 0 updated (provider_repo_id source is G1-linker initial sync)`,
    });
  }

  // -----------------------------------------------------------------------
  // Stage 2 — `git_events`. For each row with repo_id_hash=NULL, look up the
  // joined repo's (org_id, provider_repo_id). If both present, compute the
  // HMAC per D33 and write. Idempotent; chunked.
  // -----------------------------------------------------------------------
  const evReport = { scanned: 0, updated: 0, chunks: 0 };
  {
    const startedAt = Date.now();
    log({
      level: "info",
      stage: "git_events_start",
      msg: "backfill: scanning git_events (source=github + repo_id_hash IS NULL)",
    });

    let cursor = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const rows = (await sql.unsafe(
        `SELECT ge.id::text AS id, ge.org_id::text AS org_id,
                r.provider_repo_id AS provider_repo_id
         FROM git_events ge
         LEFT JOIN repos r
           ON r.org_id = ge.org_id
          AND r.repo_id_hash = ge.repo_id
          AND r.provider = 'github'
         WHERE ge.source = 'github'
           AND ge.repo_id_hash IS NULL
           AND ge.id::text > $1
         ORDER BY ge.id::text
         LIMIT $2`,
        [cursor, chunk],
      )) as unknown as Array<{
        id: string;
        org_id: string;
        provider_repo_id: string | null;
      }>;

      if (rows.length === 0) break;
      evReport.scanned += rows.length;
      evReport.chunks += 1;
      const last = rows[rows.length - 1];
      if (!last) break;
      cursor = last.id;

      // Rows lacking provider_repo_id are skipped — they'll be picked up by
      // a later pass after G1-linker populates repos.provider_repo_id.
      // `repo_id_hash IS NULL` in the bulk UPDATE guards against races with
      // webhook writers that also populate this column.
      //
      // Single bulk UPDATE per chunk via UPDATE ... FROM unnest(array, array)
      // — postgres.js binds JS arrays as single `_uuid` / `_bytea` params.
      const updateIds: string[] = [];
      const updateHashesHex: string[] = []; // bytea sent as hex text then decoded
      for (const r of rows) {
        if (!r.provider_repo_id) continue;
        updateIds.push(r.id);
        updateHashesHex.push(computeRepoIdHash(salt(r.org_id), r.provider_repo_id).toString("hex"));
      }

      if (updateIds.length > 0) {
        // postgres.js can't round-trip a JS Buffer[] as `bytea[]` (serializes
        // as a single concatenated bytea). We marshal via hex-encoded text[]
        // and decode on the server. `decode(t, 'hex')` is a zero-copy op.
        await sql.unsafe(
          `UPDATE git_events ge
             SET repo_id_hash = decode(u.h_hex, 'hex')
             FROM (
               SELECT unnest($1::uuid[]) AS id,
                      unnest($2::text[]) AS h_hex
             ) u
           WHERE ge.id = u.id
             AND ge.repo_id_hash IS NULL`,
          [updateIds, updateHashesHex] as unknown as string[],
        );
      }
      const updatedInChunk = updateIds.length;
      evReport.updated += updatedInChunk;

      log({
        level: "info",
        stage: "git_events_chunk",
        rows: rows.length,
        chunk: evReport.chunks,
        msg: `backfill: git_events chunk — scanned=${rows.length} updated=${updatedInChunk}`,
      });

      if (rows.length < chunk) break;
    }

    log({
      level: "info",
      stage: "git_events_done",
      rows: evReport.scanned,
      elapsed_ms: Date.now() - startedAt,
      msg: `backfill: git_events done — ${evReport.scanned} scanned, ${evReport.updated} updated`,
    });
  }

  return { repos: reposReport, git_events: evReport };
}

function defaultLogger(_event: BackfillLogEvent): void {}
