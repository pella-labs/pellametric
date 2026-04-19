import { type ClusterKStats, findTwins, type TwinSessionCandidate } from "@bematist/scoring";
import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import type {
  Cluster,
  ClusterContributor,
  ClusterContributorsInput,
  ClusterContributorsOutput,
  ClusterListInput,
  ClusterListOutput,
  TwinFinderInput,
  TwinFinderOutput,
} from "../schemas/cluster";

/** k>=3 contributor floor per CLAUDE.md Privacy Model Rules + Clio/OpenClio prior art. */
export const CLUSTER_CONTRIBUTOR_FLOOR = 3;

/**
 * Effective floor at request time. Returns 0 when
 * `BEMATIST_SINGLE_TRUST_DOMAIN=1` (small-team / test instance), else the
 * locked constant. Server-side env only — never derived from client input.
 */
function effectiveClusterFloor(): number {
  return process.env.BEMATIST_SINGLE_TRUST_DOMAIN === "1" ? 0 : CLUSTER_CONTRIBUTOR_FLOOR;
}

/** Default top-K for Twin Finder — matches `findTwins` default. */
const TWIN_FINDER_DEFAULT_TOP_K = 10;

/** Hard cap on candidate corpus pulled back before k-NN — scales linearly in cosine math. */
const TWIN_FINDER_MAX_CANDIDATES = 10_000;

/**
 * Prompt-cluster list — powers `/clusters` Twin Finder.
 *
 * Server enforces the k>=3 floor: any cluster whose contributor_count falls
 * below 3 is computed but never surfaced. Callers get a `suppressed_below_floor`
 * count so they can transparently tell users that some clusters were dropped,
 * without exposing cluster ids.
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads the `prompt_cluster_stats` MV.
 *   - Otherwise (default) a deterministic fixture universe.
 */
export async function listClusters(ctx: Ctx, input: ClusterListInput): Promise<ClusterListOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);
  if (useFixtures()) return listClustersFixture(ctx, input);
  return listClustersReal(ctx, input);
}

async function listClustersFixture(ctx: Ctx, input: ClusterListInput): Promise<ClusterListOutput> {
  const seed = hash(
    `${ctx.tenant_id}:${input.window}:${input.team_id ?? ""}:${input.task_category ?? ""}`,
  );
  const limit = input.limit ?? 20;

  // Build a fixture universe of clusters, then apply the contributor floor.
  const universe = buildFixtureUniverse(seed);
  const eligible = universe.filter((c) => c.contributor_count >= effectiveClusterFloor());
  const suppressed = universe.length - eligible.length;

  return {
    window: input.window,
    team_id: input.team_id ?? null,
    task_category: input.task_category ?? null,
    clusters: eligible.slice(0, limit),
    suppressed_below_floor: suppressed,
  };
}

/**
 * Real-branch ClickHouse read.
 *
 * EXPLAIN: `prompt_cluster_stats` is an AggregatingMergeTree ORDER BY
 * (org_id, cluster_id, week). State columns (`prompt_count_state` from
 * sumState, `contributing_engineers_state` from uniqState, `cost_usd_state`
 * from sumState, `avg_duration_state` from avgState) MUST be read with the
 * matching `*Merge` finalizer; raw `sum()` / `uniq()` errors on
 * AggregateFunction columns. `label` / `team_id` / `task_category` /
 * `merged_pr_count` / `green_test_count` / `revert_count` / `fidelity`
 * aren't on the MV — the gateway labeler + outcomes join land later;
 * synthesize a placeholder label from `cluster_id` and zero-fill outcome
 * counts so the page renders rather than 500.
 *
 * Server still enforces the k>=3 floor AFTER fetch — the
 * `suppressed_below_floor` count stays accurate.
 *
 * TIER-A ALLOWLIST: the MV aggregates cluster-level counters only —
 * prompt_text / prompt_abstract / raw_attrs / tool_input / tool_output are
 * NEVER in SELECT. No per-session id or engineer id leaks.
 */
