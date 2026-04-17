import { assertRole, type Ctx } from "../auth";
import type {
  Cluster,
  ClusterListInput,
  ClusterListOutput,
} from "../schemas/cluster";

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
 * Fixture-backed until Jorge's `prompt_cluster_stats` MV + H-AI labeler land.
 */
export async function listClusters(
  ctx: Ctx,
  input: ClusterListInput,
): Promise<ClusterListOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);

  const seed = hash(`${ctx.tenant_id}:${input.window}:${input.team_id ?? ""}:${input.task_category ?? ""}`);
  const limit = input.limit ?? 20;

  // Build a fixture universe of clusters, then apply the contributor floor.
  const universe = buildFixtureUniverse(seed);
  const eligible = universe.filter(
    (c) => c.contributor_count >= CLUSTER_CONTRIBUTOR_FLOOR,
  );
  const suppressed = universe.length - eligible.length;

  return {
    window: input.window,
    team_id: input.team_id ?? null,
    task_category: input.task_category ?? null,
    clusters: eligible.slice(0, limit),
    suppressed_below_floor: suppressed,
  };
}

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
