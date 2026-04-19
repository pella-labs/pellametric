import { z } from "zod";

/**
 * PRD §14 — `GET /api/admin/github/repos`.
 *
 * Paginated list of repos synced into the caller's org. "Effective tracked
 * status" collapses the two-level `(orgs.tracking_mode, repos.tracking_state)`
 * lattice down to a single boolean for UI purposes:
 *
 *   mode='all'      + state='inherit'  → true
 *   mode='all'      + state='excluded' → false
 *   mode='all'      + state='included' → true  (redundant; allowed)
 *   mode='selected' + state='inherit'  → false
 *   mode='selected' + state='included' → true
 *   mode='selected' + state='excluded' → false
 *
 * Writes (PATCH tracking_mode / per-repo state) are G2-admin-apis' scope.
 */

export const ListGithubReposInput = z.object({
  /** 1-indexed page. Default 1. */
  page: z.number().int().positive().default(1),
  /** Page size, max 100. Default 50. */
  per_page: z.number().int().positive().max(100).default(50),
  /** Optional substring filter on `full_name`. */
  q: z.string().trim().max(200).optional(),
  /** If true, include archived repos. Default false. */
  include_archived: z.boolean().default(false),
});
export type ListGithubReposInput = z.input<typeof ListGithubReposInput>;

export const GithubRepoListItem = z.object({
  id: z.string().uuid(),
  provider_repo_id: z.string(),
  full_name: z.string(),
  default_branch: z.string().nullable(),
  tracking_state: z.enum(["inherit", "included", "excluded"]),
  effective_tracked: z.boolean(),
  first_seen_at: z.string().datetime(),
  archived_at: z.string().datetime().nullable(),
});
export type GithubRepoListItem = z.infer<typeof GithubRepoListItem>;

export const ListGithubReposOutput = z.object({
  repos: z.array(GithubRepoListItem),
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  /** Effective tracking mode (echoed so the UI can render a global banner). */
  tracking_mode: z.enum(["all", "selected"]),
});
export type ListGithubReposOutput = z.infer<typeof ListGithubReposOutput>;
