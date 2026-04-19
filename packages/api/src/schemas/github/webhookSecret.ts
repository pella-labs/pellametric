import { z } from "zod";

/**
 * PRD §14 — `POST /api/admin/github/webhook-secret/rotate`.
 *
 * Atomic two-column rotation per §11.5 (D55):
 *
 *   UPDATE github_installations
 *      SET webhook_secret_previous_ref = webhook_secret_active_ref,
 *          webhook_secret_active_ref   = <new_ref>,
 *          webhook_secret_rotated_at   = now()
 *    WHERE tenant_id = $1 AND installation_id = $2;
 *
 * Both OLD and NEW secrets accept signatures for a 10-minute window. The
 * eviction cron (shipped in PR #85) nulls `webhook_secret_previous_ref`
 * once `rotated_at + 10 min` passes.
 *
 * The rotation endpoint does NOT generate the new secret bytes itself — it
 * accepts a caller-supplied `new_secret_ref` (a pointer into the secrets
 * store; the actual rotation UX stores the new secret there first, then
 * calls this endpoint). The endpoint validates the ref's shape only.
 *
 * Input intentionally minimal: installation_id is optional (default = the
 * single installation bound to the tenant).
 */

export const RotateWebhookSecretInput = z.object({
  installation_id: z.string().regex(/^\d+$/, "installation_id must be a numeric string").optional(),
  /**
   * Pointer into the secrets store — matches the shape of
   * `webhook_secret_active_ref` (opaque string, max 255 chars,
   * whitelisted character set). The secrets store impl owns the actual
   * bytes; the endpoint only swaps pointers atomically.
   */
  new_secret_ref: z
    .string()
    .min(1)
    .max(255)
    .regex(
      /^[A-Za-z0-9._:\-/]+$/,
      "new_secret_ref must be [A-Za-z0-9._:\\-/] only (opaque secret-store pointer)",
    ),
});
export type RotateWebhookSecretInput = z.infer<typeof RotateWebhookSecretInput>;

export const RotateWebhookSecretOutput = z.object({
  installation_id: z.string(),
  rotated_at: z.string().datetime(),
  /** When the fallback (old secret) window closes. Always rotated_at + 10 min. */
  window_expires_at: z.string().datetime(),
  new_secret_ref: z.string(),
});
export type RotateWebhookSecretOutput = z.infer<typeof RotateWebhookSecretOutput>;

export const ROTATION_WINDOW_MINUTES = 10;
