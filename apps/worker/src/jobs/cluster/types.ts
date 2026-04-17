/**
 * Types for nightly prompt-cluster recompute.
 * Contract 05 §Batch + contract 09 §MVs + CLAUDE.md AI Rules.
 *
 * V1 algorithm: mini-batch k-means. HDBSCAN upgrade is v2 territory.
 * Batch API dispatch is openai-specific (50% discount); other providers
 * fall back to embedBatch().
 */

export interface PromptRecordForClustering {
  session_id: string;
  prompt_index: number;
  org_id: string;
  /** Pre-redacted, pre-abstracted text produced by Clio (contract 06). */
  abstract: string;
}

export interface ClusteredPrompt extends PromptRecordForClustering {
  /** Assigned cluster id (deterministic given seed + centroids). */
  cluster_id: string;
}

export interface ClusterCentroid {
  cluster_id: string;
  centroid: number[];
  dim: number;
  /** Raw member count — used by API layer for k-anonymity gate (k≥3). */
  member_count: number;
}

export interface RecomputeResult {
  centroids: ClusterCentroid[];
  assignments: ClusteredPrompt[];
  /** How many prompts were submitted; may differ from input when dedup kicks in. */
  submitted: number;
}
