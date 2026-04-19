import { assertRole, type Ctx } from "../../auth";
import type {
  DismissAdminBannerInput,
  DismissAdminBannerOutput,
} from "../../schemas/github/banners";

/**
 * PRD-github-integration §17 risk #1 — per-admin dismiss of a banner.
 * Writes `admin_dismissed_banners` row; idempotent via ON CONFLICT.
 * Admin-only.
 */
export async function dismissAdminBanner(
  ctx: Ctx,
  input: DismissAdminBannerInput,
): Promise<DismissAdminBannerOutput> {
  assertRole(ctx, ["admin"]);
  const nowIso = new Date().toISOString();
  await ctx.db.pg.query(
    `INSERT INTO admin_dismissed_banners (tenant_id, user_id, banner_key, dismissed_at)
     VALUES ($1, $2, $3, $4::timestamptz)
     ON CONFLICT (tenant_id, user_id, banner_key) DO UPDATE SET dismissed_at = EXCLUDED.dismissed_at`,
    [ctx.tenant_id, ctx.actor_id, input.banner_key, nowIso],
  );
  return { banner_key: input.banner_key, dismissed_at: nowIso };
}
