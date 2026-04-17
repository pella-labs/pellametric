import { kmeans } from "./kmeans";
import type {
  ClusterCentroid,
  ClusteredPrompt,
  PromptRecordForClustering,
  RecomputeResult,
} from "./types";

/** Strategy: adapt k to volume — rule of thumb sqrt(N/2) bounded to [2, 32].
 *  Future iteration: run silhouette analysis to pick optimal k. */
function chooseK(n: number): number {
  if (n < 4) return 1;
  const target = Math.round(Math.sqrt(n / 2));
  return Math.max(2, Math.min(32, target));
}

export interface RecomputeInput {
  /** Embeddings aligned 1:1 with records.abstract. */
  embeddings: number[][];
  records: PromptRecordForClustering[];
  /** RNG seed for determinism in tests. */
  seed?: number;
  /** Override k. Default: adaptive via chooseK(). */
  k?: number;
}

export function recluster(input: RecomputeInput): RecomputeResult {
  const n = input.embeddings.length;
  if (n !== input.records.length) {
    throw new Error(`recluster: embeddings length ${n} != records length ${input.records.length}`);
  }
  if (n === 0) {
    return { centroids: [], assignments: [], submitted: 0 };
  }

  const k = input.k ?? chooseK(n);
  const result = kmeans(input.embeddings, { k, seed: input.seed ?? 0x1337 });

  // Count members per cluster.
  const counts = new Array<number>(result.centroids.length).fill(0);
  for (const a of result.assignments) counts[a] = (counts[a] ?? 0) + 1;

  const centroids: ClusterCentroid[] = result.centroids.map((c, i) => ({
    cluster_id: `c_${i.toString().padStart(4, "0")}`,
    centroid: c,
    dim: c.length,
    member_count: counts[i] ?? 0,
  }));

  const assignments: ClusteredPrompt[] = input.records.map((r, i) => {
    const idx = result.assignments[i] ?? 0;
    const clusterId = centroids[idx]?.cluster_id ?? "c_0000";
    return { ...r, cluster_id: clusterId };
  });

  return { centroids, assignments, submitted: n };
}
