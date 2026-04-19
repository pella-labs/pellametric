import { assertRole, type Ctx } from "../../auth";
import type {
  AdminBannerRow,
  GetAdminBannersInput,
  GetAdminBannersOutput,
} from "../../schemas/github/banners";

/**
 * PRD-github-integration §17 risk #1 — returns the list of admin banners
 * applicable to the caller's tenant + whether the caller has dismissed
 * each one. Admin-only.
 *
 * Current banners:
 *   • `squash_merge_trailer_loss` — surface when ANY tracked github repo
 *     has `merge_commit_allowed=false AND squash_merge_allowed=true` and
 *     the tenant has not disabled the `AI-Assisted:` trailer posture.
 *     Metadata includes the count of affected repos + up to 5 sample
 *     provider_repo_id values.
 */
export async function getGithubAdminBanners(
  ctx: Ctx,
  _input?: GetAdminBannersInput,
): Promise<GetAdminBannersOutput> {
  assertRole(ctx, ["admin"]);

  const banners: AdminBannerRow[] = [];

  const squashRows = await ctx.db.pg.query<{ provider_repo_id: string; n: number }>(
    `SELECT provider_repo_id, count(*) OVER () :: int AS n
       FROM repos
      WHERE org_id = $1
        AND provider = 'github'
        AND deleted_at IS NULL
        AND merge_commit_allowed = false
        AND squash_merge_allowed = true
      ORDER BY provider_repo_id
      LIMIT 5`,
    [ctx.tenant_id],
  );
  const squashTotal = squashRows[0]?.n ?? 0;
  if (squashTotal > 0) {
    const dismissedRows = await ctx.db.pg.query<{ dismissed_at: Date | string }>(
      `SELECT dismissed_at FROM admin_dismissed_banners
         WHERE tenant_id = $1 AND user_id = $2 AND banner_key = 'squash_merge_trailer_loss'
        LIMIT 1`,
      [ctx.tenant_id, ctx.actor_id],
    );
    const dismissed = dismissedRows[0];
    banners.push({
      banner_key: "squash_merge_trailer_loss",
      dismissed: dismissed !== undefined,
      dismissed_at: dismissed
        ? dismissed.dismissed_at instanceof Date
          ? dismissed.dismissed_at.toISOString()
          : String(dismissed.dismissed_at)
        : null,
      metadata: {
        affected_repo_count: squashTotal,
        sample_provider_repo_ids: squashRows.map((r) => r.provider_repo_id),
      },
    });
  }

  return { banners };
}
