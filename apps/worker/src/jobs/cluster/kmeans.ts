/**
 * Mini-batch k-means — v1 clusterer. Simple, deterministic given seed,
 * no external deps. HDBSCAN upgrade is v2.
 *
 * Algorithm:
 *   1. Initialize k centroids by k-means++ seeding.
 *   2. Iterate: for each point, assign to nearest centroid; then
 *      recompute each centroid as the mean of its members.
 *   3. Stop when no assignments change OR max iterations reached.
 */

function squaredDistance(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    const diff = av - bv;
    s += diff * diff;
  }
  return s;
}

function meanVector(points: number[][], dim: number): number[] {
  if (points.length === 0) return new Array<number>(dim).fill(0);
  const sum = new Array<number>(dim).fill(0);
  for (const p of points) {
    for (let i = 0; i < dim; i++) {
      sum[i] = (sum[i] ?? 0) + (p[i] ?? 0);
    }
  }
  return sum.map((v) => v / points.length);
}

/** Seeded LCG so clustering is reproducible in tests. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_103_515_245 + 12_345) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** k-means++ seeding: first centroid random; each subsequent chosen with
 *  probability proportional to squared distance from closest existing centroid. */
function seedCentroids(points: number[][], k: number, rand: () => number): number[][] {
  if (points.length === 0 || k === 0) return [];
  const centroids: number[][] = [];
  const firstIdx = Math.floor(rand() * points.length);
  const first = points[firstIdx];
  if (first) centroids.push(first.slice());
  while (centroids.length < k && centroids.length < points.length) {
    const dists = points.map((p) => Math.min(...centroids.map((c) => squaredDistance(p, c))));
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) {
      // All points coincide with existing centroids; just pick the next distinct point.
      const nextIdx = centroids.length % points.length;
      const pt = points[nextIdx];
      if (pt) centroids.push(pt.slice());
      continue;
    }
    const r = rand() * total;
    let acc = 0;
    for (let i = 0; i < points.length; i++) {
      acc += dists[i] ?? 0;
      if (acc >= r) {
        const pt = points[i];
        if (pt) centroids.push(pt.slice());
        break;
      }
    }
  }
  return centroids;
}

export interface KMeansOpts {
  k: number;
  maxIterations?: number;
  seed?: number;
}

export interface KMeansResult {
  centroids: number[][];
  assignments: number[]; // length = points.length; value = centroid index
  iterations: number;
  converged: boolean;
}

export function kmeans(points: number[][], opts: KMeansOpts): KMeansResult {
  const n = points.length;
  const firstPoint = points[0];
  const dim = firstPoint?.length ?? 0;
  const k = Math.min(opts.k, n);
  const maxIter = opts.maxIterations ?? 50;
  const rand = makeRng(opts.seed ?? 0x1337);

  if (n === 0 || k === 0) {
    return { centroids: [], assignments: [], iterations: 0, converged: true };
  }

  let centroids = seedCentroids(points, k, rand);
  let assignments = new Array<number>(n).fill(0);
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations++;
    const nextAssignments = points.map((p) => {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centroids.length; c++) {
        const centroid = centroids[c];
        if (!centroid) continue;
        const d = squaredDistance(p, centroid);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    });

    const changed = nextAssignments.some((a, i) => a !== assignments[i]);
    assignments = nextAssignments;

    // Recompute centroids as means of their members
    const buckets: number[][][] = Array.from({ length: centroids.length }, () => []);
    for (let i = 0; i < n; i++) {
      const idx = assignments[i];
      const pt = points[i];
      if (idx === undefined || !pt) continue;
      const bucket = buckets[idx];
      if (bucket) bucket.push(pt);
    }
    centroids = buckets.map((b, c) =>
      b.length > 0 ? meanVector(b, dim) : (centroids[c] ?? new Array<number>(dim).fill(0)),
    );

    if (!changed) {
      converged = true;
      break;
    }
  }

  return { centroids, assignments, iterations, converged };
}