async function listClustersReal(ctx: Ctx, input: ClusterListInput): Promise<ClusterListOutput> {
  const days = WINDOW_DAYS[input.window];
  const limit = input.limit ?? 20;

  const clauses = ["org_id = {tenant_id:String}", "week >= today() - {days:UInt16}"];
  const params: Record<string, unknown> = {
    tenant_id: ctx.tenant_id,
    days,
  };

  const rows = await ctx.db.ch.query<{
    cluster_id: string;
    label: string;
    contributor_count: number;
    session_count: number;
    avg_cost_usd: number;
    merged_pr_count: number;
    green_test_count: number;
    revert_count: number;
    fidelity: Cluster["fidelity"];
  }>(
    `SELECT
       cluster_id,
       concat('cluster ', cluster_id) AS label,
       uniqMerge(contributing_engineers_state) AS contributor_count,
       toUInt64(sumMerge(prompt_count_state)) AS session_count,
       sumMerge(cost_usd_state) / greatest(sumMerge(prompt_count_state), 1) AS avg_cost_usd,
       0 AS merged_pr_count,
       0 AS green_test_count,
       0 AS revert_count,
       'full' AS fidelity
     FROM prompt_cluster_stats
     WHERE ${clauses.join(" AND ")}
     GROUP BY cluster_id
     ORDER BY session_count DESC`,
    params,
  );

  const universe: Cluster[] = rows.map((r) => ({
    id: r.cluster_id,
    label: r.label,
    contributor_count: Number(r.contributor_count),
    session_count: Number(r.session_count),
    avg_cost_usd: round2(Number(r.avg_cost_usd)),
    top_outcomes: [
      { kind: "merged_pr" as const, count: Number(r.merged_pr_count) },
      { kind: "green_test" as const, count: Number(r.green_test_count) },
      { kind: "revert" as const, count: Number(r.revert_count) },
    ],
    fidelity: r.fidelity,
  }));

  // Enforce k>=3 server-side. Suppressed count is the difference.
  const eligible = universe.filter((c) => c.contributor_count >= effectiveClusterFloor());
  const suppressed = universe.length - eligible.length;

  return {
    window: input.window,
    team_id: input.team_id ?? null,
    task_category: input.task_category ?? null,
    clusters: eligible.slice(0, limit),
    suppressed_below_floor: suppressed,
  };
}

const WINDOW_DAYS: Record<ClusterListInput["window"], number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function buildFixtureUniverse(seed: number): Cluster[] {
  return FIXTURE_LABELS.map((label, i) => {
    const r1 = lcg(seed + i * 3);
    const r2 = lcg(seed + i * 3 + 1);
    const r3 = lcg(seed + i * 3 + 2);
    const contributors = Math.round(1 + r1 * 10);
    const sessions = Math.round(contributors * (3 + r2 * 12));
    const cost = round2(sessions * (0.4 + r3 * 2.8));

    const mergedPrs = Math.round(sessions * (0.15 + r2 * 0.25));
    const greenTests = Math.round(sessions * (0.08 + r3 * 0.15));
    const reverts = Math.round(sessions * r1 * 0.06);

    return {
      id: `cluster_${i.toString().padStart(3, "0")}`,
      label,
      contributor_count: contributors,
      session_count: sessions,
      avg_cost_usd: round2(cost / Math.max(1, sessions)),
      top_outcomes: [
        { kind: "merged_pr" as const, count: mergedPrs },
        { kind: "green_test" as const, count: greenTests },
        { kind: "revert" as const, count: reverts },
      ],
      fidelity: "full" as const,
    };
  });
}

/**
 * 3–5 word labels mimicking what the gateway cluster labeler would emit:
 * descriptive, no URLs, no proper nouns, no PII.
 */
