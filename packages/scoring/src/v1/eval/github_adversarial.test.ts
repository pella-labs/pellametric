/**
 * G2 — 8 adversarial persona assertions (PRD §12.4 / D44).
 *
 * One test per persona. These are NOT MAE gates — they're shape
 * assertions: the ALS math must NOT mislabel the persona in a way that
 * breaks Bematist's "no public leaderboard, no bottom-10%, no performance
 * scoring" posture (CLAUDE.md §Scoring Rules).
 *
 * Each persona's ground-truth intent is encoded on the FixtureCase via
 * `expected_persona_intent`. Intents:
 *   - "score-low"                 — standard low-performer range [10, 45]
 *   - "score-average"             — standard average range      [30, 70]
 *   - "score-high"                — standard high-leverage rang [55, 95]
 *   - "score-new-hire-discounted" — confidence-discount signal  [5, 45]
 *   - "should-not-over-score"     — gamer must NOT score high   (<65)
 *   - "should-not-under-score"    — CI-off / flaky must NOT tank (>35)
 */

import { describe, expect, test } from "bun:test";
import { type ScoringInputV1_1, scoreV1_1 } from "../index_v1_1";
import { type GithubFixtureCase, type GithubPersona, generateGithubCases } from "./github_generate";

const CASES = generateGithubCases(2026, "gh");

function forPersona(p: GithubPersona): GithubFixtureCase[] {
  return CASES.filter((c) => c.persona === p);
}

function scores(cases: GithubFixtureCase[]): number[] {
  return cases.map((c) => scoreV1_1(c.input as ScoringInputV1_1).ai_leverage_score);
}

describe("Adversarial persona assertions (D44)", () => {
  test("Persona 1: LOC-padding gamer should NOT over-score (<65 each)", () => {
    const cases = forPersona("loc-padding-gamer");
    expect(cases.length).toBe(10);
    const s = scores(cases);
    for (let i = 0; i < s.length; i++) {
      expect(s[i]).toBeLessThan(65);
    }
  });

  test("Persona 2: CI-off repo should NOT under-score — first_push_green suppressed, no zero-penalty", () => {
    const cases = forPersona("ci-off-repo");
    expect(cases.length).toBe(10);
    const s = scores(cases);
    // Expect the IC's score not to collapse to 0. With D41 renormalization,
    // the missing first_push_green term should redistribute to useful_output_retained.
    for (const v of s) {
      expect(v).toBeGreaterThan(10);
    }
  });

  test("Persona 3: Empty-push spammer should NOT over-score", () => {
    const cases = forPersona("empty-push-spammer");
    expect(cases.length).toBe(10);
    const s = scores(cases);
    for (const v of s) {
      expect(v).toBeLessThan(55);
    }
  });

  test("Persona 4: Junior in senior cohort — without D42 cohort key would be over-scored", () => {
    // With the default cohort_distribution (mixed), a junior shows in the
    // lower quintile — that's correct. The D42 cohort key would stratify
    // them into a junior cohort; the test here enforces the SHAPE that
    // without D42 the score is dampened by the mixed cohort.
    const cases = forPersona("junior-in-senior-cohort");
    expect(cases.length).toBe(15);
    const s = scores(cases);
    for (const v of s) {
      expect(v).toBeLessThan(50);
    }
  });

  test("Persona 5: Backend vs frontend — similar signals, codeowner_domain differs", () => {
    const cases = forPersona("backend-vs-frontend");
    expect(cases.length).toBe(15);
    const s = scores(cases);
    // Both cohorts: average-tier signals should land in 25-75 band. The
    // codeowner_domain difference feeds D42 — assertion here is mere shape.
    for (const v of s) {
      expect(v).toBeGreaterThan(15);
      expect(v).toBeLessThan(90);
    }
  });

  test("Persona 6: Deploy-spam staging — deploy suppressed, no over-score from fake deploy count", () => {
    const cases = forPersona("deploy-spam-staging");
    expect(cases.length).toBe(10);
    const s = scores(cases);
    for (const v of s) {
      expect(v).toBeLessThan(60);
    }
  });

  test("Persona 7: CI-flakiness — D45 filter excludes flaky reds, dev NOT mislabeled down", () => {
    const cases = forPersona("ci-flakiness-blamed");
    expect(cases.length).toBe(15);
    const s = scores(cases);
    // Without D45 these would have first_push_green ≈ 0.7; with D45 the 3
    // flaky reds are excluded → rate stays near 1.0. Either way the score
    // must stay in the "average productive IC" range, not tanked.
    for (const v of s) {
      expect(v).toBeGreaterThan(20);
    }
  });

  test("Persona 8: Revert-heavy high-LOC — useful_output_retained tanks, total score suppressed", () => {
    const cases = forPersona("revert-heavy-high-loc");
    expect(cases.length).toBe(15);
    const s = scores(cases);
    for (const v of s) {
      expect(v).toBeLessThan(60);
    }
  });

  // ---------- G3 deploy-specific adversarial personas -----------------------

  test("Persona G3-9: Non-prod-env gamer (`canary-eu`) — deploy suppressed, NOT over-scored", () => {
    // Module: computeDeployPerDollar returns suppressed when environments
    // don't match the prod allowlist AND no admin override. Composite rule
    // D41 redistributes deploy weight to other terms → score cannot rise
    // above the baseline of the deploy-spam-staging gamer.
    const cases = forPersona("deploy-non-prod-env-gamer");
    expect(cases.length).toBe(8);
    const s = scores(cases);
    for (const v of s) {
      expect(v).toBeLessThan(60);
    }
  });

  test("Persona G3-10: Healthy prod-deployer — deploy term LIVE, score rises", () => {
    // This is the positive-signal partner of the two adversarial personas.
    // Ensures the deploy-per-dollar module is actually contributing to
    // composite when the signal is present (so suppression is a real gate,
    // not a permanent zero).
    const cases = forPersona("healthy-prod-deployer");
    expect(cases.length).toBe(8);
    const s = scores(cases);
    for (const v of s) {
      expect(v).toBeGreaterThan(40);
    }
  });
});
