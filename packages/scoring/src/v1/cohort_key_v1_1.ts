/**
 * `cohort_key_v1.1` — D42 cohort stratification.
 *
 *   cohort_key = (task_category, author_association_tier, codeowner_domain, org_tenure_bucket)
 *
 * Step 2 of `ai_leverage_v1` percentile-ranks within a cohort. v1 uses
 * `task_category` alone — a fine start but obscures backend-vs-frontend,
 * senior-vs-junior, and new-hire-vs-tenured sub-populations. v1.1 adds
 * three axes:
 *   - `author_association_tier` (SENIOR/MID/JUNIOR/EXTERNAL) — D43.
 *   - `codeowner_domain` (top-level CODEOWNERS segment) — `github_codeowners_v1`.
 *   - `org_tenure_bucket` (<=30d / 31-180d / 181-730d / >730d).
 *
 * Fallback ladder — when the specific cohort drops below k=5 peers, drop
 * the most-granular dim and retry:
 *   1. Drop `org_tenure_bucket`.
 *   2. If still <5, drop `codeowner_domain`.
 *   3. If still <5, drop `author_association_tier` → `task_category` only.
 *   4. If STILL <5, return the task-only key and mark `below_k_floor=true`;
 *      display gates will suppress the tile per k-anonymity rules.
 *
 * Every fallback step is surfaced to the caller via `onFallback(reason)`
 * so the caller can persist an `audit_log` row (contract 09).
 *
 * Pure — deterministic for identical `cohortSizeAt` answers.
 */

export type AuthorAssociationTier = "SENIOR" | "MID" | "JUNIOR" | "EXTERNAL";
export type OrgTenureBucket = "<=30d" | "31-180d" | "181-730d" | ">730d";

export interface CohortContext {
  task_category: string;
  author_association_tier: AuthorAssociationTier;
  codeowner_domain: string;
  org_tenure_bucket: OrgTenureBucket;
}

export function orgTenureBucket(daysSinceFirstCommit: number): OrgTenureBucket {
  if (daysSinceFirstCommit <= 30) return "<=30d";
  if (daysSinceFirstCommit <= 180) return "31-180d";
  if (daysSinceFirstCommit <= 730) return "181-730d";
  return ">730d";
}

export function buildCohortKey(ctx: CohortContext): string {
  return [
    ctx.task_category,
    ctx.author_association_tier,
    ctx.codeowner_domain,
    ctx.org_tenure_bucket,
  ].join("|");
}

export type FallbackReason =
  | "dropped_org_tenure_bucket"
  | "dropped_codeowner_domain"
  | "dropped_author_association_tier";

export interface ResolveOptions {
  /** Returns the count of peers in the cohort identified by `key`. */
  cohortSizeAt: (key: string) => number;
  /** k-anonymity floor — default 5 per PRD §Privacy Model. */
  minCohort: number;
  /** Audit-log sink called for each fallback level taken. */
  onFallback?: (reason: FallbackReason) => void;
}

export interface ResolvedCohort {
  key: string;
  fallback_level: 0 | 1 | 2 | 3;
  below_k_floor: boolean;
}

/**
 * Walk the fallback ladder. Each step drops the most-granular remaining
 * dim. Returns the FIRST key that satisfies `cohortSize >= minCohort`, or
 * the task-only key with `below_k_floor=true` if even that fails.
 */
export function resolveCohortWithFallback(
  ctx: CohortContext,
  opts: ResolveOptions,
): ResolvedCohort {
  const ladder: { key: string; level: 0 | 1 | 2 | 3; reason?: FallbackReason }[] = [
    { key: buildCohortKey(ctx), level: 0 },
    {
      key: [ctx.task_category, ctx.author_association_tier, ctx.codeowner_domain].join("|"),
      level: 1,
      reason: "dropped_org_tenure_bucket",
    },
    {
      key: [ctx.task_category, ctx.author_association_tier].join("|"),
      level: 2,
      reason: "dropped_codeowner_domain",
    },
    { key: ctx.task_category, level: 3, reason: "dropped_author_association_tier" },
  ];

  for (let i = 0; i < ladder.length; i++) {
    const step = ladder[i];
    if (step === undefined) continue;
    if (i > 0 && step.reason !== undefined) {
      opts.onFallback?.(step.reason);
    }
    const size = opts.cohortSizeAt(step.key);
    if (size >= opts.minCohort) {
      return { key: step.key, fallback_level: step.level, below_k_floor: false };
    }
  }

  // All four levels failed → return task-only with floor flag.
  return {
    key: ctx.task_category,
    fallback_level: 3,
    below_k_floor: true,
  };
}