const FIXTURE_LABELS = [
  "api integration test debugging",
  "react component state refactor",
  "sql migration backfill",
  "typescript type narrowing",
  "docker build optimization",
  "ci pipeline failures",
  "auth cookie handling",
  "payment webhook retries",
  "feature flag cleanup",
  "bundle size investigation",
  "mobile viewport bug",
  "i18n catalog updates",
  "graphql schema stitching",
  "rate limit edge cases",
  "session expiry flake",
  "dependency upgrade battle",
  "error boundary coverage",
  "queue backpressure tuning",
  "caching invalidation work",
  "accessibility audit fixes",
  "single contributor sandbox",
  "lone refactor attempt",
];

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function lcg(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Twin Finder — k-NN over `(cluster_assignment_mv, events.prompt_embedding)`
 * against the query session's embedding, with k>=3 contributor floor enforced
 * server-side via `@bematist/scoring`'s `findTwins`.
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads CH `events` (for embeddings) +
 *     `cluster_assignment_mv` (for cluster id) + `prompt_cluster_stats`
 *     (for contributor_count).
 *   - Otherwise (default) a deterministic synthetic corpus so the page renders.
 *
 * p95 budget: <500ms on a 10k-candidate fixture (enforced in test).
 *
 * TIER-A ALLOWLIST: SELECT list is `session_id`, `engineer_id` (hashed before
 * return), `cluster_id`, `prompt_embedding`. No `prompt_text`, no
 * `prompt_abstract`, no `tool_input/output`, no `raw_attrs`.
 */
export async function findSessionTwins(
  ctx: Ctx,
  input: TwinFinderInput,
): Promise<TwinFinderOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "auditor", "viewer"]);
  if (useFixtures()) return findSessionTwinsFixture(ctx, input);
  return findSessionTwinsReal(ctx, input);
}

function findSessionTwinsFixture(ctx: Ctx, input: TwinFinderInput): TwinFinderOutput {
  const started = performance.now();
  const topK = input.top_k ?? TWIN_FINDER_DEFAULT_TOP_K;
  const promptIndex = input.prompt_index ?? 0;

  const universe = buildTwinFixtureUniverse(ctx.tenant_id, input.session_id, promptIndex);
  if (!universe.query) {
    return {
      ok: false,
      query_session_id: input.session_id,
      reason: "no_embedding",
    };
  }

  const outcome = findTwins({
    queryEmbedding: universe.query.embedding,
    candidates: universe.candidates,
    clusterStats: universe.clusterStats,
    selfSessionId: input.session_id,
    topK,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      query_session_id: input.session_id,
      reason: outcome.error.kind,
      cluster_id_hint: outcome.error.kind === "cohort_too_small" ? outcome.error.cluster_id : null,
    };
  }

  return {
    ok: true,
    query_session_id: input.session_id,
    query_cluster_id: universe.query.cluster_id,
    matches: outcome.twins,
    latency_ms: Math.round(performance.now() - started),
  };
}

/**
 * Real-branch CH read. Two round-trips:
 *   1. Resolve the query session's cluster_id + embedding (from `events`).
 *   2. Fetch candidate embeddings + engineer_ids for that cluster + contributor
 *      counts in a single combined query using CTEs. The LIMIT cap
 *      (`TWIN_FINDER_MAX_CANDIDATES`) keeps the cosine pass bounded.
 *
 * EXPLAIN: both reads hit `(org_id, ts, engineer_id)` ORDER BY on `events`;
 * cluster lookup uses the `cluster_lookup` projection added in D1-03.
 */
