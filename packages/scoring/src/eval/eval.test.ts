import { expect, test } from "bun:test";
import { extractLabelFromEngineOutput, mockJudgeFromLabel } from "./judge";
import { MAE_GATE, runEval } from "./run";
import { ADVERSARIAL_SCENARIOS, SCENARIO_COUNT } from "./scenarios";

test("scenarios corpus hits 50 (merge-gate minimum)", () => {
  expect(SCENARIO_COUNT).toBe(50);
  expect(ADVERSARIAL_SCENARIOS.length).toBe(50);
});

test("scenarios include at least 10 adversarial high-impact traps", () => {
  const traps = ADVERSARIAL_SCENARIOS.filter((s) => s.adversarial_high_impact);
  expect(traps.length).toBeGreaterThanOrEqual(10);
});

test("runEval: all-pass path (mocked judge always agrees)", async () => {
  const perfectPipeline = (s: (typeof ADVERSARIAL_SCENARIOS)[number]) =>
    Promise.resolve({
      insights: [
        s.expected_label === "high_confidence"
          ? { confidence: "high" }
          : s.expected_label === "investigate"
            ? { confidence: "medium" }
            : null,
      ].filter(Boolean),
    });
  const judge = mockJudgeFromLabel(extractLabelFromEngineOutput);
  const run = await runEval({
    scenarios: ADVERSARIAL_SCENARIOS.slice(0, 5),
    judge,
    invoke: perfectPipeline,
  });
  expect(run.total).toBe(5);
  expect(run.passed).toBe(5);
  expect(run.mae).toBe(0);
  expect(run.passed_gate).toBe(true);
});

test("runEval: all-fail path clears MAE_GATE sadness threshold", async () => {
  // Broken pipeline always returns empty (maps to 'drop'); half the scenarios
  // expect high_confidence or investigate → judge reports fail.
  const brokenPipeline = () => Promise.resolve({ insights: [] });
  const judge = mockJudgeFromLabel(extractLabelFromEngineOutput);
  const run = await runEval({
    scenarios: ADVERSARIAL_SCENARIOS.slice(0, 6), // 2 of each expected label
    judge,
    invoke: brokenPipeline,
  });
  expect(run.passed_gate).toBe(false);
  expect(run.mae).toBeGreaterThan(MAE_GATE);
});

test("MAE_GATE is 0.3 (= 0.7 score threshold per CLAUDE.md)", () => {
  expect(MAE_GATE).toBeCloseTo(0.3, 5);
});

test("runEval: ambiguous verdicts score 0.5", async () => {
  // Pipeline returns a primitive (non-object) → extractor returns "unknown"
  // → mock judge returns "ambiguous" for every scenario.
  const pipeline = () => Promise.resolve("not-an-object");
  const judge = mockJudgeFromLabel(extractLabelFromEngineOutput);
  const run = await runEval({
    scenarios: ADVERSARIAL_SCENARIOS.slice(0, 4),
    judge,
    invoke: pipeline,
  });
  expect(run.ambiguous).toBe(4);
  expect(run.mae).toBeCloseTo(0.5, 5);
});
