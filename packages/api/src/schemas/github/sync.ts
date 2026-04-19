import { z } from "zod";

/**
 * PRD §14 — `POST /api/admin/github/sync` (enqueue / trigger reconciliation).
 *
 * The route handler flips the progress row to 'queued' — the actual sync
 * work runs in the worker process picking up queued rows. If a sync is
 * already running for the installation, we return the in-flight progress
 * rather than spawning a second one (defense: `(tenant_id, installation_id)`
 * is the PK and the UPSERT is idempotent).
 */

export const EnqueueGithubSyncInput = z.object({
  /** Optional — default is the single installation bound to the tenant. */
  installation_id: z.string().regex(/^\d+$/).optional(),
  /** Force re-sync even when the last run completed. Default false. */
  force: z.boolean().default(false),
});
export type EnqueueGithubSyncInput = z.input<typeof EnqueueGithubSyncInput>;

export const EnqueueGithubSyncOutput = z.object({
  installation_id: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  started_at: z.string().datetime().nullable(),
  total_repos: z.number().int().nullable(),
  fetched_repos: z.number().int().nonnegative(),
  pages_fetched: z.number().int().nonnegative(),
});
export type EnqueueGithubSyncOutput = z.infer<typeof EnqueueGithubSyncOutput>;