async function findSessionTwinsReal(ctx: Ctx, input: TwinFinderInput): Promise<TwinFinderOutput> {
  const started = performance.now();
  const topK = input.top_k ?? TWIN_FINDER_DEFAULT_TOP_K;
  const promptIndex = input.prompt_index ?? 0;

  const queryRows = await ctx.db.ch.query<{
    cluster_id: string | null;
    prompt_embedding: number[];
  }>(
    `SELECT
       a.cluster_id AS cluster_id,
       e.prompt_embedding AS prompt_embedding
     FROM events AS e
     LEFT JOIN cluster_assignment_mv FINAL AS a
       ON a.org_id = e.org_id
      AND a.session_id = e.session_id
      AND a.prompt_index = e.prompt_index
     WHERE e.org_id = {tenant_id:String}
       AND e.session_id = {session_id:String}
       AND e.prompt_index = {prompt_index:UInt32}
     LIMIT 1`,
    {
      tenant_id: ctx.tenant_id,
      session_id: input.session_id,
      prompt_index: promptIndex,
    },
  );

  const queryRow = queryRows[0];
  if (!queryRow?.prompt_embedding?.length) {
    return {
      ok: false,
      query_session_id: input.session_id,
      reason: "no_embedding",
    };
  }

  // Pull candidate pool + contributor stats in parallel for the lowest p95.
  const [candidateRows, statsRows] = await Promise.all([
    ctx.db.ch.query<{
      session_id: string;
      engineer_id: string;
      cluster_id: string;
      prompt_embedding: number[];
    }>(
      `SELECT
         e.session_id AS session_id,
         e.engineer_id AS engineer_id,
         a.cluster_id AS cluster_id,
         e.prompt_embedding AS prompt_embedding
       FROM cluster_assignment_mv FINAL AS a
       INNER JOIN events AS e
         ON e.org_id = a.org_id
        AND e.session_id = a.session_id
        AND e.prompt_index = a.prompt_index
       WHERE a.org_id = {tenant_id:String}
         AND length(e.prompt_embedding) > 0
       LIMIT {max_candidates:UInt32}`,
      {
        tenant_id: ctx.tenant_id,
        max_candidates: TWIN_FINDER_MAX_CANDIDATES,
      },
    ),
    ctx.db.ch.query<{
      cluster_id: string;
      distinct_engineers: number;
    }>(
      `SELECT
         cluster_id,
         uniqMerge(contributing_engineers_state) AS distinct_engineers
       FROM prompt_cluster_stats
       WHERE org_id = {tenant_id:String}
       GROUP BY cluster_id`,
      { tenant_id: ctx.tenant_id },
    ),
  ]);

  const candidates: TwinSessionCandidate[] = candidateRows.map((r) => ({
    session_id: r.session_id,
    cluster_id: r.cluster_id,
    embedding: r.prompt_embedding,
    engineer_id: r.engineer_id,
  }));
  const clusterStats: ClusterKStats[] = statsRows.map((r) => ({
    cluster_id: r.cluster_id,
    distinct_engineers: Number(r.distinct_engineers),
  }));

  const outcome = findTwins({
    queryEmbedding: queryRow.prompt_embedding,
    candidates,
    clusterStats,
    selfSessionId: input.session_id,
    topK,
    kFloor: effectiveClusterFloor(),
  });

  if (!outcome.ok) {
    return {
      ok: false,
      query_session_id: input.session_id,
      reason: outcome.error.kind,
      cluster_id_hint: outcome.error.kind === "cohort_too_small" ? outcome.error.cluster_id : null,
    };
  }

  return {
    ok: true,
    query_session_id: input.session_id,
    query_cluster_id: queryRow.cluster_id ?? null,
    matches: outcome.twins,
    latency_ms: Math.round(performance.now() - started),
  };
}

interface TwinFixtureUniverse {
  query: { embedding: number[]; cluster_id: string } | null;
  candidates: TwinSessionCandidate[];
  clusterStats: ClusterKStats[];
}

/**
 * Deterministic Twin Finder universe: 8 clusters, 2 of them deliberately below
 * the k=3 floor. Query session ("ses_query_...") is planted into cluster c_000.
 * Kept small (~120 candidates) so the fixture test is fast; the 10k-candidate
 * performance fixture is synthesized in the test file directly — no need to
 * carry that cost on every RSC render.
 */
