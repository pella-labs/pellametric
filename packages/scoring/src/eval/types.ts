/**
 * Types for the LLM-judge adversarial eval harness.
 * Per CLAUDE.md Testing Rules: 50 synthetic team-week scenarios,
 * LLM-judge gate ≥ 0.7 in CI. Merge-blocking on packages/scoring or
 * apps/worker/src/jobs/insight changes.
 */

export type ExpectedLabel = "high_confidence" | "investigate" | "drop";

export interface AdversarialFixture {
  /** Minimal fixture that the Insight Engine pipeline consumes.
   *  Real shape is contract 04 ScoringInput + H4a precompute enums. */
  org_id: string;
  week: string;
  engineer_ids: string[];
  cluster_ids: string[];
  session_ids: string[];
  aggregates: Record<string, number>;
  /** Free-text narrative the judge reads alongside engine output. */
  narrative: string;
}

export interface AdversarialScenario {
  id: string; // slug, e.g. "infra-hero-high-tokens"
  description: string;
  fixture: AdversarialFixture;
  expected_label: ExpectedLabel;
  /** True if this scenario is a Goodhart trap the engine must NOT misclassify.
   *  Drives the adversarial eval weight. */
  adversarial_high_impact: boolean;
  /** Which (real) engineer_id the scenario hinges on; judge prompt will quote. */
  sensitive_dev_id?: string;
}

export type JudgeVerdict = "pass" | "fail" | "ambiguous";

export interface JudgeResponse {
  verdict: JudgeVerdict;
  reasoning: string;
}

export interface JudgeClient {
  /** Sends scenario + pipeline output to the judge; returns verdict. */
  score(input: {
    scenario: AdversarialScenario;
    pipeline_output: unknown;
    expected_label: ExpectedLabel;
  }): Promise<JudgeResponse>;
}

export interface EvalResult {
  scenario_id: string;
  verdict: JudgeVerdict;
  reasoning: string;
  /** 1 for pass, 0 for fail, 0.5 for ambiguous — used in MAE calc. */
  score: number;
}

export interface EvalRun {
  results: EvalResult[];
  total: number;
  passed: number;
  failed: number;
  ambiguous: number;
  /** Mean absolute error against "all pass" target of 1.0. Range [0,1].
   *  Gate is MAE ≤ 0.3 (equivalent to score ≥ 0.7). */
  mae: number;
  /** True if this run cleared the merge gate. */
  passed_gate: boolean;
}
