import { expect, test } from "bun:test";
import { kmeans } from "./kmeans";
import { recluster } from "./recluster";
import type { PromptRecordForClustering } from "./types";

/** Two well-separated Gaussian clusters in 4d space. */
function fixture(): { embeddings: number[][]; records: PromptRecordForClustering[] } {
  const pointsA = [
    [0.1, 0.1, 0.0, 0.0],
    [0.11, 0.09, 0.01, 0.0],
    [0.09, 0.12, 0.0, 0.01],
    [0.1, 0.11, 0.0, 0.0],
  ];
  const pointsB = [
    [0.9, 0.9, 1.0, 1.0],
    [0.91, 0.88, 1.01, 0.99],
    [0.89, 0.92, 1.0, 1.01],
    [0.9, 0.91, 0.99, 1.0],
  ];
  const embeddings = [...pointsA, ...pointsB];
  const records: PromptRecordForClustering[] = embeddings.map((_, i) => ({
    session_id: `s_${i}`,
    prompt_index: 0,
    org_id: "org_t",
    abstract: `abstract_${i}`,
  }));
  return { embeddings, records };
}

test("kmeans: converges on 2 well-separated clusters in 4d", () => {
  const { embeddings } = fixture();
  const result = kmeans(embeddings, { k: 2, seed: 42 });
  expect(result.converged).toBe(true);
  expect(result.centroids).toHaveLength(2);
  // Each cluster of 4 points should be assigned to a single centroid.
  const first4 = result.assignments.slice(0, 4);
  const last4 = result.assignments.slice(4, 8);
  expect(new Set(first4).size).toBe(1);
  expect(new Set(last4).size).toBe(1);
  expect(first4[0]).not.toBe(last4[0]);
});

test("kmeans: deterministic given seed", () => {
  const { embeddings } = fixture();
  const a = kmeans(embeddings, { k: 2, seed: 42 });
  const b = kmeans(embeddings, { k: 2, seed: 42 });
  expect(a.assignments).toEqual(b.assignments);
});

test("kmeans: empty input returns empty result", () => {
  const result = kmeans([], { k: 3 });
  expect(result.centroids).toHaveLength(0);
  expect(result.assignments).toHaveLength(0);
  expect(result.converged).toBe(true);
});

test("recluster: assigns all prompts a cluster_id; member_count sums to N", () => {
  const { embeddings, records } = fixture();
  const result = recluster({ embeddings, records, k: 2, seed: 42 });
  expect(result.submitted).toBe(8);
  expect(result.assignments).toHaveLength(8);
  for (const a of result.assignments) {
    expect(a.cluster_id).toMatch(/^c_\d{4}$/);
  }
  const totalMembers = result.centroids.reduce((sum, c) => sum + c.member_count, 0);
  expect(totalMembers).toBe(8);
});

test("recluster: throws on embeddings/records length mismatch", () => {
  expect(() =>
    recluster({
      embeddings: [[0, 0]],
      records: [],
    }),
  ).toThrow(/length/);
});

test("recluster: empty input short-circuits cleanly", () => {
  const result = recluster({ embeddings: [], records: [] });
  expect(result.submitted).toBe(0);
  expect(result.assignments).toHaveLength(0);
  expect(result.centroids).toHaveLength(0);
});

test("recluster: cluster_id is stable across runs with same seed", () => {
  const { embeddings, records } = fixture();
  const a = recluster({ embeddings, records, k: 2, seed: 42 });
  const b = recluster({ embeddings, records, k: 2, seed: 42 });
  const aIds = a.assignments.map((x) => x.cluster_id);
  const bIds = b.assignments.map((x) => x.cluster_id);
  expect(aIds).toEqual(bIds);
});