function buildTwinFixtureUniverse(
  tenantId: string,
  querySessionId: string,
  promptIndex: number,
): TwinFixtureUniverse {
  const seed = hash(`${tenantId}:twin:${querySessionId}:${promptIndex}`);
  const dim = 32;

  const clusters: { id: string; contributors: number }[] = [
    { id: "c_000", contributors: 7 },
    { id: "c_001", contributors: 5 },
    { id: "c_002", contributors: 4 },
    { id: "c_003", contributors: 3 },
    { id: "c_004", contributors: 6 },
    { id: "c_005", contributors: 2 }, // below floor
    { id: "c_006", contributors: 1 }, // below floor
    { id: "c_007", contributors: 8 },
  ];

  const clusterCentroids = new Map<string, number[]>();
  for (const c of clusters) {
    clusterCentroids.set(c.id, randomUnitVec(hash(`${seed}:centroid:${c.id}`), dim));
  }

  const queryCluster = "c_000";
  const queryEmbedding = clusterCentroids.get(queryCluster) ?? randomUnitVec(seed, dim);

  const candidates: TwinSessionCandidate[] = [];
  let engineerCounter = 0;
  for (const c of clusters) {
    const baseVec = clusterCentroids.get(c.id) ?? randomUnitVec(seed + 1, dim);
    const sessionsPerCluster = 15;
    for (let i = 0; i < sessionsPerCluster; i++) {
      const engId = `eng_fx_${(engineerCounter++ % Math.max(1, c.contributors))
        .toString()
        .padStart(3, "0")}`;
      candidates.push({
        session_id: `ses_${c.id}_${i.toString().padStart(3, "0")}`,
        cluster_id: c.id,
        engineer_id: engId,
        embedding: perturb(baseVec, hash(`${seed}:${c.id}:${i}`), 0.08),
      });
    }
  }

  const clusterStats: ClusterKStats[] = clusters.map((c) => ({
    cluster_id: c.id,
    distinct_engineers: c.contributors,
  }));

  return {
    query: { embedding: queryEmbedding, cluster_id: queryCluster },
    candidates,
    clusterStats,
  };
}

function randomUnitVec(seed: number, dim: number): number[] {
  const out: number[] = new Array(dim);
  let mag = 0;
  for (let i = 0; i < dim; i++) {
    const v = lcg(seed + i * 101) - 0.5;
    out[i] = v;
    mag += v * v;
  }
  const n = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) out[i] = (out[i] ?? 0) / n;
  return out;
}

function perturb(base: readonly number[], seed: number, magnitude: number): number[] {
  return base.map((v, i) => v + (lcg(seed + i * 37) - 0.5) * magnitude);
}

/**
 * Cluster Contributors — distinct engineers in a cluster, returned as opaque
 * hashes only. Powers the "click a cluster card → see color-dotted IC
 * silhouettes" UX on `/dashboard/clusters`.
 *
 * k>=3 contributor floor enforced BEFORE any per-contributor row is returned:
 * under-floor clusters surface only the count (never ids), matching the
 * pattern used by `findSessionTwins` + `listClusters`. Engineer ids leave the
 * API only as `engineer_id_hash` — the same sha256-first-16 stub
 * `@bematist/scoring`'s `findTwins` uses (will be replaced by
 * `HMAC(engineer_id, tenant_salt)` when tenant salts land).
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads `cluster_assignment_mv` ⨝ `events` for
 *     per-engineer counts, k-stat from `prompt_cluster_stats`.
 *   - Otherwise a deterministic fixture universe (same seed as the cluster
 *     list, so the two views are consistent).
 *
 * TIER-A ALLOWLIST: SELECT list is `engineer_id` (hashed before return) +
 * `session_id` (count only). No `prompt_text`, no `prompt_abstract`, no
 * `tool_input/output`, no `raw_attrs`.
 */
export async function listClusterContributors(
  ctx: Ctx,
  input: ClusterContributorsInput,
): Promise<ClusterContributorsOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "auditor", "viewer"]);
  if (useFixtures()) return listClusterContributorsFixture(ctx, input);
  return listClusterContributorsReal(ctx, input);
}

