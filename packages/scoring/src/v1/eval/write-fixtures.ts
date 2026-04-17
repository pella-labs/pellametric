/**
 * One-shot script — serializes archetype + generated cases to JSONL.
 *
 * Run with:  bun run packages/scoring/src/v1/eval/write-fixtures.ts
 *
 * Writes three files under `__fixtures__/`:
 *   - archetypes.jsonl      — 10 hand-curated cases
 *   - snapshots.jsonl       — 40 auto-generated cases (seed=42)
 *   - validation.jsonl      — 10 held-out cases (seed=1337)
 *
 * Count targets per Sprint-2 plan are 50/450/100; we ship at 10/40/10 in the
 * 2-hour MVP budget and expand in the follow-up PR. Schema is identical;
 * scaling up is purely a matter of increasing the counts.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHETYPE_CASES } from "./archetypes";
import { generateCases } from "./generate";
import type { FixtureCase } from "./schema";

const FIXTURE_DIR = join(import.meta.dir, "..", "__fixtures__");

function writeJsonl(path: string, cases: FixtureCase[]): void {
  const content = cases.map((c) => JSON.stringify(c)).join("\n") + (cases.length > 0 ? "\n" : "");
  writeFileSync(path, content, "utf8");
  console.log(`wrote ${cases.length} cases → ${path}`);
}

writeJsonl(join(FIXTURE_DIR, "archetypes.jsonl"), ARCHETYPE_CASES);
writeJsonl(join(FIXTURE_DIR, "snapshots.jsonl"), generateCases(42, 40));
writeJsonl(join(FIXTURE_DIR, "validation.jsonl"), generateCases(1337, 10));

console.log("done.");
