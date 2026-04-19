/**
 * `github_author_association_v1` — D43 cohort stratifier.
 *
 * Pure enum → tier mapping. Per PRD-github-integration §12.3 and D43 this
 * value is NEVER rendered as a per-IC standalone label — it feeds the
 * cohort_key for step-2 normalization only.
 *
 *   SENIOR   = {OWNER, MEMBER}
 *   MID      = {COLLABORATOR}
 *   JUNIOR   = {CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR}
 *   EXTERNAL = {NONE | unknown | missing}
 *
 * Unknown / missing values map to EXTERNAL — the safest cohort assignment.
 * Misattributing a drive-by contributor as SENIOR would flatter their scores
 * against a senior cohort and is explicitly unsafe.
 */

export type AuthorAssociation =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIME_CONTRIBUTOR"
  | "NONE";

export type AuthorAssociationTier = "SENIOR" | "MID" | "JUNIOR" | "EXTERNAL";

export function authorAssociationTier(
  value: AuthorAssociation | string | null | undefined,
): AuthorAssociationTier {
  switch (value) {
    case "OWNER":
    case "MEMBER":
      return "SENIOR";
    case "COLLABORATOR":
      return "MID";
    case "CONTRIBUTOR":
    case "FIRST_TIME_CONTRIBUTOR":
      return "JUNIOR";
    case "NONE":
      return "EXTERNAL";
    default:
      return "EXTERNAL";
  }
}
