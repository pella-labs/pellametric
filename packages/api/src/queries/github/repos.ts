import { assertRole, type Ctx } from "../../auth";
import type { ListGithubReposInput, ListGithubReposOutput } from "../../schemas/github/repos";

/**
 * PRD §14 — `GET /api/admin/github/repos`.
 *
 * Paginated list of `repos` rows for the caller's org. Includes the two-level
 * tracking lattice collapsed into `effective_tracked: boolean`.
 *
 * Admin-only; tenant-scoped by `WHERE org_id = $1` + RLS.
 */
export async function listGithubRepos(
  ctx: Ctx,
  input: ListGithubReposInput,
): Promise<ListGithubReposOutput> {
  assertRole(ctx, ["admin"]);

  const page = input?.page ?? 1;
  const perPage = input?.per_page ?? 50;
  const q = input?.q;
  const includeArchived = input?.include_archived === true;

  const trackingModeRows = await ctx.db.pg.query<{ github_repo_tracking_mode: string }>(
    `SELECT github_repo_tracking_mode FROM orgs WHERE id = $1 LIMIT 1`,
    [ctx.tenant_id],
  );
  const trackingMode = (trackingModeRows[0]?.github_repo_tracking_mode ?? "all") as
    | "all"
    | "selected";

  const whereClauses = [`org_id = $1`, `provider = 'github'`, `deleted_at IS NULL`];
  const params: unknown[] = [ctx.tenant_id];
  if (!includeArchived) whereClauses.push(`archived_at IS NULL`);
  if (q && q.length > 0) {
    // M1 — admin search uses `full_name` (case-insensitive). `repo_id_hash`
    // is an HMAC and never search-exposed; we fall back to prefix-match on
    // `provider_repo_id` for rows whose full_name is still NULL (pre-M1
    // syncs, or new installs whose webhook has not fired yet).
    params.push(`%${q}%`);
    whereClauses.push(
      `(full_name ILIKE $${params.length} OR provider_repo_id ILIKE $${params.length})`,
    );
  }
  const where = whereClauses.join(" AND ");

  const totalRows = await ctx.db.pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM repos WHERE ${where}`,
    params,
  );
  const total = totalRows[0]?.n ?? 0;

  params.push(perPage);
  params.push((page - 1) * perPage);
  const rows = await ctx.db.pg.query<{
    id: string;
    provider_repo_id: string | null;
    repo_id_hash: string;
    full_name: string | null;
    default_branch: string | null;
    tracking_state: string;
    first_seen_at: unknown;
    archived_at: unknown | null;
  }>(
    `SELECT id::text AS id,
            provider_repo_id,
            repo_id_hash,
            full_name,
            default_branch,
            tracking_state,
            first_seen_at,
            archived_at
       FROM repos
      WHERE ${where}
      ORDER BY first_seen_at DESC, repo_id_hash ASC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}`,
    params,
  );

  return {
    repos: rows.map((r) => {
      const trackingState = normalizeTrackingState(r.tracking_state);
      return {
        id: r.id,
        provider_repo_id: r.provider_repo_id ?? "",
        // M1 — prefer the real `full_name` when the sync or webhook has
        // populated it; fall back to the provider-id humanizer for rows
        // whose webhook has not fired since the migration landed.
        full_name: r.full_name ?? humanizeHash(r.repo_id_hash),
        default_branch: r.default_branch,
        tracking_state: trackingState,
        effective_tracked: effectiveTracked(trackingMode, trackingState),
        first_seen_at: toIso(r.first_seen_at),
        archived_at: toIsoOrNull(r.archived_at),
      };
    }),
    page,
    per_page: perPage,
    total,
    tracking_mode: trackingMode,
  };
}

function normalizeTrackingState(raw: string): "inherit" | "included" | "excluded" {
  if (raw === "inherit" || raw === "included" || raw === "excluded") return raw;
  return "inherit";
}

/** Collapse (mode, state) → effective boolean. See schema doc. */
function effectiveTracked(
  mode: "all" | "selected",
  state: "inherit" | "included" | "excluded",
): boolean {
  if (state === "excluded") return false;
  if (state === "included") return true;
  // inherit
  return mode === "all";
}

function humanizeHash(hash: string): string {
  // Provider placeholder written by the initial-sync worker looks like
  // `gh:pending:<tenant_uuid>:<provider_repo_id>`. The real human-readable
  // full_name only lands via webhooks (G1-webhook-ingest) — until then we
  // render the placeholder directly so admins can still correlate by id.
  if (hash.startsWith("gh:pending:")) {
    const parts = hash.split(":");
    const id = parts[parts.length - 1];
    return `github/id:${id}`;
  }
  return hash;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return v;
  }
  return new Date().toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}
