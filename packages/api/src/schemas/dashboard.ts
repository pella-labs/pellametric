import { z } from "zod";
import { Gated, TimeseriesPoint, Window } from "./common";

export const DashboardSummaryInput = z.object({
  window: Window,
  team_id: z.string().optional(),
});
export type DashboardSummaryInput = z.infer<typeof DashboardSummaryInput>;

export const DashboardSummaryOutput = z.object({
  window: Window,
  /** Total cost over window, in USD. */
  total_cost_usd: z.number().nonnegative(),
  /** Whether any adapter in the window reported estimated costs. */
  any_cost_estimated: z.boolean(),
  /** Accepted code edits (see useful_output_v1 §04). */
  accepted_edits: z.number().nonnegative(),
  /** Merged PRs with at least one AI-assisted session joined. */
  merged_prs: z.number().nonnegative(),
  /** Unique active sessions. */
  sessions: z.number().nonnegative(),
  /** Per-day cost series for the cost tile. */
  cost_series: z.array(TimeseriesPoint),
  /** AI Leverage Score — gated so it's either a number or a suppression payload. */
  ai_leverage_score: Gated(z.number().min(0).max(100)),
});
export type DashboardSummaryOutput = z.infer<typeof DashboardSummaryOutput>;