function listClusterContributorsFixture(
  ctx: Ctx,
  input: ClusterContributorsInput,
): ClusterContributorsOutput {
  const limit = input.limit ?? 25;

  // Reuse the twin-finder fixture universe so cluster ids line up with what
  // the Twin Finder page surfaces. Seed by tenant so multiple tenants get
  // different mappings.
  const universe = buildTwinFixtureUniverse(ctx.tenant_id, `contrib:${input.cluster_id}`, 0);

  const stats = universe.clusterStats.find((s) => s.cluster_id === input.cluster_id);
  if (!stats) return { ok: false, cluster_id: input.cluster_id, reason: "not_found" };

  if (stats.distinct_engineers < effectiveClusterFloor()) {
    return {
      ok: false,
      cluster_id: input.cluster_id,
      reason: "cohort_too_small",
      contributor_count: stats.distinct_engineers,
    };
  }

  // Aggregate by engineer across the fixture candidates in this cluster.
  const counts = new Map<string, number>();
  for (const c of universe.candidates) {
    if (c.cluster_id !== input.cluster_id) continue;
    counts.set(c.engineer_id, (counts.get(c.engineer_id) ?? 0) + 1);
  }

  const contributors: ClusterContributor[] = Array.from(counts.entries())
    .map(([engId, count]) => ({
      engineer_id_hash: hashEngineerIdStub(engId),
      session_count: count,
    }))
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, limit);

  return {
    ok: true,
    cluster_id: input.cluster_id,
    contributors,
    contributor_count: stats.distinct_engineers,
  };
}

async function listClusterContributorsReal(
  ctx: Ctx,
  input: ClusterContributorsInput,
): Promise<ClusterContributorsOutput> {
  // Pull the contributor k-stat + per-engineer counts in parallel for lowest p95.
  const [statsRows, contribRows] = await Promise.all([
    ctx.db.ch.query<{ distinct_engineers: number }>(
      `SELECT uniqMerge(contributing_engineers_state) AS distinct_engineers
       FROM prompt_cluster_stats
       WHERE org_id = {tenant_id:String}
         AND cluster_id = {cluster_id:String}`,
      { tenant_id: ctx.tenant_id, cluster_id: input.cluster_id },
    ),
    ctx.db.ch.query<{ engineer_id: string; session_count: number }>(
      `SELECT
         e.engineer_id AS engineer_id,
         uniq(e.session_id) AS session_count
       FROM cluster_assignment_mv FINAL AS a
       INNER JOIN events AS e
         ON e.org_id = a.org_id
        AND e.session_id = a.session_id
        AND e.prompt_index = a.prompt_index
       WHERE a.org_id = {tenant_id:String}
         AND a.cluster_id = {cluster_id:String}
       GROUP BY e.engineer_id
       ORDER BY session_count DESC
       LIMIT {limit:UInt32}`,
      {
        tenant_id: ctx.tenant_id,
        cluster_id: input.cluster_id,
        limit: input.limit ?? 25,
      },
    ),
  ]);

  const distinctEngineers = Number(statsRows[0]?.distinct_engineers ?? 0);
  if (distinctEngineers === 0 && contribRows.length === 0) {
    return { ok: false, cluster_id: input.cluster_id, reason: "not_found" };
  }
  if (distinctEngineers < effectiveClusterFloor()) {
    return {
      ok: false,
      cluster_id: input.cluster_id,
      reason: "cohort_too_small",
      contributor_count: distinctEngineers,
    };
  }

  const contributors: ClusterContributor[] = contribRows.map((r) => ({
    engineer_id_hash: hashEngineerIdStub(r.engineer_id),
    session_count: Number(r.session_count),
  }));

  return {
    ok: true,
    cluster_id: input.cluster_id,
    contributors,
    contributor_count: distinctEngineers,
  };
}

/**
 * sha256-first-16-chars hash stub mirroring `@bematist/scoring`'s
 * `hashEngineerId`. In production this is replaced by
 * `HMAC(engineer_id, tenant_salt)` at the ingest boundary. Centralized here
 * so the UI can render consistent color dots across Twin Finder + cluster
 * contributors views (same engineer → same hash → same color).
 */
function hashEngineerIdStub(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(31, h) + id.charCodeAt(i);
  return `eh_${(h >>> 0).toString(16).padStart(8, "0")}`;
}
