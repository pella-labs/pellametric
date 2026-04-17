import { cosineSimilarity, topKSimilar } from "./similarity";

/**
 * Twin Finder — given a query embedding and a corpus of (cluster, session)
 * pairs, returns the top-k most similar sessions under k-anonymity constraint.
 * Per D2-07 primer + CLAUDE.md §6.4: cluster must have ≥ 3 contributing
 * engineers to be surfaced.
 */
export interface TwinSessionCandidate {
  session_id: string;
  cluster_id: string;
  embedding: number[];
  /** Engineer who owns this session; used for k-anonymity gate. */
  engineer_id: string;
}

export interface ClusterKStats {
  cluster_id: string;
  distinct_engineers: number;
}

export interface TwinFinderResult {
  session_id: string;
  cluster_id: string;
  similarity: number;
  /** Always hidden by default; UI reveals under IC opt-in. */
  engineer_id_hash: string;
}

export interface FindTwinsOpts {
  queryEmbedding: readonly number[];
  candidates: readonly TwinSessionCandidate[];
  clusterStats: readonly ClusterKStats[];
  /** Queryor's own session_id — excluded from results to avoid self-matches. */
  selfSessionId?: string;
  /** Minimum distinct engineers in the candidate's cluster. Default 3. */
  kFloor?: number;
  /** How many twins to return. Default 10. */
  topK?: number;
}

export type FindTwinsError =
  | { kind: "cohort_too_small"; cluster_id: string; distinct_engineers: number }
  | { kind: "no_matches" };

export type FindTwinsOutcome =
  | { ok: true; twins: TwinFinderResult[] }
  | { ok: false; error: FindTwinsError };

/** sha256-first-16-chars hash stub — in production this is HMAC(engineer_id, tenant_salt). */
function hashEngineerId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i);
  return `eh_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function findTwins(opts: FindTwinsOpts): FindTwinsOutcome {
  const kFloor = opts.kFloor ?? 3;
  const topK = opts.topK ?? 10;
  const statsByCluster = new Map<string, number>();
  for (const s of opts.clusterStats) statsByCluster.set(s.cluster_id, s.distinct_engineers);

  // 1. Filter out self + k-anonymity failures.
  const eligible = opts.candidates.filter((c) => {
    if (opts.selfSessionId && c.session_id === opts.selfSessionId) return false;
    const k = statsByCluster.get(c.cluster_id) ?? 0;
    return k >= kFloor;
  });

  if (eligible.length === 0) {
    // If every candidate was filtered by k-floor, return structured error.
    const smallestOffender = opts.candidates.find(
      (c) => (statsByCluster.get(c.cluster_id) ?? 0) < kFloor,
    );
    if (smallestOffender) {
      return {
        ok: false,
        error: {
          kind: "cohort_too_small",
          cluster_id: smallestOffender.cluster_id,
          distinct_engineers: statsByCluster.get(smallestOffender.cluster_id) ?? 0,
        },
      };
    }
    return { ok: false, error: { kind: "no_matches" } };
  }

  const matches = topKSimilar(opts.queryEmbedding, eligible, topK, (c) => c.embedding);

  return {
    ok: true,
    twins: matches.map((m) => ({
      session_id: m.item.session_id,
      cluster_id: m.item.cluster_id,
      similarity: m.similarity,
      engineer_id_hash: hashEngineerId(m.item.engineer_id),
    })),
  };
}

export { cosineSimilarity };
