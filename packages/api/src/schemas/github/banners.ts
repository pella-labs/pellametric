import { z } from "zod";

/**
 * PRD-github-integration §17 risk #1 — squash-merge `AI-Assisted:` trailer
 * loss. Admin sees a dismissible banner on `/admin/github` listing the
 * tracked repos with incompatible merge settings. Dismissal state is
 * persisted per (tenant, user, banner_key).
 */

export const BannerKey = z.enum(["squash_merge_trailer_loss"]);
export type BannerKey = z.infer<typeof BannerKey>;

// GET — list banners + dismiss state for the current admin.
export const GetAdminBannersInput = z.object({}).optional();
export type GetAdminBannersInput = z.infer<typeof GetAdminBannersInput>;

export const AdminBannerRow = z.object({
  banner_key: BannerKey,
  dismissed: z.boolean(),
  dismissed_at: z.string().nullable(),
  /** Banner-specific metadata for the UI layer. */
  metadata: z.record(z.string(), z.unknown()),
});
export type AdminBannerRow = z.infer<typeof AdminBannerRow>;

export const GetAdminBannersOutput = z.object({
  banners: z.array(AdminBannerRow),
});
export type GetAdminBannersOutput = z.infer<typeof GetAdminBannersOutput>;

// POST — dismiss.
export const DismissAdminBannerInput = z.object({
  banner_key: BannerKey,
});
export type DismissAdminBannerInput = z.infer<typeof DismissAdminBannerInput>;

export const DismissAdminBannerOutput = z.object({
  banner_key: BannerKey,
  dismissed_at: z.string(),
});
export type DismissAdminBannerOutput = z.infer<typeof DismissAdminBannerOutput>;
