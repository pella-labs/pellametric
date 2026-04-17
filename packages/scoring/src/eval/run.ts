import { ADVERSARIAL_SCENARIOS } from "./scenarios";
import type { AdversarialScenario, EvalResult, EvalRun, JudgeClient } from "./types";

/** Merge-gate threshold per CLAUDE.md: MAE ≤ 0.3 (equivalent to score ≥ 0.7). */
export const MAE_GATE = 0.3;

export type PipelineInvoker = (scenario: AdversarialScenario) => Promise<unknown>;

export interface RunEvalOpts {
  scenarios?: readonly AdversarialScenario[];
  judge: JudgeClient;
  invoke: PipelineInvoker;
}

function verdictScore(v: EvalResult["verdict"]): number {
  switch (v) {
    case "pass":
      return 1;
    case "ambiguous":
      return 0.5;
    case "fail":
      return 0;
  }
}

export async function runEval(opts: RunEvalOpts): Promise<EvalRun> {
  const scenarios = opts.scenarios ?? ADVERSARIAL_SCENARIOS;
  const results: EvalResult[] = [];
  for (const scenario of scenarios) {
    const pipeline_output = await opts.invoke(scenario);
    const response = await opts.judge.score({
      scenario,
      pipeline_output,
      expected_label: scenario.expected_label,
    });
    results.push({
      scenario_id: scenario.id,
      verdict: response.verdict,
      reasoning: response.reasoning,
      score: verdictScore(response.verdict),
    });
  }
  const total = results.length;
  const passed = results.filter((r) => r.verdict === "pass").length;
  const failed = results.filter((r) => r.verdict === "fail").length;
  const ambiguous = results.filter((r) => r.verdict === "ambiguous").length;
  const meanScore = total > 0 ? results.reduce((a, r) => a + r.score, 0) / total : 0;
  const mae = 1 - meanScore;
  return {
    results,
    total,
    passed,
    failed,
    ambiguous,
    mae,
    passed_gate: mae <= MAE_GATE,
  };
}
