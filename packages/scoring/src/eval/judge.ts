import type { AdversarialScenario, ExpectedLabel, JudgeClient, JudgeResponse } from "./types";

/**
 * Mock judge used by unit tests. Compares expected_label to a field on
 * the pipeline output and returns a deterministic verdict.
 */
export function mockJudgeFromLabel(
  extract: (out: unknown) => ExpectedLabel | "unknown",
): JudgeClient {
  return {
    async score({ pipeline_output, expected_label, scenario }): Promise<JudgeResponse> {
      const observed = extract(pipeline_output);
      if (observed === "unknown") {
        return { verdict: "ambiguous", reasoning: `no label extractable from ${scenario.id}` };
      }
      return observed === expected_label
        ? { verdict: "pass", reasoning: `observed=${observed} matches expected=${expected_label}` }
        : { verdict: "fail", reasoning: `observed=${observed} != expected=${expected_label}` };
    },
  };
}

/**
 * Production judge — wraps the Anthropic Opus API. Not wired in this
 * ticket; caller injects via dependency. Placeholder signature so the
 * runner can be typed against it.
 */
export interface OpusJudgeOpts {
  apiKey: string;
  model?: string; // default claude-opus-4-7
}

export function makeOpusJudge(_opts: OpusJudgeOpts): JudgeClient {
  return {
    async score(): Promise<JudgeResponse> {
      throw new Error(
        "makeOpusJudge is a stub — the real Opus judge wires in before the gate runs in CI",
      );
    },
  };
}

/** Helper to extract a label from an insight engine output (stub shape). */
export function extractLabelFromEngineOutput(out: unknown): ExpectedLabel | "unknown" {
  if (typeof out !== "object" || out === null) return "unknown";
  const obj = out as Record<string, unknown>;
  const insights = obj.insights;
  if (!Array.isArray(insights) || insights.length === 0) return "drop";
  const first = insights[0] as Record<string, unknown>;
  if (first.confidence === "high") return "high_confidence";
  if (first.confidence === "medium") return "investigate";
  return "drop";
}

/** Convenience constant export that re-uses the `AdversarialScenario` shape in callers. */
export type { AdversarialScenario };
