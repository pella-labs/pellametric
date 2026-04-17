/**
 * Cosine similarity helpers for Twin Finder (D2-07).
 * Pure math. No IO. Consumers (tRPC procedure, D2-06 cluster tools)
 * inject the embedding vectors.
 */

export function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export function norm(a: readonly number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s);
}

/** Returns cosine similarity in [-1, 1]. Returns 0 when either vector is zero. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export interface SimilarMatch<T> {
  item: T;
  similarity: number;
}

/**
 * Return the top-k items with highest cosine similarity to `query`.
 *
 * @param query the query embedding.
 * @param items list of candidates, each with an embedding under `pickVec`.
 * @param k max results (>=1).
 * @param pickVec function returning the item's embedding.
 */
export function topKSimilar<T>(
  query: readonly number[],
  items: readonly T[],
  k: number,
  pickVec: (item: T) => readonly number[],
): SimilarMatch<T>[] {
  if (k < 1) return [];
  const scored: SimilarMatch<T>[] = items.map((item) => ({
    item,
    similarity: cosineSimilarity(query, pickVec(item)),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, Math.min(k, scored.length));
}
