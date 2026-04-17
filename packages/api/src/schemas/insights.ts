import { z } from "zod";
import type { Confidence } from "./common";

/**
 * Weekly Insight Engine output. Per CLAUDE.md AI Rules:
 *   - High-confidence insights shown verbatim.
 *   - Medium insights labeled "investigate".
 *   - Low-confidence insights are DROPPED server-side; the wire never carries
 *     them. The output `confidence` union reflects that.
 *
 * Every cited id (session / cluster) comes from a constrained enum supplied
 * with the LLM prompt, so the frontend never needs to filter hallucinated
 * IDs — the pipeline did that.
 */
export const InsightsDigestInput = z.object({
  /** ISO week; default = current week. Accepted as `YYYY-Www`. */
  week: z
    .string()
    .regex(/^\d{4}-W\d{2}$/)
    .optional(),
  team_id: z.string().optional(),
});
export type InsightsDigestInput = z.infer<typeof InsightsDigestInput>;

export const Citation = z.object({
  kind: z.enum(["session", "cluster"]),
  id: z.string(),
  /** Short human label for the link text. */
  label: z.string(),
});
export type Citation = z.infer<typeof Citation>;

/** Wire-level confidence — server strips `"low"` before ever returning. */
export const WireConfidence = z.enum(["high", "medium"]);

export const Insight = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  confidence: WireConfidence,
  subject_kind: z.enum(["efficiency", "outcome", "adoption", "team_impact", "waste"]),
  citations: z.array(Citation),
});
export type Insight = z.infer<typeof Insight>;

export const InsightsDigestOutput = z.object({
  generated_at: z.string(),
  week_label: z.string(),
  insights: z.array(Insight),
  /** How many low-confidence insights were dropped before response. UI shows a count. */
  dropped_low_confidence: z.number().int().nonnegative(),
});
export type InsightsDigestOutput = z.infer<typeof InsightsDigestOutput>;

/**
 * Internal shape the pipeline returns — includes `"low"` so tests can assert
 * the server-side filter. NEVER exposed on the wire; the filter in
 * `queries/insights.ts` narrows this to `Insight`.
 */
export type PipelineInsight = Omit<Insight, "confidence"> & {
  confidence: Confidence;
};
