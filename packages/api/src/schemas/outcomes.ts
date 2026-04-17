import { z } from "zod";
import { Window } from "./common";

/**
 * Outcome attribution types — what counts as a "win" landed by an agent
 * session. Drives `useful_output_v1` (accepted_code_edits_per_dollar) and
 * the AI Leverage Score's Outcome Quality subscore.
 *
 * See CLAUDE.md §Outcome Attribution Rules for the three-layer pipeline
 * (accept event → AI-Assisted trailer → git log / PR API fallback).
 */
export const OutcomeKind = z.enum(["accepted_edit", "merged_pr", "green_test", "revert"]);
export type OutcomeKind = z.infer<typeof OutcomeKind>;

// --- per-engineer aggregate ---

/**
 * Engineer-level outcome aggregate. Team-wide listing is k≥5 cohort-gated
 * by callers; raw access is manager/admin only.
 */
export const PerDevOutcome = z.object({
  engineer_id: z.string(),
  /** 8-char stable hash rendered to UI when the IC hasn't opted into naming. */
  engineer_id_hash: z.string().length(8),
  sessions: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  accepted_edits: z.number().int().nonnegative(),
  /** Accepted edits retained after a 24h revert window. */
  accepted_and_retained: z.number().int().nonnegative(),
  merged_prs: z.number().int().nonnegative(),
  green_tests: z.number().int().nonnegative(),
  reverts: z.number().int().nonnegative(),
});
export type PerDevOutcome = z.infer<typeof PerDevOutcome>;

export const PerDevOutcomesInput = z.object({
  window: Window.default("30d"),
  team_id: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(200),
});
export type PerDevOutcomesInput = z.infer<typeof PerDevOutcomesInput>;

export const PerDevOutcomesOutput = z.object({
  window: Window,
  team_id: z.string().nullable(),
  rows: z.array(PerDevOutcome),
  /** Cohort size before k-anon gate; frontend uses this to pick a gate banner. */
  cohort_size: z.number().int().nonnegative(),
});
export type PerDevOutcomesOutput = z.infer<typeof PerDevOutcomesOutput>;

// --- per-PR aggregate ---

export const PerPROutcome = z.object({
  repo: z.string(),
  pr_number: z.number().int().positive(),
  merged_at: z.string().datetime(),
  cost_usd: z.number().nonnegative(),
  /** Accepted hunks joined through the AI-Assisted trailer + accept anchor. */
  accepted_edit_count: z.number().int().nonnegative(),
  /** Was the PR reverted within 24h? Combines commit-msg + body marker + git-revert. */
  reverted: z.boolean(),
  /** Does the merged commit carry an `AI-Assisted:` trailer? */
  ai_assisted: z.boolean(),
});
export type PerPROutcome = z.infer<typeof PerPROutcome>;

export const PerPROutcomesInput = z.object({
  window: Window.default("30d"),
  repo: z.string().optional(),
  limit: z.number().int().positive().max(2000).default(200),
});
export type PerPROutcomesInput = z.infer<typeof PerPROutcomesInput>;

export const PerPROutcomesOutput = z.object({
  window: Window,
  repo: z.string().nullable(),
  rows: z.array(PerPROutcome),
  /** Server-aggregated totals so the UI doesn't re-sum a long list. */
  totals: z.object({
    prs: z.number().int().nonnegative(),
    cost_usd: z.number().nonnegative(),
    reverted_prs: z.number().int().nonnegative(),
    ai_assisted_prs: z.number().int().nonnegative(),
  }),
});
export type PerPROutcomesOutput = z.infer<typeof PerPROutcomesOutput>;

// --- per-commit aggregate ---

export const PerCommitOutcome = z.object({
  repo: z.string(),
  commit_sha: z.string(),
  pr_number: z.number().int().positive().nullable(),
  author_engineer_id_hash: z.string().length(8),
  ts: z.string().datetime(),
  cost_usd_attributed: z.number().nonnegative(),
  ai_assisted: z.boolean(),
  /** Set when a later `git revert` or `Revert "..."` commit points at this sha. */
  reverted: z.boolean(),
});
export type PerCommitOutcome = z.infer<typeof PerCommitOutcome>;

export const PerCommitOutcomesInput = z.object({
  window: Window.default("7d"),
  repo: z.string().optional(),
  limit: z.number().int().positive().max(5000).default(500),
});
export type PerCommitOutcomesInput = z.infer<typeof PerCommitOutcomesInput>;

export const PerCommitOutcomesOutput = z.object({
  window: Window,
  repo: z.string().nullable(),
  rows: z.array(PerCommitOutcome),
});
export type PerCommitOutcomesOutput = z.infer<typeof PerCommitOutcomesOutput>;
