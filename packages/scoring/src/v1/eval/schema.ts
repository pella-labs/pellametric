/**
 * Eval fixture schema — JSONL record shape consumed by `runner.ts`.
 *
 * A fixture case is a complete `ScoringInput` plus ground-truth expectations
 * and a human-readable archetype tag. The runner loads one JSON object per
 * line, runs it through `score()`, and compares against the expectations.
 *
 * Expected values come from two sources:
 *  - Hand-curated cases (`archetypes.ts`): `expected_final_als` and
 *    `expected_confidence` are computed from the locked spec in
 *    `reference-math.ts` against the raw signals specified per case. They are
 *    deterministic, not subjective.
 *  - Auto-generated cases (`generate.ts`): signals are sampled from calibrated
 *    distributions; expectations are computed by the same oracle.
 *
 * The oracle (`reference-math.ts`) is the PRD spec written cleanly. The
 * production code under `v1/` must eventually agree with it within the
 * eval-gate tolerances (MAE ≤ 3, max|err| ≤ 10, Kendall τ ≥ 0.7).
 */

import type { ScoringInput } from "../../index";

export const ARCHETYPE_TAGS = [
  "low-performer",
  "average",
  "high-leverage",
  "new-hire",
  "regression-case",
  "goodhart-gaming",
] as const;

export type ArchetypeTag = (typeof ARCHETYPE_TAGS)[number];

export interface ExpectedSubscores {
  outcome_quality?: number;
  efficiency?: number;
  autonomy?: number;
  adoption_depth?: number;
  team_impact?: number;
}

export interface FixtureCase {
  /** Stable id; used for per-case error reporting and snapshot keys. */
  case_id: string;
  archetype_tag: ArchetypeTag;
  input: ScoringInput;
  /** 0..100. Gate (a) MAE is computed against this. */
  expected_final_als: number;
  /** 0..1. Sanity check — caught by a separate assertion, not the main gate. */
  expected_confidence: number;
  /** Optional per-subscore expectations for per-archetype MAE output. */
  expected_subscores?: ExpectedSubscores;
  /**
   * Per-case tolerance on `final_als`. Defaults to the aggregate gate (3).
   * Hand-curated edge cases sometimes need wider windows (e.g. 5) and that
   * must be explicit so we don't quietly mask drift.
   */
  tolerance?: { final_als?: number };
  /** Human note explaining the case intent. Required for hand-curated cases. */
  note?: string;
}
