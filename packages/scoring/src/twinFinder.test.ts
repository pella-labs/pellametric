import { expect, test } from "bun:test";
import { cosineSimilarity, topKSimilar } from "./similarity";
import { findTwins, type TwinSessionCandidate } from "./twinFinder";

test("cosineSimilarity: orthogonal vectors → 0", () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
});

test("cosineSimilarity: parallel vectors → 1", () => {
  expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
});

test("cosineSimilarity: zero vector → 0", () => {
  expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
});

test("topKSimilar: picks highest-similarity first", () => {
  const items = [
    { id: "a", vec: [1, 0, 0] },
    { id: "b", vec: [0.9, 0.1, 0] },
    { id: "c", vec: [0, 1, 0] },
  ];
  const result = topKSimilar([1, 0, 0], items, 2, (i) => i.vec);
  expect(result[0]?.item.id).toBe("a");
  expect(result[1]?.item.id).toBe("b");
});

const matchingVec = [1, 0, 0, 0];
const dissimilarVec = [0, 1, 0, 0];

function makeCandidates(): TwinSessionCandidate[] {
  return [
    { session_id: "s_self", cluster_id: "c_1", embedding: matchingVec, engineer_id: "eng_me" },
    { session_id: "s1", cluster_id: "c_1", embedding: matchingVec, engineer_id: "eng_a" },
    { session_id: "s2", cluster_id: "c_1", embedding: matchingVec, engineer_id: "eng_b" },
    { session_id: "s3", cluster_id: "c_1", embedding: matchingVec, engineer_id: "eng_c" },
    { session_id: "s4", cluster_id: "c_1", embedding: dissimilarVec, engineer_id: "eng_d" },
  ];
}

test("findTwins: returns top-k similar sessions; excludes self", () => {
  const result = findTwins({
    queryEmbedding: matchingVec,
    candidates: makeCandidates(),
    clusterStats: [{ cluster_id: "c_1", distinct_engineers: 4 }],
    selfSessionId: "s_self",
    topK: 3,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.twins).toHaveLength(3);
  // Self excluded
  expect(result.twins.find((t) => t.session_id === "s_self")).toBeUndefined();
  // Top result should be one of the matching-vec sessions
  const topId = result.twins[0]?.session_id ?? "";
  expect(["s1", "s2", "s3"]).toContain(topId);
});

test("findTwins: k-anonymity → returns cohort_too_small error when cluster has < 3 engineers", () => {
  const result = findTwins({
    queryEmbedding: matchingVec,
    candidates: [
      { session_id: "only", cluster_id: "c_tiny", embedding: matchingVec, engineer_id: "eng_x" },
    ],
    clusterStats: [{ cluster_id: "c_tiny", distinct_engineers: 1 }],
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("cohort_too_small");
});

test("findTwins: engineer_id never leaks raw; only hashed form returned", () => {
  const result = findTwins({
    queryEmbedding: matchingVec,
    candidates: makeCandidates(),
    clusterStats: [{ cluster_id: "c_1", distinct_engineers: 4 }],
    selfSessionId: "s_self",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  for (const t of result.twins) {
    expect(t.engineer_id_hash).toMatch(/^eh_[0-9a-f]{8}$/);
    // Raw id should never appear
    expect(t.engineer_id_hash).not.toContain("eng_");
  }
});

test("findTwins: no candidates → no_matches error", () => {
  const result = findTwins({
    queryEmbedding: matchingVec,
    candidates: [],
    clusterStats: [],
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("no_matches");
});
