import { z } from "zod";

/**
 * PRD §14 — tracking-mode + per-repo tracking-state + tracking-preview.
 *
 * Three admin-only surfaces owned by G2:
 *
 *   PATCH /api/admin/github/tracking-mode
 *     body: { mode: 'all' | 'selected' }
 *     writes orgs.github_repo_tracking_mode
 *
 *   PATCH /api/admin/github/repos/:provider_repo_id/tracking
 *     body: { state: 'inherit' | 'included' | 'excluded' }
 *     writes repos.tracking_state
 *
 *   GET   /api/admin/github/tracking-preview?mode=…&included_repos=…
 *     dry-run projection — NO side effects
 *
 * Both PATCHes emit a `session_repo_recompute` message per PRD D56 so the
 * G1-linker's coalescer picks it up and recomputes eligibility. The preview
 * endpoint computes the same projection in-memory without emitting or writing.
 */

export const TrackingMode = z.enum(["all", "selected"]);
export type TrackingMode = z.infer<typeof TrackingMode>;

export const TrackingState = z.enum(["inherit", "included", "excluded"]);
export type TrackingState = z.infer<typeof TrackingState>;

// ── PATCH /tracking-mode ────────────────────────────────────────────────────
export const PatchTrackingModeInput = z.object({
  mode: TrackingMode,
});
export type PatchTrackingModeInput = z.infer<typeof PatchTrackingModeInput>;

export const PatchTrackingModeOutput = z.object({
  mode: TrackingMode,
  /** Number of live sessions the recompute emitter was fanned out to. */
  sessions_recompute_queued: z.number().int().nonnegative(),
});
export type PatchTrackingModeOutput = z.infer<typeof PatchTrackingModeOutput>;

// ── PATCH /repos/:provider_repo_id/tracking ────────────────────────────────
export const PatchRepoTrackingInput = z.object({
  provider_repo_id: z.string().regex(/^\d+$/, "provider_repo_id must be a numeric string"),
  state: TrackingState,
});
export type PatchRepoTrackingInput = z.infer<typeof PatchRepoTrackingInput>;

export const PatchRepoTrackingOutput = z.object({
  provider_repo_id: z.string(),
  state: TrackingState,
  /** Sessions whose enrichment set intersects this repo — queued for recompute. */
  sessions_recompute_queued: z.number().int().nonnegative(),
});
export type PatchRepoTrackingOutput = z.infer<typeof PatchRepoTrackingOutput>;

// ── GET /tracking-preview ───────────────────────────────────────────────────
// Preview body uses `included_repos` as a comma-separated list of
// provider_repo_id values. The preview answers:
//
//   "If I switch mode to X and mark these repos as included/excluded, how
//    many sessions become eligible/ineligible, and what sample can I show
//    in the confirmation modal?"
//
// This is a READ — no writes, no audit_log row. Admin-only still enforced
// because the sample session UUIDs are tenant-scoped and should not leak to
// non-admin roles. k-anonymity does NOT apply here: this is the admin's own
// tenant, and the sample session_ids are opaque UUIDs — never names.

export const TrackingPreviewInput = z
  .object({
    mode: TrackingMode,
    /**
     * Comma-separated provider_repo_id values. Semantic meaning depends on
     * mode:
     *   mode='selected' → these are the ONLY repos considered tracked (plus
     *     any repos with tracking_state='included' in Postgres already).
     *   mode='all'      → these repos are explicitly EXCLUDED (plus any
     *     repos with tracking_state='excluded' in Postgres already).
     */
    included_repos: z.string().default(""),
  })
  .transform((v) => ({
    mode: v.mode,
    included_repos: v.included_repos
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s)),
  }));
export type TrackingPreviewInput = z.input<typeof TrackingPreviewInput>;
export type TrackingPreviewParsed = z.output<typeof TrackingPreviewInput>;

export const TrackingPreviewOutput = z.object({
  sessions_that_would_become_eligible: z.number().int().nonnegative(),
  sessions_that_would_become_ineligible: z.number().int().nonnegative(),
  /** Max 10. Opaque UUIDs — never names. */
  sample_eligible_sessions: z.array(z.string().uuid()).max(10),
  sample_ineligible_sessions: z.array(z.string().uuid()).max(10),
});
export type TrackingPreviewOutput = z.infer<typeof TrackingPreviewOutput>;
