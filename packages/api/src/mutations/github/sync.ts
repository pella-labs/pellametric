import { AuthError, assertRole, type Ctx } from "../../auth";
import type { EnqueueGithubSyncInput, EnqueueGithubSyncOutput } from "../../schemas/github/sync";

/**
 * PRD §14 — `POST /api/admin/github/sync`.
 *
 * Flips the progress row for the caller's installation to `'queued'` so the
 * background worker picks it up. If the row doesn't exist, creates it.
 * Idempotent on the PK `(tenant_id, installation_id)`.
 *
 * If an existing row is already `running` and `force=false`, we return the
 * current state instead of clobbering it — avoids double-submission when
 * an admin clicks the "Sync" button twice.
 */
export async function enqueueGithubSync(
  ctx: Ctx,
  input: EnqueueGithubSyncInput,
): Promise<EnqueueGithubSyncOutput> {
  assertRole(ctx, ["admin"]);

  const installationRows = await ctx.db.pg.query<{ installation_id: string | bigint }>(
    `SELECT installation_id::text AS installation_id
       FROM github_installations
      WHERE tenant_id = $1
        ${input?.installation_id ? "AND installation_id = $2" : ""}
      ORDER BY installed_at DESC
      LIMIT 1`,
    input?.installation_id ? [ctx.tenant_id, input.installation_id] : [ctx.tenant_id],
  );
  const install = installationRows[0];
  if (!install) {
    throw new AuthError(
      "FORBIDDEN",
      "No GitHub installation bound to your org. Connect the GitHub App first.",
    );
  }
  const installationId = String(install.installation_id);

  // Check current progress state.
  const existing = await ctx.db.pg.query<{
    status: string;
    started_at: unknown | null;
    total_repos: number | null;
    fetched_repos: number;
    pages_fetched: number;
  }>(
    `SELECT status, started_at, total_repos, fetched_repos, pages_fetched
       FROM github_sync_progress
      WHERE tenant_id = $1 AND installation_id = $2
      LIMIT 1`,
    [ctx.tenant_id, installationId],
  );

  const force = input?.force === true;
  const current = existing[0];
  if (current && current.status === "running" && !force) {
    return {
      installation_id: installationId,
      status: "running",
      started_at: toIsoOrNull(current.started_at),
      total_repos: current.total_repos ?? null,
      fetched_repos: Number(current.fetched_repos ?? 0),
      pages_fetched: Number(current.pages_fetched ?? 0),
    };
  }

  // UPSERT to 'queued'. Worker picks up queued rows, flips to 'running',
  // sets started_at. Force resets fetched counters + cursor to force a full
  // re-walk; non-force resume keeps them so the worker continues where it
  // left off.
  const rows = await ctx.db.pg.query<{
    status: string;
    started_at: unknown | null;
    total_repos: number | null;
    fetched_repos: number;
    pages_fetched: number;
  }>(
    `INSERT INTO github_sync_progress
       (tenant_id, installation_id, status, last_progress_at, updated_at, requested_by)
     VALUES ($1, $2, 'queued', now(), now(), $3)
     ON CONFLICT (tenant_id, installation_id) DO UPDATE
       SET status = 'queued',
           last_progress_at = now(),
           updated_at = now(),
           last_error = NULL,
           completed_at = NULL,
           fetched_repos = CASE WHEN $4::boolean THEN 0 ELSE github_sync_progress.fetched_repos END,
           pages_fetched = CASE WHEN $4::boolean THEN 0 ELSE github_sync_progress.pages_fetched END,
           next_page_cursor = CASE WHEN $4::boolean THEN NULL ELSE github_sync_progress.next_page_cursor END,
           started_at = CASE WHEN $4::boolean THEN NULL ELSE github_sync_progress.started_at END,
           requested_by = EXCLUDED.requested_by
     RETURNING status, started_at, total_repos, fetched_repos, pages_fetched`,
    [ctx.tenant_id, installationId, ctx.actor_id, force],
  );

  const r = rows[0];

  // Audit log — admin initiated a sync. Immutable row, best-effort.
  try {
    await ctx.db.pg.query(
      `INSERT INTO audit_log
         (org_id, actor_user_id, action, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        ctx.tenant_id,
        ctx.actor_id,
        "github.sync_enqueued",
        "github_installation",
        installationId,
        JSON.stringify({ force }),
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "api/mutations/github/sync",
        msg: "audit_log write failed",
        err: msg,
      }),
    );
  }

  return {
    installation_id: installationId,
    status: (r?.status as "queued") ?? "queued",
    started_at: toIsoOrNull(r?.started_at),
    total_repos: r?.total_repos ?? null,
    fetched_repos: Number(r?.fetched_repos ?? 0),
    pages_fetched: Number(r?.pages_fetched ?? 0),
  };
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return v;
  }
  return null;
}
