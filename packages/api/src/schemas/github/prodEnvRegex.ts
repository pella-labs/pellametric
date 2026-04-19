import { z } from "zod";

/**
 * PRD-github-integration §11.7 / D60 — per-repo prod-env allowlist.
 *
 * `PATCH /api/admin/github/repos/:provider_repo_id/prod-env-regex`
 *   body: { pattern: string | null }
 *     • null     → reset to global default (`^(prod|production|live|main)$`).
 *     • string   → must compile as a RegExp; length ≤ 200. The API layer
 *                  validates via `new RegExp(pattern)` and returns 400 if
 *                  compilation throws.
 *
 * Audit-logged. Admin-only.
 */

export const PatchRepoProdEnvRegexInput = z.object({
  provider_repo_id: z.string().regex(/^\d+$/, "provider_repo_id must be a numeric string"),
  /**
   * Null → reset to the global default. A string is validated server-side
   * via `new RegExp(...)` — the zod schema only enforces the length budget
   * so the attempted compilation doesn't explode on pathological inputs.
   */
  pattern: z.string().max(200).nullable(),
});
export type PatchRepoProdEnvRegexInput = z.infer<typeof PatchRepoProdEnvRegexInput>;

export const PatchRepoProdEnvRegexOutput = z.object({
  provider_repo_id: z.string(),
  pattern: z.string().nullable(),
  /** Sample environments observed in last 30d that would match the new regex. */
  matching_environments_sample: z.array(z.string()).max(20),
});
export type PatchRepoProdEnvRegexOutput = z.infer<typeof PatchRepoProdEnvRegexOutput>;
