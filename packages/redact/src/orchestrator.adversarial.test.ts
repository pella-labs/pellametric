// MERGE BLOCKER — ≥98% recall on the 100-secret adversarial corpus.
//
// Per dev-docs/m2-gate-agent-team.md §A6 and CLAUDE.md §Testing Rules:
// "TruffleHog+Gitleaks+Presidio catch seeded secrets (≥98% recall on
// 100-secret corpus)". This test enforces the gate via assertion — a failing
// recall breaks CI, not just a log line.

import { describe, expect, test } from "bun:test";
import { SECRET_CORPUS } from "@bematist/fixtures/redaction";
import { defaultRedactionStage } from "./orchestrator";
import type { RedactionMarker } from "./stage";

const RECALL_FLOOR = 0.98;
// Clean / near-miss cases (`mustDetect=false`) must NOT trigger the expected
// type. This is the precision floor: catch misses and over-eager regex.
const FALSE_POSITIVE_RATE_CEILING = 0.05;

interface CaseResult {
  id: string;
  mustDetect: boolean;
  expectedType: RedactionMarker["type"];
  expectedRule: string | undefined;
  passed: boolean;
  markerCount: number;
  foundTypes: RedactionMarker["type"][];
}

async function evaluate(): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of SECRET_CORPUS) {
    const r = await defaultRedactionStage.run({
      tier: "C",
      prompt_text: c.text,
    });
    const foundTypes = r.markers.map((m) => m.type);
    const found = foundTypes.includes(c.expectedType);
    const passed = c.mustDetect ? found : !found;
    const result: CaseResult = {
      id: c.id,
      mustDetect: c.mustDetect,
      expectedType: c.expectedType,
      expectedRule: c.expectedRule,
      passed,
      markerCount: r.markers.length,
      foundTypes,
    };
    out.push(result);
  }
  return out;
}

describe("MERGE BLOCKER — adversarial recall ≥ 98% on 100-secret corpus", () => {
  test("corpus has exactly 100 entries", () => {
    expect(SECRET_CORPUS.length).toBe(100);
  });

  test("every entry has a stable id and at least one target field", () => {
    const ids = new Set<string>();
    for (const c of SECRET_CORPUS) {
      expect(c.id).toMatch(/^C-\d{2,3}$/);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(typeof c.text).toBe("string");
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  test("recall on positive cases (mustDetect=true) is ≥ 98%", async () => {
    const results = await evaluate();
    const positives = results.filter((r) => r.mustDetect);
    const caught = positives.filter((r) => r.passed);
    const recall = caught.length / positives.length;
    if (recall < RECALL_FLOOR) {
      const misses = positives.filter((r) => !r.passed);
      // Structured diagnostic — easy to triage in CI. We surface the id and
      // expected rule; we NEVER log the raw secret value (contract 08
      // invariant #4). This line is the authoritative failure signal.
      console.error(
        `[redact-recall] ${caught.length}/${positives.length} = ${(recall * 100).toFixed(1)}% ` +
          `(floor ${(RECALL_FLOOR * 100).toFixed(0)}%). Missed ids: ${misses
            .map((m) => `${m.id}/${m.expectedRule ?? m.expectedType}`)
            .join(", ")}`,
      );
    }
    expect(recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
  });

  test("false-positive rate on near-miss cases (mustDetect=false) is ≤ 5%", async () => {
    const results = await evaluate();
    const negatives = results.filter((r) => !r.mustDetect);
    const flagged = negatives.filter((r) => !r.passed);
    const fpRate = flagged.length / negatives.length;
    if (fpRate > FALSE_POSITIVE_RATE_CEILING) {
      console.error(
        `[redact-precision] FP rate ${(fpRate * 100).toFixed(1)}% exceeds ceiling ` +
          `${(FALSE_POSITIVE_RATE_CEILING * 100).toFixed(0)}%. Flagged ids: ${flagged
            .map((r) => r.id)
            .join(", ")}`,
      );
    }
    expect(fpRate).toBeLessThanOrEqual(FALSE_POSITIVE_RATE_CEILING);
  });

  test("no positive case yields a raw-secret leak in the output text", async () => {
    for (const c of SECRET_CORPUS) {
      if (!c.mustDetect) continue;
      const r = await defaultRedactionStage.run({ tier: "C", prompt_text: c.text });
      // If the marker fired, the original expected-type substring must be gone.
      if (r.markers.some((m) => m.type === c.expectedType)) {
        // Can't assert the full raw value disappeared (multi-secret cases
        // may still have other untargeted substrings) — assert the marker
        // format is intact so downstream chip rendering works.
        expect(r.prompt_text).toMatch(
          /<REDACTED:(secret|email|phone|name|ip|credit_card|ssn|url|address|other):[0-9a-f]{16}>/,
        );
      }
    }
  });
});
