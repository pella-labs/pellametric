import { assertRole, type Ctx } from "../../auth";
import type {
  GetGithubConnectionInput,
  GetGithubConnectionOutput,
  GithubInstallationStatus,
  SyncStatus,
} from "../../schemas/github/connection";

/**
 * PRD §14 — `GET /api/admin/github/connection`.
 *
 * Returns the single (or nullable) GitHub installation bound to the caller's
 * tenant + the most recent sync progress row. Admin-only.
 *
 * Cross-tenant safety: explicit `WHERE tenant_id = $ctx.tenant_id` + RLS
 * on both tables (custom/0004 + custom/0005). Read is parameterized; never
 * interpolates tenant_id.
 */
export async function getGithubConnection(
  ctx: Ctx,
  _input: GetGithubConnectionInput,
): Promise<GetGithubConnectionOutput> {
  assertRole(ctx, ["admin"]);

  const installRows = await ctx.db.pg.query<{
    installation_id: string | number | bigint;
    github_org_login: string;
    status: string;
    installed_at: unknown;
    last_reconciled_at: unknown | null;
  }>(
    `SELECT installation_id::text AS installation_id,
            github_org_login,
            status,
            installed_at,
            last_reconciled_at
       FROM github_installations
      WHERE tenant_id = $1
      ORDER BY installed_at DESC
      LIMIT 1`,
    [ctx.tenant_id],
  );

  const trackingModeRows = await ctx.db.pg.query<{ github_repo_tracking_mode: string }>(
    `SELECT github_repo_tracking_mode FROM orgs WHERE id = $1 LIMIT 1`,
    [ctx.tenant_id],
  );
  const trackingMode = (trackingModeRows[0]?.github_repo_tracking_mode ?? "all") as
    | "all"
    | "selected";

  const install = installRows[0];
  if (!install) {
    return { installation: null, tracking_mode: trackingMode };
  }

  // Progress row — join on (tenant_id, installation_id). May be absent
  // (org never started a sync).
  const progressRows = await ctx.db.pg.query<{
    status: string;
    total_repos: number | null;
    fetched_repos: number;
    pages_fetched: number;
    started_at: unknown | null;
    completed_at: unknown | null;
    last_progress_at: unknown;
    last_error: string | null;
  }>(
    `SELECT status,
            total_repos,
            fetched_repos,
            pages_fetched,
            started_at,
            completed_at,
            last_progress_at,
            last_error
       FROM github_sync_progress
      WHERE tenant_id = $1
        AND installation_id = $2
      LIMIT 1`,
    [ctx.tenant_id, String(install.installation_id)],
  );

  const p = progressRows[0];
  const sync = p
    ? {
        status: normalizeSyncStatus(p.status),
        total_repos: p.total_repos ?? null,
        fetched_repos: Number(p.fetched_repos ?? 0),
        pages_fetched: Number(p.pages_fetched ?? 0),
        started_at: toIsoOrNull(p.started_at),
        completed_at: toIsoOrNull(p.completed_at),
        last_progress_at: toIso(p.last_progress_at),
        last_error: p.last_error ?? null,
        eta_seconds: estimateEta(p),
      }
    : null;

  return {
    installation: {
      installation_id: String(install.installation_id),
      github_org_login: install.github_org_login,
      status: normalizeInstallStatus(install.status),
      installed_at: toIso(install.installed_at),
      last_reconciled_at: toIsoOrNull(install.last_reconciled_at),
      sync,
    },
    tracking_mode: trackingMode,
  };
}

function normalizeInstallStatus(raw: string): GithubInstallationStatus {
  if (raw === "active" || raw === "suspended" || raw === "revoked" || raw === "reconnecting") {
    return raw;
  }
  return "active";
}

function normalizeSyncStatus(raw: string): SyncStatus {
  if (
    raw === "queued" ||
    raw === "running" ||
    raw === "completed" ||
    raw === "failed" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "queued";
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

/**
 * ETA heuristic: remaining pages × 1.1s/page (1s token-bucket floor plus a
 * 10% rate-limit headroom). `total_repos` divided by 100 (page size) gives
 * total pages; subtract `pages_fetched`. null when insufficient info.
 */
function estimateEta(p: {
  status: string;
  total_repos: number | null;
  pages_fetched: number;
}): number | null {
  if (p.status === "completed" || p.status === "cancelled" || p.status === "failed") return 0;
  if (p.total_repos === null) return null;
  const totalPages = Math.max(1, Math.ceil(p.total_repos / 100));
  const remaining = Math.max(0, totalPages - p.pages_fetched);
  return Math.ceil(remaining * 1.1);
}
