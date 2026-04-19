import { z } from "zod";
import { Display } from "../gates";
import { DeveloperIdentity, Fidelity, Gated, Window } from "./common";

/**
 * List teams visible to the caller. Manager-scoped by RBAC; viewers get the
 * anonymized `label` only.
 */
export const TeamListInput = z.object({
  window: Window,
});
export type TeamListInput = z.infer<typeof TeamListInput>;

export const TeamSummary = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  /** Active engineers in window. Always >= 1 for a listed team. */
  engineers: z.number().int().positive(),
  /** Cohort size eligible for gating (may be smaller than `engineers`). */
  cohort_size: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  ai_leverage_score: Gated(z.number().min(0).max(100)),
  fidelity: Fidelity,
});
export type TeamSummary = z.infer<typeof TeamSummary>;

export const TeamListOutput = z.object({
  window: Window,
  teams: z.array(TeamSummary),
});
export type TeamListOutput = z.infer<typeof TeamListOutput>;

/**
 * 2×2 Manager view: X = Outcome Quality, Y = Efficiency. Cohort-stratified by
 * `task_category` (CLAUDE.md §Scoring Rules §7.4). IC names never ship — each
 * point carries only an 8-char `engineer_id_hash` for stable dot keys.
 */
export const TeamTwoByTwoInput = z.object({
  window: Window,
  team_id: z.string(),
  task_category: z.string().optional(),
  /**
   * Compliance-OFF demo opt-in: when true, the response carries an
   * `identities` map keyed by `engineer_id_hash`. Callers MUST gate this on
   * `isComplianceEnabled() === false`. Default false preserves the wire
   * shape for every current caller.
   */
  includeIdentities: z.boolean().optional(),
  /**
   * Compliance-OFF demo opt-in: when true, the k≥5 cohort floor is bypassed
   * so small teams render their scatter even though it would normally be
   * suppressed. Default false preserves the locked privacy floor.
   */
  bypassCohortFloor: z.boolean().optional(),
});
export type TeamTwoByTwoInput = z.infer<typeof TeamTwoByTwoInput>;

export const ScatterPoint = z.object({
  /** Stable 8-char hash for dot keys — never an engineer name. */
  engineer_id_hash: z.string().length(8),
  /** 0–100 cohort percentile (CLAUDE.md Scoring Rules — winsorize → rank). */
  outcome_quality: z.number().min(0).max(100),
  efficiency: z.number().min(0).max(100),
  sessions: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
});
export type ScatterPoint = z.infer<typeof ScatterPoint>;

export const TeamTwoByTwoOutput = z.object({
  window: Window,
  team_id: z.string(),
  task_category: z.string().nullable(),
  cohort_size: z.number().int().nonnegative(),
  /** Top-level gate — when k<5 the whole scatter is suppressed (CLAUDE.md §6.4). */
  display: Display,
  /** Empty when `display.show === false`. */
  points: z.array(ScatterPoint),
  /** Task categories available for cohort stratification in this team+window. */
  available_task_categories: z.array(z.string()),
  fidelity: Fidelity,
  /**
   * Plaintext identity per `engineer_id_hash`. Present ONLY when caller
   * opted in via `includeIdentities: true` (compliance-OFF demo path).
   */
  identities: z.record(z.string(), DeveloperIdentity).optional(),
});
export type TeamTwoByTwoOutput = z.infer<typeof TeamTwoByTwoOutput>;
