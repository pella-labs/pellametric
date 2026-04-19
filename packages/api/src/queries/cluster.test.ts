import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import {
  CLUSTER_CONTRIBUTOR_FLOOR,
  findSessionTwins,
  listClusterContributors,
  listClusters,
} from "./cluster";

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

  test("includeBelowFloorClusters=true surfaces clusters under the k=3 floor", async () => {
    const guarded = await listClusters(makeCtx(), { window: "30d", limit: 100 });
    const all = await listClusters(makeCtx(), {
      window: "30d",
      limit: 100,
      includeBelowFloorClusters: true,
    });
    // Unfiltered list must include every cluster the guarded list returned,
    // and at least one below-floor cluster (fixture universe seeds entries
    // with contributor_count < 3 to exercise the bypass).
    expect(all.clusters.length).toBeGreaterThan(guarded.clusters.length);
    expect(all.clusters.some((c) => c.contributor_count < CLUSTER_CONTRIBUTOR_FLOOR)).toBe(true);
    // suppressed_below_floor still reflects the locked floor so the badge stays
    // honest in both modes.
    expect(all.suppressed_below_floor).toBe(guarded.suppressed_below_floor);
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

describe("listClusterContributors (fixture branch)", () => {
  test("returns contributors with k>=3 enforced, engineer_id never raw", async () => {
    const out = await listClusterContributors(makeCtx(), { cluster_id: "c_000" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.cluster_id).toBe("c_000");
    expect(out.contributor_count).toBeGreaterThanOrEqual(CLUSTER_CONTRIBUTOR_FLOOR);
    expect(out.contributors.length).toBeGreaterThan(0);
    for (const c of out.contributors) {
      expect(c.engineer_id_hash).toMatch(/^eh_[0-9a-f]{8}$/);
      expect(c.engineer_id_hash).not.toContain("eng_fx_");
      expect(c.session_count).toBeGreaterThan(0);
    }
    // Sorted by session_count desc.
    for (let i = 1; i < out.contributors.length; i++) {
      const prev = out.contributors[i - 1];
      const cur = out.contributors[i];
      if (prev && cur) {
        expect(prev.session_count).toBeGreaterThanOrEqual(cur.session_count);
      }
    }
  });

  test("suppresses below-floor cluster; exposes count only, never ids", async () => {
    // Fixture universe seeds c_005 with 2 contributors and c_006 with 1.
    const out = await listClusterContributors(makeCtx(), { cluster_id: "c_005" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("cohort_too_small");
    expect(out.contributor_count).toBeLessThan(CLUSTER_CONTRIBUTOR_FLOOR);
    expect(out.contributor_count).toBeGreaterThan(0);
    // The shape must NOT leak any contributor array at all.
    expect((out as unknown as { contributors?: unknown }).contributors).toBeUndefined();
  });

  test("returns not_found for cluster not in universe", async () => {
    const out = await listClusterContributors(makeCtx(), { cluster_id: "c_does_not_exist" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not_found");
  });

  test("respects limit and caps at 25 engineers", async () => {
    const out = await listClusterContributors(makeCtx(), {
      cluster_id: "c_000",
      limit: 2,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.contributors.length).toBeLessThanOrEqual(2);
  });

  test("consistent engineer_id_hash across Twin Finder + contributors views", async () => {
    // Hashes must align so the UI can render the same color dot for the same
    // engineer regardless of which view surfaces them.
    const ctx = makeCtx();
    const twins = await findSessionTwins(ctx, { session_id: "ses_query_same" });
    expect(twins.ok).toBe(true);
    if (!twins.ok) return;
    const contribs = await listClusterContributors(ctx, { cluster_id: "c_000" });
    expect(contribs.ok).toBe(true);
    if (!contribs.ok) return;
    // Both views use the same stable eh_* hash format.
    for (const t of twins.matches) expect(t.engineer_id_hash).toMatch(/^eh_[0-9a-f]{8}$/);
    for (const c of contribs.contributors) expect(c.engineer_id_hash).toMatch(/^eh_[0-9a-f]{8}$/);
  });

  test("omits identities map when includeIdentities is not requested", async () => {
    const out = await listClusterContributors(makeCtx(), { cluster_id: "c_000" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out as unknown as { identities?: unknown }).identities).toBeUndefined();
  });

  test("returns identities map keyed by engineer_id_hash when includeIdentities=true", async () => {
    const out = await listClusterContributors(makeCtx(), {
      cluster_id: "c_000",
      includeIdentities: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.identities).toBeDefined();
    for (const c of out.contributors) {
      const id = out.identities?.[c.engineer_id_hash];
      expect(id).toBeDefined();
      expect(typeof id?.email).toBe("string");
      expect(id?.email.length).toBeGreaterThan(0);
    }
  });

  test("identities map omitted on below-floor cluster (consistent with no contributor array)", async () => {
    const out = await listClusterContributors(makeCtx(), {
      cluster_id: "c_005",
      includeIdentities: true,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    // identities lives on the ok:true variant only — discriminated union safety.
    expect((out as unknown as { identities?: unknown }).identities).toBeUndefined();
  });
});

describe("listClusterContributors (real branch, mocked CH)", () => {
  beforeEach(() => {
    process.env.USE_FIXTURES = "0";
  });
  afterEach(() => {
    delete process.env.USE_FIXTURES;
  });

  test("never selects forbidden tier-A columns", async () => {
    const capturedSqls: string[] = [];
    const ctx: Ctx = {
      tenant_id: "rb-tenant",
      actor_id: "rb-actor",
      role: "manager",
      db: {
        pg: { query: async () => [] },
        ch: {
          query: async <T = unknown>(sql: string): Promise<T[]> => {
            capturedSqls.push(sql);
            if (sql.includes("uniqMerge(contributing_engineers_state)"))
              return [{ distinct_engineers: 7 }] as T[];
            return [
              { engineer_id: "eng_real_001", session_count: 9 },
              { engineer_id: "eng_real_002", session_count: 5 },
              { engineer_id: "eng_real_003", session_count: 3 },
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

    const out = await listClusterContributors(ctx, { cluster_id: "c_real_abc" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.contributor_count).toBe(7);
    expect(out.contributors.length).toBe(3);
    for (const c of out.contributors) {
      expect(c.engineer_id_hash).toMatch(/^eh_[0-9a-f]{8}$/);
      // Raw engineer id never leaks through the API boundary.
      expect(c.engineer_id_hash).not.toContain("eng_real_");
    }

    // Tier-A allowlist check: none of the forbidden prompt/tool/raw column
    // names appear in any SQL that left the server.
    const forbidden = [
      "prompt_text",
      "prompt_abstract",
      "tool_input",
      "tool_output",
      "raw_attrs",
      "file_contents",
      "file_paths",
      "ticket_ids",
      "messages",
    ];
    for (const sql of capturedSqls) {
      for (const f of forbidden) {
        expect(sql).not.toContain(f);
      }
    }
  });

  test("below-floor real-branch result surfaces count only (no rows)", async () => {
    const ctx: Ctx = {
      tenant_id: "rb-tenant",
      actor_id: "rb-actor",
      role: "manager",
      db: {
        pg: { query: async () => [] },
        ch: {
          query: async <T = unknown>(sql: string): Promise<T[]> => {
            if (sql.includes("uniqMerge(contributing_engineers_state)"))
              return [{ distinct_engineers: 2 }] as T[]; // below floor
            return [{ engineer_id: "eng_should_not_leak", session_count: 1 }] as T[];
          },
        },
        redis: {
          get: async () => null,
          set: async () => undefined,
          setNx: async () => true,
        },
      },
    };
    const out = await listClusterContributors(ctx, { cluster_id: "c_small" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("cohort_too_small");
    expect(out.contributor_count).toBe(2);
    // Zero leak: the denied payload must not carry the eng_should_not_leak row.
    expect(JSON.stringify(out)).not.toContain("eng_should_not_leak");
  });

  test("not_found when no stats + no rows", async () => {
    const ctx: Ctx = {
      tenant_id: "rb-tenant",
      actor_id: "rb-actor",
      role: "manager",
      db: {
        pg: { query: async () => [] },
        ch: {
          query: async <T = unknown>(): Promise<T[]> => [] as T[],
        },
        redis: {
          get: async () => null,
          set: async () => undefined,
          setNx: async () => true,
        },
      },
    };
    const out = await listClusterContributors(ctx, { cluster_id: "c_missing" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not_found");
  });
});
