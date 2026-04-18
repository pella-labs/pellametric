// Gate 2 / 5 — Clio verifier recall ≥ 95% on 50-prompt identifying corpus.
//
// MERGE BLOCKER per CLAUDE.md §Testing Rules / D27 and
// dev-docs/m2-gate-agent-team.md §A16.
//
// Re-runs the same builtinVerifier the on-device pipeline calls (`@bematist/clio`)
// over the authoritative `packages/fixtures/clio/identifying/` corpus. The
// verifier MUST drop ≥ 95% of identifying abstracts.
//
// We do NOT modify the verifier rules — relax a rule in
// packages/clio/src/verify.ts and this gate fails.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtinVerifier } from "@bematist/clio";

const RECALL_FLOOR = 0.95;
const BENIGN_PRECISION_FLOOR = 0.7; // soft floor — verifier may be conservative

interface FixtureRow {
  id: string;
  label: "identifying" | "benign";
  category: string;
  text: string;
}

function loadJsonl(path: string): FixtureRow[] {
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as FixtureRow);
}

const fixtureRoot = resolve(import.meta.dir, "../../../packages/fixtures/clio/identifying");
const identifying = loadJsonl(resolve(fixtureRoot, "abstracts.jsonl"));
const benign = loadJsonl(resolve(fixtureRoot, "benign.jsonl"));

describe("PRIVACY GATE 2/5 — Clio verifier recall ≥ 95%", () => {
  test("identifying corpus has ≥ 50 entries (drift guard)", () => {
    expect(identifying.length).toBeGreaterThanOrEqual(50);
  });

  test("verifier recall on identifying corpus ≥ 95% (MERGE BLOCKER)", async () => {
    let dropped = 0;
    const missed: string[] = [];
    for (const row of identifying) {
      const r = await builtinVerifier.verify({ abstract: row.text });
      if (r.decision === "DROP") {
        dropped++;
      } else {
        missed.push(`${row.id}/${row.category}`);
      }
    }
    const recall = dropped / identifying.length;
    if (recall < RECALL_FLOOR) {
      // Identifying-content text is by definition sensitive in the abstract;
      // we name only the corpus id + category, never the row text.
      console.error(
        `[privacy-gate-2] verifier recall ${(recall * 100).toFixed(1)}% < ` +
          `${(RECALL_FLOOR * 100).toFixed(0)}%. Missed: ${missed.join(", ")}`,
      );
    }
    expect(recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
  });

  test("benign abstracts kept (precision sanity ≥ 70%)", async () => {
    let kept = 0;
    for (const row of benign) {
      const r = await builtinVerifier.verify({ abstract: row.text });
      if (r.decision === "KEEP") kept++;
    }
    const precision = kept / benign.length;
    expect(precision).toBeGreaterThanOrEqual(BENIGN_PRECISION_FLOOR);
  });

  test("required identifying categories are represented", () => {
    const categories = new Set(identifying.map((r) => r.category));
    for (const fam of ["email", "secret_key", "proper_noun_company", "home_path"]) {
      const found = [...categories].some((c) => c === fam || c.startsWith(fam));
      expect(found).toBe(true);
    }
  });
});
