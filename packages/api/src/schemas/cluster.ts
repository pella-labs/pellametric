import { z } from "zod";
import { Fidelity, Window } from "./common";

/**
 * Prompt-cluster list + Twin Finder. Server ALWAYS enforces k>=3 contributor
 * floor per CLAUDE.md Privacy Model Rules: clusters below the floor are
 * computed but never surfaced. The frontend just renders what arrives — the
 * server is the boundary.
 */
export const ClusterListInput = z.object({
  window: Window,
  team_id: z.string().optional(),
  task_category: z.string().optional(),
  /** Max clusters to return; default 20. */
  limit: z.number().int().positive().max(100).optional(),
});
export type ClusterListInput = z.infer<typeof ClusterListInput>;

export const ClusterOutcome = z.object({
  kind: z.enum(["merged_pr", "green_test", "revert"]),
  count: z.number().int().nonnegative(),
});
export type ClusterOutcome = z.infer<typeof ClusterOutcome>;

export const Cluster = z.object({
  id: z.string(),
  /**
   * 3–5 word cluster label from the gateway labeler. Regex-validated at
   * label-time (no URLs, no proper nouns — CLAUDE.md AI Rules).
   */
  label: z.string(),
  /** Always >=3 in output; below floor is dropped server-side. */
  contributor_count: z.number().int().min(3),
  session_count: z.number().int().nonnegative(),
  avg_cost_usd: z.number().nonnegative(),
  top_outcomes: z.array(ClusterOutcome),
  fidelity: Fidelity,
});
export type Cluster = z.infer<typeof Cluster>;

export const ClusterListOutput = z.object({
  window: Window,
  team_id: z.string().nullable(),
  task_category: z.string().nullable(),
  clusters: z.array(Cluster),
  /**
   * Clusters computed in this window but suppressed because their
   * contributor_count was < 3. Surfaced as a count only — never as IDs.
   */
  suppressed_below_floor: z.number().int().nonnegative(),
});
export type ClusterListOutput = z.infer<typeof ClusterListOutput>;
