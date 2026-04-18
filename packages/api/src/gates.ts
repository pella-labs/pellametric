/**
 * Display gates — enforced server-side per contract 04 §Display gates and
 * CLAUDE.md Privacy Model Rules. A tile renders a number only when all four
 * hold:
 *
 *   sessions_count    ≥ 10
 *   active_days       ≥ 5
 *   outcome_events    ≥ 3
 *   cohort_size       ≥ 8 peers
 *
 * Team-level tiles additionally enforce k-anonymity:
 *
 *   cohort_size       ≥ 5  (CLAUDE.md §6.4)
 *
 * When any threshold fails, `applyDisplayGate` returns `{ show: false }` with
 * the specific gate named, so the frontend renders "insufficient data — gate X"
 * via the `InsufficientData` component in @bematist/ui.
 *
 * Invariants:
 * - Never approximate, never interpolate — a missed gate means no number.
 * - Reasons are named enum values, not free strings.
 * - Called by EVERY query that returns a shipped number.
 */

import { z } from "zod";

export const DisplaySuppression = z.enum([
  "insufficient_sessions",
  "insufficient_active_days",
  "insufficient_outcome_events",
  "insufficient_cohort",
  "k_anonymity_floor",
  "consent_required",
]);
export type DisplaySuppression = z.infer<typeof DisplaySuppression>;

export const Display = z.discriminatedUnion("show", [
  z.object({ show: z.literal(true) }),
  z.object({
    show: z.literal(false),
    suppression_reason: DisplaySuppression,
    failed_gates: z.array(z.string()),
  }),
]);
export type Display = z.infer<typeof Display>;

export interface GateInput {
  sessions_count: number;
  active_days: number;
  outcome_events: number;
  cohort_size: number;
  /** Set to true to additionally enforce k≥5 (team-level tiles). */
  team_scope?: boolean;
}

export const MIN_SESSIONS = 10;
export const MIN_ACTIVE_DAYS = 5;
export const MIN_OUTCOME_EVENTS = 3;
export const MIN_COHORT = 8;
export const K_ANONYMITY_FLOOR = 5;

/**
 * Evaluate the four display gates (plus k-anonymity for team scope). Returns a
 * `Display` payload the caller embeds into its response.
 *
 * Small-team carve-out: per PRD §6.4 + CLAUDE.md Privacy Model Rules,
 * "5-person teams do NOT get DP team rollups — they are a single trust domain
 * and see raw numbers". When `BEMATIST_SINGLE_TRUST_DOMAIN=1` is set in the
 * server env, the org is declared small-team-single-trust-domain and all
 * display gates short-circuit to `{ show: true }`. Intended for orgs ≤5
 * engineers (M4 rehearsal cohort is 4) and for self-host deploys where the
 * full privacy floor isn't load-bearing yet. Never set on managed cloud.
 */
export function applyDisplayGate(input: GateInput): Display {
  if (process.env.BEMATIST_SINGLE_TRUST_DOMAIN === "1") {
    return { show: true };
  }

  const failed: string[] = [];

  if (input.team_scope && input.cohort_size < K_ANONYMITY_FLOOR) {
    failed.push("k_anonymity_floor");
  }
  if (input.sessions_count < MIN_SESSIONS) failed.push("sessions");
  if (input.active_days < MIN_ACTIVE_DAYS) failed.push("active_days");
  if (input.outcome_events < MIN_OUTCOME_EVENTS) failed.push("outcome_events");
  if (input.cohort_size < MIN_COHORT) failed.push("cohort");

  if (failed.length === 0) return { show: true };

  // Pick the primary suppression reason deterministically — the most informative.
  const primary = pickPrimary(failed);
  return { show: false, suppression_reason: primary, failed_gates: failed };
}

function pickPrimary(failed: string[]): DisplaySuppression {
  // k-anonymity dominates — it's a privacy floor, not a data floor.
  if (failed.includes("k_anonymity_floor")) return "k_anonymity_floor";
  if (failed.includes("cohort")) return "insufficient_cohort";
  if (failed.includes("outcome_events")) return "insufficient_outcome_events";
  if (failed.includes("active_days")) return "insufficient_active_days";
  return "insufficient_sessions";
}
