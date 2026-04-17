/**
 * Eval gate thresholds — central definitions.
 *
 * Changing any of these is a deliberate act — bump metric version per D13
 * (e.g. to `ai_leverage_v2`) if the change reflects a math redefinition,
 * or amend the PRD if the threshold itself loosens/tightens. Do NOT silently
 * relax.
 *
 * Headline gates from CLAUDE.md §"Testing Rules" (line 91):
 *   MAE ≤ 3 · no outlier > 10 · runs in < 30s
 *
 * Per-archetype MAE is a follow-on convention (not in PRD yet) — protects
 * against aggregate-green, archetype-regressed failure modes (Goodhart gate).
 */

export const GATES = {
  /** Mean-absolute-error on `final_als` across the full fixture. */
  MAE_MAX: 3,
  /** L∞ norm — worst per-case |predicted − expected|. */
  MAX_ERROR_MAX: 10,
  /** Per-archetype MAE ceiling — looser than aggregate, catches regressions. */
  PER_ARCHETYPE_MAE_MAX: 4,
  /** Test budget in seconds. */
  RUNTIME_MAX_SEC: 30,
} as const;
