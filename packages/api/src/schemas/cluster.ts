import { z } from "zod";
import { DeveloperIdentity, Fidelity, Window } from "./common";

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
  /**
   * Compliance-OFF demo opt-in: when true, surfaces clusters below the k≥3
   * contributor floor that would otherwise be suppressed. Default false
   * preserves the locked server-side privacy floor for every current caller.
   * Callers MUST gate this on `isComplianceEnabled() === false`.
   */
  includeBelowFloorClusters: z.boolean().optional(),
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
  /**
   * Distinct contributors. The default query path enforces the k≥3 floor
   * server-side (below-floor clusters are dropped, never returned). The
   * compliance-OFF demo path (`includeBelowFloorClusters: true`) can surface
   * counts below 3, which is why the type is `nonnegative()` rather than
   * `min(3)`.
   */
  contributor_count: z.number().int().nonnegative(),
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

/**
 * Twin Finder — given a query session_id, return the top-K most similar
 * sessions across the corpus. k>=3 contributor floor on the candidate's cluster
 * is server-enforced by `@bematist/scoring`'s `findTwins`. Engineer ids are
 * never returned in raw form — only an opaque `engineer_id_hash`.
 */
export const TwinFinderInput = z.object({
  session_id: z.string().min(1),
  /** Zero-based prompt index within the session. Defaults to 0 — first prompt. */
  prompt_index: z.number().int().nonnegative().optional(),
  /** How many twins to return. Default 10, capped at 25. */
  top_k: z.number().int().positive().max(25).optional(),
});
export type TwinFinderInput = z.infer<typeof TwinFinderInput>;

export const TwinFinderMatch = z.object({
  session_id: z.string(),
  cluster_id: z.string(),
  /** Cosine similarity in [-1, 1]. */
  similarity: z.number(),
  /** Opaque hash of the matched engineer's id — raw engineer_id never leaks. */
  engineer_id_hash: z.string(),
});
export type TwinFinderMatch = z.infer<typeof TwinFinderMatch>;

export const TwinFinderOutput = z.union([
  z.object({
    ok: z.literal(true),
    query_session_id: z.string(),
    /** Cluster the query session lives in; null if unassigned. */
    query_cluster_id: z.string().nullable(),
    matches: z.array(TwinFinderMatch),
    /** Wall-clock latency of the query path, milliseconds. */
    latency_ms: z.number().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    query_session_id: z.string(),
    reason: z.enum(["no_embedding", "cohort_too_small", "no_matches"]),
    /** Present only when reason = cohort_too_small; surfaced as a count, never the id. */
    cluster_id_hint: z.string().nullable().optional(),
  }),
]);
export type TwinFinderOutput = z.infer<typeof TwinFinderOutput>;

/**
 * Cluster Contributors — the distinct engineers who contributed prompts to a
 * cluster, returned as opaque hashes only. This is the click-into-a-cluster UX
 * from CLAUDE.md §Scoring Rules: "IC names hidden by default (color dots;
 * reveal requires IC opt-in)".
 *
 * Server enforces the k≥3 floor BEFORE computing per-contributor stats — any
 * cluster under the floor returns `ok:false`. Engineer ids NEVER leave as raw
 * ids; the `engineer_id_hash` stub matches `findTwins`'s output shape.
 */
export const ClusterContributorsInput = z.object({
  cluster_id: z.string().min(1),
  /** Max contributors to return; default 25. */
  limit: z.number().int().positive().max(100).optional(),
  /**
   * Compliance-OFF demo opt-in: when true, the ok:true response carries an
   * `identities` map of `engineer_id_hash → {name?, email, image?}`.
   * Callers MUST gate this on `isComplianceEnabled() === false`. The
   * below-floor / not-found branches never carry identities — same shape
   * as before, no information leak about cluster membership when the
   * cluster is suppressed.
   */
  includeIdentities: z.boolean().optional(),
});
export type ClusterContributorsInput = z.infer<typeof ClusterContributorsInput>;

export const ClusterContributor = z.object({
  /** Opaque engineer hash — raw engineer_id never leaks. */
  engineer_id_hash: z.string(),
  /** Distinct sessions this engineer contributed to this cluster in-window. */
  session_count: z.number().int().positive(),
});
export type ClusterContributor = z.infer<typeof ClusterContributor>;

export const ClusterContributorsOutput = z.union([
  z.object({
    ok: z.literal(true),
    cluster_id: z.string(),
    contributors: z.array(ClusterContributor),
    /** Total distinct engineers in the cluster — always >= 3 when ok:true. */
    contributor_count: z.number().int().min(3),
    /**
     * Plaintext identity per `engineer_id_hash`. Present ONLY when caller
     * opted in via `includeIdentities: true` (compliance-OFF demo path).
     * Absent in the default / compliance-ON path so the wire shape is
     * unchanged for existing callers.
     */
    identities: z.record(z.string(), DeveloperIdentity).optional(),
  }),
  z.object({
    ok: z.literal(false),
    cluster_id: z.string(),
    reason: z.enum(["cohort_too_small", "not_found"]),
    /** Present when reason = cohort_too_small. Reveals only the count, never ids. */
    contributor_count: z.number().int().nonnegative().optional(),
  }),
]);
export type ClusterContributorsOutput = z.infer<typeof ClusterContributorsOutput>;
