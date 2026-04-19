/**
 * G2 — `github_codeowners_v1` contract test (RED first).
 *
 * Cohort stratifier module. Given a parsed CODEOWNERS ruleset (already stored
 * in `github_code_owners.rules` jsonb) and a session's set of touched paths,
 * returns the non-exclusive SET of matching owner-teams and the `codeowner_domain`
 * (top-level path of the IC's primary match) for cohort_key stratification.
 *
 * D47 contribution-earned override is scaffolded — the interface accepts a
 * commit-weights input, but the implementation under G2 uses static rules
 * only (G3 wires the real contribution resolver). The interface MUST stay
 * stable across G2→G3.
 */

import { describe, expect, test } from "bun:test";
import { type CodeownersInput, type ParsedRule, resolveCodeowners } from "./github_codeowners_v1";

const rules: ParsedRule[] = [
  { pattern: "/frontend/**", owners: ["team:frontend"] },
  { pattern: "/backend/**", owners: ["team:backend", "team:platform"] },
  { pattern: "/infra/**", owners: ["team:infra"] },
  { pattern: "/ml/**", owners: ["team:ml"] },
  { pattern: "*", owners: ["team:default"] },
];

function input(overrides: Partial<CodeownersInput> = {}): CodeownersInput {
  return {
    touched_paths: ["frontend/app/page.tsx"],
    rules,
    ic_commit_share_by_path: {},
    ...overrides,
  };
}

describe("github_codeowners_v1", () => {
  test("single matching team — primary domain is top-level segment", () => {
    const result = resolveCodeowners(input({ touched_paths: ["frontend/app/page.tsx"] }));
    expect(result.owner_teams).toEqual(new Set(["team:frontend"]));
    expect(result.codeowner_domain).toBe("frontend");
  });

  test("multi-team owner — returns full set", () => {
    const result = resolveCodeowners(input({ touched_paths: ["backend/api/users.ts"] }));
    expect(result.owner_teams).toEqual(new Set(["team:backend", "team:platform"]));
    expect(result.codeowner_domain).toBe("backend");
  });

  test("multi-path session touches multiple domains → union of teams", () => {
    const result = resolveCodeowners(
      input({
        touched_paths: ["frontend/app/page.tsx", "backend/api/users.ts"],
      }),
    );
    expect(result.owner_teams).toEqual(new Set(["team:frontend", "team:backend", "team:platform"]));
    // Domain is the top-level of the first most-specific match.
    expect(result.codeowner_domain).toMatch(/^(frontend|backend)$/);
  });

  test("no owner match → generalist domain", () => {
    const result = resolveCodeowners(
      input({
        touched_paths: ["README.md"],
        rules: rules.filter((r) => r.pattern !== "*"),
      }),
    );
    expect(result.codeowner_domain).toBe("generalist");
    expect(result.owner_teams.size).toBe(0);
  });

  test("D47 contribution-earned override (interface accepted, G2 uses static only)", () => {
    // High commit share on an infra path does NOT yet elevate the IC to owner
    // in G2 — the resolver just notes contribution_earned_override_pending.
    const result = resolveCodeowners(
      input({
        touched_paths: ["infra/terraform/main.tf"],
        ic_commit_share_by_path: { "infra/terraform/main.tf": 0.45 },
      }),
    );
    // Static owner: team:infra.
    expect(result.owner_teams).toEqual(new Set(["team:infra"]));
    // But the contribution override is flagged for G3.
    expect(result.contribution_earned_override_pending).toBe(true);
  });

  test("deterministic + pure", () => {
    const i = input();
    expect(resolveCodeowners(i)).toEqual(resolveCodeowners(i));
  });

  // ----- G3 D47 live override ----------------------------------------------

  test("G3 D47: IC with 35% share on `frontend/*` AND no static match → codeowner_domain=frontend", () => {
    // Scenario: repo has NO CODEOWNERS entries (rules list empty). IC has
    // 35% share on the frontend tree via git_events. Per D47, IC is owner
    // of frontend/* regardless of static file.
    const result = resolveCodeowners({
      touched_paths: ["frontend/app/page.tsx", "frontend/components/btn.tsx"],
      rules: [],
      ic_commit_share_by_path: { "frontend/app": 0.35 },
    });
    expect(result.codeowner_domain).toBe("frontend");
    expect(result.contribution_earned_override_pending).toBe(true);
    expect(result.contribution_earned_paths).toEqual(["frontend/app"]);
  });

  test("G3 D47: IC with 29% share → NOT an owner (below 30% threshold)", () => {
    const result = resolveCodeowners({
      touched_paths: ["frontend/app/page.tsx"],
      rules: [],
      ic_commit_share_by_path: { "frontend/app": 0.29 },
    });
    expect(result.codeowner_domain).toBe("generalist");
    expect(result.contribution_earned_override_pending).toBe(false);
    expect(result.contribution_earned_paths).toEqual([]);
  });

  test("G3 D47: static match wins for codeowner_domain; override paths carried alongside", () => {
    // Static file says frontend belongs to team:frontend. IC also has 45% on
    // backend/* (without static match). Domain keeps frontend; paths list
    // includes backend.
    const result = resolveCodeowners({
      touched_paths: ["frontend/app/page.tsx"],
      rules: [{ pattern: "/frontend/**", owners: ["team:frontend"] }],
      ic_commit_share_by_path: { "backend/api": 0.45 },
    });
    expect(result.codeowner_domain).toBe("frontend");
    expect(result.contribution_earned_paths).toEqual(["backend/api"]);
    expect(result.owner_teams).toEqual(new Set(["team:frontend"]));
  });

  test("G3 D47: most-specific earned path preferred for domain inference", () => {
    const result = resolveCodeowners({
      touched_paths: ["backend/api/users.ts"],
      rules: [],
      ic_commit_share_by_path: {
        backend: 0.35,
        "backend/api": 0.55,
      },
    });
    // Both paths earned — domain inference picks the longest.
    // topLevelSegment("backend/api") === "backend" so domain is still
    // "backend" but `contribution_earned_paths` carries both (sorted).
    expect(result.codeowner_domain).toBe("backend");
    expect(result.contribution_earned_paths).toEqual(["backend", "backend/api"]);
  });
});
