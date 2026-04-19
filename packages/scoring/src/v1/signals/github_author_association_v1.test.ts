/**
 * G2 — `github_author_association_v1` (D43 cohort stratifier) RED-first.
 *
 * Pure enum → tier mapping. D43 says this is NEVER rendered as a per-IC
 * standalone label. It feeds the cohort key only.
 */

import { describe, expect, test } from "bun:test";
import {
  type AuthorAssociation,
  type AuthorAssociationTier,
  authorAssociationTier,
} from "./github_author_association_v1";

describe("github_author_association_v1", () => {
  test.each<[AuthorAssociation, AuthorAssociationTier]>([
    ["OWNER", "SENIOR"],
    ["MEMBER", "SENIOR"],
    ["COLLABORATOR", "MID"],
    ["CONTRIBUTOR", "JUNIOR"],
    ["FIRST_TIME_CONTRIBUTOR", "JUNIOR"],
    ["NONE", "EXTERNAL"],
  ])("%s → %s", (input, expected) => {
    expect(authorAssociationTier(input)).toBe(expected);
  });

  test("unknown / missing → EXTERNAL (safest cohort, never misattributes senior)", () => {
    expect(authorAssociationTier(undefined)).toBe("EXTERNAL");
    expect(authorAssociationTier(null)).toBe("EXTERNAL");
    expect(authorAssociationTier("MANNEQUIN" as AuthorAssociation)).toBe("EXTERNAL");
  });
});
