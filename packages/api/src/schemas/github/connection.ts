import { z } from "zod";

/**
 * PRD §14 — `GET /api/admin/github/connection`.
 *
 * Returns the single installation for the caller's tenant + the most recent
 * sync progress row. If no installation is connected yet, returns
 * `{ installation: null }` so the UI can render the "Connect GitHub" CTA.
 */

export const GetGithubConnectionInput = z.object({});
export type GetGithubConnectionInput = z.input<typeof GetGithubConnectionInput>;

export const GithubInstallationStatus = z.enum(["active", "suspended", "revoked", "reconnecting"]);
export type GithubInstallationStatus = z.infer<typeof GithubInstallationStatus>;

export const SyncStatus = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type SyncStatus = z.infer<typeof SyncStatus>;

export const SyncProgress = z.object({
  status: SyncStatus,
  total_repos: z.number().int().nullable(),
  fetched_repos: z.number().int().nonnegative(),
  pages_fetched: z.number().int().nonnegative(),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  last_progress_at: z.string().datetime(),
  last_error: z.string().nullable(),
  /** Rough ETA seconds based on rate-limit-aware plan: pages × 1s + rate-limit budget. */
  eta_seconds: z.number().int().nonnegative().nullable(),
});
export type SyncProgress = z.infer<typeof SyncProgress>;

export const GithubConnection = z.object({
  installation_id: z.string(), // bigint stringified
  github_org_login: z.string(),
  status: GithubInstallationStatus,
  installed_at: z.string().datetime(),
  last_reconciled_at: z.string().datetime().nullable(),
  /** Null until a sync has been requested. */
  sync: SyncProgress.nullable(),
});
export type GithubConnection = z.infer<typeof GithubConnection>;

export const GetGithubConnectionOutput = z.object({
  installation: GithubConnection.nullable(),
  /** The tenant-wide tracking mode (`all` | `selected`). */
  tracking_mode: z.enum(["all", "selected"]),
});
export type GetGithubConnectionOutput = z.infer<typeof GetGithubConnectionOutput>;
