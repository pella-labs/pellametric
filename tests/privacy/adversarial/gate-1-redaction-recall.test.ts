// Gate 1 / 5 — server-side redaction recall ≥ 98% on the 100-secret corpus.
//
// MERGE BLOCKER per CLAUDE.md §Testing Rules and dev-docs/m2-gate-agent-team.md §A16.
//
// This file does NOT redefine the gate; it re-runs the same orchestrator the
// ingest hot path uses (`@bematist/redact` defaultRedactionStage) over the
// authoritative 100-entry corpus shipped from `packages/fixtures/redaction/`.
// Comment out a rule in packages/redact/src/engines/* — the recall assertion
// drops below 0.98 and `bun run test:privacy` exits 1.
//
// We also ship a structured failure-summary so CI logs name the missed corpus
// ids without echoing the raw secret text (contract 08 invariant #4).

import { describe, expect, test } from "bun:test";
import { SECRET_CORPUS } from "@bematist/fixtures/redaction";
import { defaultRedactionStage } from "@bematist/redact";

const RECALL_FLOOR = 0.98;
const FALSE_POSITIVE_CEILING = 0.05;
const REDACTED_MARKER =
  /<REDACTED:(secret|email|phone|name|ip|credit_card|ssn|url|address|other):[0-9a-f]{16}>/;

interface CaseOutcome {
  id: string;
  expectedType: string;
  expectedRule: string | undefined;
  mustDetect: boolean;
  detected: boolean;
  passed: boolean;
}

async function evaluateCorpus(): Promise<CaseOutcome[]> {
  const out: CaseOutcome[] = [];
  for (const c of SECRET_CORPUS) {
    const r = await defaultRedactionStage.run({ tier: "C", prompt_text: c.text });
    const detected = r.markers.some((m) => m.type === c.expectedType);
    out.push({
      id: c.id,
      expectedType: c.expectedType,
      expectedRule: c.expectedRule,
      mustDetect: c.mustDetect,
      detected,
      passed: c.mustDetect ? detected : !detected,
    });
  }
  return out;
}

describe("PRIVACY GATE 1/5 — redaction recall ≥ 98% on 100-secret corpus", () => {
  test("corpus has exactly 100 entries (drift guard)", () => {
    expect(SECRET_CORPUS.length).toBe(100);
  });

  test("recall on positive cases ≥ 98% (MERGE BLOCKER)", async () => {
    const results = await evaluateCorpus();
    const positives = results.filter((r) => r.mustDetect);
    expect(positives.length).toBeGreaterThan(0);
    const caught = positives.filter((r) => r.passed);
    const recall = caught.length / positives.length;
    if (recall < RECALL_FLOOR) {
      const misses = positives
        .filter((r) => !r.passed)
        .map((m) => `${m.id}/${m.expectedRule ?? m.expectedType}`)
        .join(", ");
      // Authoritative failure signal — never log raw secret text.
      console.error(
        `[privacy-gate-1] recall ${(recall * 100).toFixed(1)}% < floor ${(RECALL_FLOOR * 100).toFixed(0)}%. ` +
          `Missed ids: ${misses}`,
      );
    }
    expect(recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
  });

  test("false-positive rate on near-miss cases ≤ 5%", async () => {
    const results = await evaluateCorpus();
    const negatives = results.filter((r) => !r.mustDetect);
    expect(negatives.length).toBeGreaterThan(0);
    const flagged = negatives.filter((r) => !r.passed);
    const fpRate = flagged.length / negatives.length;
    if (fpRate > FALSE_POSITIVE_CEILING) {
      console.error(
        `[privacy-gate-1] FP rate ${(fpRate * 100).toFixed(1)}% > ceiling ` +
          `${(FALSE_POSITIVE_CEILING * 100).toFixed(0)}%. Flagged ids: ` +
          flagged.map((f) => f.id).join(", "),
      );
    }
    expect(fpRate).toBeLessThanOrEqual(FALSE_POSITIVE_CEILING);
  });

  test("redacted output uses the canonical <REDACTED:type:hash> chip format", async () => {
    // The chip renderer in apps/web/ keys off this exact regex; if it ever
    // changes, both privacy and the dashboard regress at the same time.
    let sampled = 0;
    for (const c of SECRET_CORPUS) {
      if (!c.mustDetect) continue;
      const r = await defaultRedactionStage.run({ tier: "C", prompt_text: c.text });
      if (r.markers.some((m) => m.type === c.expectedType)) {
        expect(r.prompt_text).toMatch(REDACTED_MARKER);
        sampled++;
      }
    }
    expect(sampled).toBeGreaterThan(0);
  });
});
