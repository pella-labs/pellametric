/**
 * One-shot script — serializes archetype + generated cases to JSONL.
 *
 * Run with:  bun run packages/scoring/src/v1/eval/write-fixtures.ts
 *
 * Writes three files under `__fixtures__/` (per CLAUDE.md §Scoring Rules —
 * "500-case synthetic dev-month eval … held-out 100-case validation split"):
 *   - archetypes.jsonl      —  10 hand-curated cases
 *   - snapshots.jsonl       — 490 auto-generated cases (seed=42, train mix)
 *                             Together with archetypes.jsonl this forms the
 *                             500-case train split.
 *   - validation.jsonl      — 100 auto-generated cases, held-out split.
 *                             Uses a different seed (1337) AND different
 *                             archetype weights so the sampled distribution
 *                             is meaningfully distinct from train — catches
 *                             archetype-frequency-sensitive regressions.
 *
 * Parameter sweep per CLAUDE.md — snapshots are drawn from the full joint
 * distribution of (archetype × token range × outcome count × maturity stage
 * × retention pattern) via the calibrated samplers in `generate.ts`.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHETYPE_CASES } from "./archetypes";
import { generateCases } from "./generate";
import { generateGithubCases } from "./github_generate";
import type { FixtureCase } from "./schema";

const FIXTURE_DIR = join(import.meta.dir, "..", "__fixtures__");

function writeJsonl(path: string, cases: FixtureCase[]): void {
  const content = cases.map((c) => JSON.stringify(c)).join("\n") + (cases.length > 0 ? "\n" : "");
  writeFileSync(path, content, "utf8");
}

// Train split — total 500 (10 hand-curated + 490 generated).
// Default archetype mix (15/50/20/10/5) approximates a typical mid-sized org.
writeJsonl(join(FIXTURE_DIR, "archetypes.jsonl"), ARCHETYPE_CASES);
writeJsonl(
  join(FIXTURE_DIR, "snapshots.jsonl"),
  generateCases(42, 490, {
    idPrefix: "gen",
    note: "Auto-generated snapshot (seed=42, train mix).",
  }),
);

// Held-out validation split — 100 cases, different seed AND different
// archetype weights. A stratified-heavy mix (more low-performer +
// goodhart-gaming, fewer average) stresses the lower and upper tails of the
// scoring function and catches regressions that aggregate-green fixtures hide.
writeJsonl(
  join(FIXTURE_DIR, "validation.jsonl"),
  generateCases(1337, 100, {
    idPrefix: "val",
    note: "Held-out validation case (seed=1337, tail-heavy mix).",
    shares: {
      "low-performer": 0.25,
      average: 0.3,
      "high-leverage": 0.2,
      "new-hire": 0.1,
      "goodhart-gaming": 0.15,
    },
  }),
);

// G2 — GitHub fixture expansion (PRD-github-integration §12.4 / D44).
// 150 cases (100 adversarial + 50 normal) for the 650-case main run, plus
// 50 held-out GitHub cases for the 150-case held-out run.
writeJsonl(join(FIXTURE_DIR, "github.jsonl"), generateGithubCases(2026, "gh"));
// Held-out GitHub split — 50 cases with normal counts shifted.
writeJsonl(
  join(FIXTURE_DIR, "github_validation.jsonl"),
  generateGithubCases(20260419, "ghval", {
    "normal-low": 5,
    "normal-avg": 7,
    "normal-high": 3,
    "normal-new-hire": 2,
    "loc-padding-gamer": 3,
    "ci-off-repo": 3,
    "empty-push-spammer": 3,
    "junior-in-senior-cohort": 5,
    "backend-vs-frontend": 5,
    "deploy-spam-staging": 3,
    "ci-flakiness-blamed": 5,
    "revert-heavy-high-loc": 6,
    // G3 — include both new personas in held-out, small counts.
    "deploy-non-prod-env-gamer": 0,
    "healthy-prod-deployer": 0,
  }),
);
