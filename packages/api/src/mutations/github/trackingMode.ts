import { AuthError, assertRole, type Ctx } from "../../auth";
import type {
  PatchTrackingModeInput,
  PatchTrackingModeOutput,
  TrackingMode,
} from "../../schemas/github/tracking";

/**
 * PRD §14 — `PATCH /api/admin/github/tracking-mode`.
 *
 * Admin-only. Writes `orgs.github_repo_tracking_mode` and fans out a
 * `session_repo_recompute` message per live session so the G1-linker's
 * coalescer picks up the change and recomputes eligibility (D56).
 *
 * Idempotent: writing the same mode twice is safe; no recompute messages
 * are emitted when the effective value did not change.
 *
 * Audit-logged.
 *
 * Cross-tenant safety: explicit `tenant_id = $1` + RLS on `orgs`.
 */
export interface RecomputeEmitter {
  emitTrackingModeFlipped(args: { tenant_id: string; newMode: TrackingMode }): Promise<number>;
}

export interface PatchTrackingModeDeps {
  recompute: RecomputeEmitter;
}

export async function patchTrackingMode(
  ctx: Ctx,
  input: PatchTrackingModeInput,
  deps: PatchTrackingModeDeps,
): Promise<PatchTrackingModeOutput> {
  assertRole(ctx, ["admin"]);

  const existingRows = await ctx.db.pg.query<{ github_repo_tracking_mode: string }>(
    `SELECT github_repo_tracking_mode FROM orgs WHERE id = $1 LIMIT 1`,
    [ctx.tenant_id],
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new AuthError("FORBIDDEN", "No org bound to your session.");
  }
  const existingMode = normalizeMode(existing.github_repo_tracking_mode);
  const unchanged = existingMode === input.mode;

  if (!unchanged) {
    await ctx.db.pg.query(`UPDATE orgs SET github_repo_tracking_mode = $2 WHERE id = $1`, [
      ctx.tenant_id,
      input.mode,
    ]);
  }

  // Emit recompute fan-out (D56). No-op if unchanged (consumer would dedup
  // via inputs_sha256 anyway, but we save the write).
  let queued = 0;
  if (!unchanged) {
    queued = await deps.recompute.emitTrackingModeFlipped({
      tenant_id: ctx.tenant_id,
      newMode: input.mode,
    });
  }

  try {
    await ctx.db.pg.query(
      `INSERT INTO audit_log
         (org_id, actor_user_id, action, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        ctx.tenant_id,
        ctx.actor_id,
        "github.tracking_mode_updated",
        "org",
        ctx.tenant_id,
        JSON.stringify({
          previous: existingMode,
          next: input.mode,
          unchanged,
          sessions_queued: queued,
        }),
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "api/mutations/github/trackingMode",
        msg: "audit_log write failed",
        err: msg,
      }),
    );
  }

  return {
    mode: input.mode,
    sessions_recompute_queued: queued,
  };
}

function normalizeMode(raw: string): TrackingMode {
  return raw === "selected" ? "selected" : "all";
}
