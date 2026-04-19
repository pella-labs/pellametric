/**
 * G2 — v1 regression test (CLAUDE.md §Scoring Rules, D13/D21).
 *
 * v1 math is LOCKED. Dashboards pinned to `v1` must continue to read the
 * exact same numbers after G2 lands. This test pulls a handful of cases
 * from the v1 archetypes fixture and asserts `score()` (v1) returns the
 * snapshotted value within the per-case tolerance.
 *
 * The main runner (`eval/runner.ts`) already enforces MAE ≤ 3 on the full
 * 500-case v1 regression — this test is a fast-path smoke that runs in
 * the default `bun test` path (not `test:scoring`) so local TDD catches
 * accidental v1 drift without waiting for the full eval.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureCase } from "./eval/schema";
import { score } from "./index";

const FIXTURE_PATH = join(import.meta.dir, "__fixtures__", "archetypes.jsonl");

function loadJsonl(path: string): FixtureCase[] {
  const raw = readFileSync(path, "utf8").trim();
  if (raw.length === 0) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as FixtureCase);
}

describe("v1 regression (D13 LOCKED)", () => {
  const cases = loadJsonl(FIXTURE_PATH);

  test(`archetype fixture loaded (≥ 10 cases)`, () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  test("every archetype case reads within tolerance of its snapshot", () => {
    for (const c of cases) {
      const out = score(c.input);
      const err = Math.abs(out.ai_leverage_score - c.expected_final_als);
      const tol = c.tolerance?.final_als ?? 3;
      expect(err).toBeLessThanOrEqual(tol);
    }
  });

  test("v1 `metric_version` reads back exactly 'ai_leverage_v1'", () => {
    const first = cases[0];
    if (first === undefined) throw new Error("no fixture cases");
    const out = score(first.input);
    expect(out.metric_version).toBe("ai_leverage_v1");
  });
});
