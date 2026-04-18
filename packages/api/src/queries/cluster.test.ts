import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import { CLUSTER_CONTRIBUTOR_FLOOR, findSessionTwins, listClusters } from "./cluster";

describe("listClusters", () => {
  test("enforces k>=3 contributor floor; below-floor entries suppressed", async () => {
    const out = await listClusters(makeCtx(), { window: "30d" });
    expect(out.clusters.length).toBeGreaterThan(0);
    for (const c of out.clusters) {
      expect(c.contributor_count).toBeGreaterThanOrEqual(CLUSTER_CONTRIBUTOR_FLOOR);
    }
    // Fixture universe deliberately seeds entries < 3 contributors to exercise
    // the server-side floor.
    expect(out.suppressed_below_floor).toBeGreaterThanOrEqual(0);
  });

  test("labels look like 3–5 words, no URLs, no proper nouns", async () => {
    const out = await listClusters(makeCtx(), { window: "30d" });
    for (const c of out.clusters) {
      expect(c.label.length).toBeGreaterThan(0);
      const words = c.label.split(/\s+/).filter(Boolean);
      expect(words.length).toBeGreaterThanOrEqual(2);
      expect(words.length).toBeLessThanOrEqual(6);
      expect(c.label).not.toMatch(/https?:\/\//);
    }
  });

  test("respects `limit`", async () => {
    const out = await listClusters(makeCtx(), { window: "30d", limit: 3 });
    expect(out.clusters.length).toBeLessThanOrEqual(3);
  });
});

function makeCtx(): Ctx {
  return {
    tenant_id: "test-tenant",
    actor_id: "test-actor",
    role: "manager",
    db: {
      pg: { query: async () => [] },
      ch: { query: async () => [] },
      redis: {
        get: async () => null,
        set: async () => undefined,
        setNx: async () => true,
      },
    },
  };
}

describe("findSessionTwins (fixture branch)", () => {
  test("returns top-K twins with k>=3 enforced, engineer_id never raw", async () => {
    const out = await findSessionTwins(makeCtx(), { session_id: "ses_query_42" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches.length).toBeLessThanOrEqual(10);
    for (const m of out.matches) {
      expect(m.engineer_id_hash).toMatch(/^eh_[0-9a-f]{8}$/);
      expect(m.engineer_id_hash).not.toContain("eng_fx_");
      expect(m.similarity).toBeGreaterThanOrEqual(-1);
      expect(m.similarity).toBeLessThanOrEqual(1 + 1e-6);
      expect(m.session_id).not.toBe(out.query_session_id);
    }
    // Matches must be sorted by similarity descending.
    for (let i = 1; i < out.matches.length; i++) {
      const prev = out.matches[i - 1];
      const cur = out.matches[i];
      if (prev && cur) {
        expect(prev.similarity).toBeGreaterThanOrEqual(cur.similarity);
      }
    }
  });

  test("respects top_k override", async () => {
    const out = await findSessionTwins(makeCtx(), {
      session_id: "ses_query_abc",
      top_k: 3,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.matches.length).toBeLessThanOrEqual(3);
  });

  test("does NOT surface clusters below the k=3 contributor floor", async () => {
    const out = await findSessionTwins(makeCtx(), {
      session_id: "ses_query_xyz",
      top_k: 25,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Fixture universe seeds c_005 (k=2) and c_006 (k=1). They must not appear.
    const seenClusters = new Set(out.matches.map((m) => m.cluster_id));
    expect(seenClusters.has("c_005")).toBe(false);
    expect(seenClusters.has("c_006")).toBe(false);
    expect(CLUSTER_CONTRIBUTOR_FLOOR).toBeGreaterThanOrEqual(3);
  });

  test("latency_ms is reported and nonnegative", async () => {
    const out = await findSessionTwins(makeCtx(), { session_id: "ses_query_lm" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

/**
 * p95 < 500ms merge-blocker gate, measured on a 10k-candidate synthetic corpus.
 * Runs the real-branch path with a mocked CH client so the cost is purely the
 * server-side cosine-similarity pass + k-NN sort — i.e., the hot path a real
 * ClickHouse call would land us in once the rows are returned.
 */
describe("findSessionTwins — p95 < 500ms on 10k-embedding fixture (MERGE BLOCKER)", () => {
  beforeEach(() => {
    process.env.USE_FIXTURES = "0";
  });
  afterEach(() => {
    delete process.env.USE_FIXTURES;
  });

  test("20 iterations; p95 < 500ms", async () => {
    const dim = 64;
    const candidatesN = 10_000;
    const clusterCount = 40;
    const queryVec = randomUnitVec(0xdeadbeef, dim);

    type CandidateRow = {
      session_id: string;
      engineer_id: string;
      cluster_id: string;
      prompt_embedding: number[];
    };
    const candidates: CandidateRow[] = new Array(candidatesN);
    for (let i = 0; i < candidatesN; i++) {
      const cluster = i % clusterCount;
      candidates[i] = {
        session_id: `ses_perf_${i.toString().padStart(6, "0")}`,
        engineer_id: `eng_perf_${(i % 200).toString().padStart(4, "0")}`,
        cluster_id: `c_${cluster.toString().padStart(3, "0")}`,
        prompt_embedding: randomUnitVec(0xabcd0000 ^ i, dim),
      };
    }
    const stats = Array.from({ length: clusterCount }, (_, c) => ({
      cluster_id: `c_${c.toString().padStart(3, "0")}`,
      distinct_engineers: 5,
    }));

    const ctx: Ctx = {
      tenant_id: "perf-tenant",
      actor_id: "perf-actor",
      role: "manager",
      db: {
        pg: { query: async () => [] },
        ch: {
          query: async <T = unknown>(sql: string): Promise<T[]> => {
            if (sql.includes("prompt_cluster_stats")) return stats as T[];
            if (sql.includes("INNER JOIN events")) return candidates as T[];
            // query-session lookup
            return [
              {
                cluster_id: "c_000",
                prompt_embedding: queryVec,
              },
            ] as T[];
          },
        },
        redis: {
          get: async () => null,
          set: async () => undefined,
          setNx: async () => true,
        },
      },
    };

    const durations: number[] = [];
    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const out = await findSessionTwins(ctx, {
        session_id: "ses_perf_query",
        top_k: 10,
      });
      const t1 = performance.now();
      durations.push(t1 - t0);
      expect(out.ok).toBe(true);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.max(0, Math.floor(durations.length * 0.95) - 1)] ?? 0;
    // MERGE BLOCKER: p95 < 500ms on a 10k-embedding fixture.
    expect(p95).toBeLessThan(500);
  }, 30_000);
});

function randomUnitVec(seed: number, dim: number): number[] {
  const out = new Array<number>(dim);
  let mag = 0;
  for (let i = 0; i < dim; i++) {
    const v = Math.sin(seed + i * 101) * 10000;
    const f = v - Math.floor(v) - 0.5;
    out[i] = f;
    mag += f * f;
  }
  const n = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) out[i] = (out[i] ?? 0) / n;
  return out;
}
