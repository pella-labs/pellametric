// MERGE BLOCKER (D27, CLAUDE.md §Testing Rules):
// the Clio verifier MUST achieve ≥95% recall on the seeded identifying-abstract
// corpus. Regression here fails CI — do not relax this gate.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtinVerifier } from "./verify";

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

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/clio/identifying");
const identifying = loadJsonl(resolve(fixtureRoot, "abstracts.jsonl"));
const benign = loadJsonl(resolve(fixtureRoot, "benign.jsonl"));

describe("clio verifier — adversarial recall (MERGE BLOCKER)", () => {
  test("≥50 identifying cases shipped (corpus floor per brief)", () => {
    expect(identifying.length).toBeGreaterThanOrEqual(50);
  });

  test("verifier achieves ≥95% recall on identifying corpus", async () => {
    let correctlyDropped = 0;
    const missed: string[] = [];
    for (const row of identifying) {
      const r = await builtinVerifier.verify({ abstract: row.text });
      if (r.decision === "DROP") {
        correctlyDropped++;
      } else {
        missed.push(`${row.id} (${row.category}): ${row.text}`);
      }
    }
    const recall = correctlyDropped / identifying.length;
    if (recall < 0.95) {
      throw new Error(
        `verifier recall ${(recall * 100).toFixed(1)}% < 95% (MERGE BLOCKER). Missed:\n${missed.join("\n")}`,
      );
    }
    expect(recall).toBeGreaterThanOrEqual(0.95);
  });

  test("benign abstracts kept (precision sanity check, not a hard gate)", async () => {
    let correctlyKept = 0;
    const wronglyDropped: string[] = [];
    for (const row of benign) {
      const r = await builtinVerifier.verify({ abstract: row.text });
      if (r.decision === "KEEP") {
        correctlyKept++;
      } else {
        wronglyDropped.push(`${row.id}: ${r.reasons.join(",")} — ${row.text}`);
      }
    }
    // Soft floor — verifier is allowed to be conservative; we surface the
    // wrongly-dropped list in the assertion message for diagnostics.
    const precision = correctlyKept / benign.length;
    expect(precision).toBeGreaterThanOrEqual(0.7);
    if (wronglyDropped.length > 0) {
      console.warn(
        `[verify.recall] wrongly dropped benign abstracts:\n${wronglyDropped.join("\n")}`,
      );
    }
  });

  test("every identifying category is represented", () => {
    const categories = new Set(identifying.map((r) => r.category));
    // The brief calls out PII, secrets, proper nouns, filesystem paths.
    const requiredFamilies = ["email", "secret_key", "proper_noun_company", "home_path"];
    for (const fam of requiredFamilies) {
      const found = [...categories].some((c) => c === fam || c.startsWith(fam));
      expect(found).toBe(true);
    }
  });
});
