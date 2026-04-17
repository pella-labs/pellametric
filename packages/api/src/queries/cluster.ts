import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import type { Cluster, ClusterListInput, ClusterListOutput } from "../schemas/cluster";

/** k≥3 contributor floor per CLAUDE.md Privacy Model Rules + Clio/OpenClio prior art. */
export const CLUSTER_CONTRIBUTOR_FLOOR = 3;

/**
 * Prompt-cluster list — powers `/clusters` Twin Finder.
 *
 * Server enforces the k≥3 floor: any cluster whose contributor_count falls
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
  const eligible = universe.filter((c) => c.contributor_count >= CLUSTER_CONTRIBUTOR_FLOOR);
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
 * EXPLAIN: `prompt_cluster_stats` MV (ORDER BY org_id, window_start,
 * cluster_id). Partition filter on `org_id` + window is mandatory. Server
 * enforces the k≥3 floor AFTER fetch so the `suppressed_below_floor` count
 * stays accurate.
 *
 * TIER-A ALLOWLIST: the MV aggregates cluster-level outcome counts only —
 * prompt_text / prompt_abstract / raw_attrs / tool_input / tool_output are
 * NEVER in SELECT. No per-session id or engineer id leaks.
 */
async function listClustersReal(ctx: Ctx, input: ClusterListInput): Promise<ClusterListOutput> {
  const days = WINDOW_DAYS[input.window];
  const limit = input.limit ?? 20;

  const clauses = ["org_id = {tenant_id:String}", "window_start >= today() - {days:UInt16}"];
  const params: Record<string, unknown> = {
    tenant_id: ctx.tenant_id,
    days,
  };
  if (input.team_id) {
    clauses.push("team_id = {team_id:String}");
    params.team_id = input.team_id;
  }
  if (input.task_category) {
    clauses.push("task_category = {task_category:String}");
    params.task_category = input.task_category;
  }

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
       any(label) AS label,
       uniqExact(engineer_id) AS contributor_count,
       sum(session_count) AS session_count,
       avg(avg_cost_usd) AS avg_cost_usd,
       sum(merged_pr_count) AS merged_pr_count,
       sum(green_test_count) AS green_test_count,
       sum(revert_count) AS revert_count,
       any(fidelity) AS fidelity
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

  // Enforce k≥3 server-side. Suppressed count is the difference.
  const eligible = universe.filter((c) => c.contributor_count >= CLUSTER_CONTRIBUTOR_FLOOR);
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
