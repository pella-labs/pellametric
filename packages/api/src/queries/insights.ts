import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import type {
  Insight,
  InsightsDigestInput,
  InsightsDigestOutput,
  PipelineInsight,
} from "../schemas/insights";

/**
 * Weekly Insight Engine output — powers `/insights`.
 *
 * Contract (CLAUDE.md AI Rules):
 *   - High-confidence insights ship.
 *   - Medium insights ship with the `"Investigate"` label.
 *   - Low-confidence insights are DROPPED server-side and never leave this
 *     function; `dropped_low_confidence` carries a count for transparency.
 *
 * The filter is the single load-bearing invariant in this query — tests
 * assert it. The fixture below includes a low-confidence entry specifically
 * so the filter is exercised.
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads Postgres `insights` table (Workstream H writer).
 *   - Otherwise (default) the deterministic fixture.
 */
export async function getWeeklyDigest(
  ctx: Ctx,
  input: InsightsDigestInput,
): Promise<InsightsDigestOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);
  if (useFixtures()) return getWeeklyDigestFixture(ctx, input);
  return getWeeklyDigestReal(ctx, input);
}

async function getWeeklyDigestFixture(
  ctx: Ctx,
  input: InsightsDigestInput,
): Promise<InsightsDigestOutput> {
  const weekLabel = input.week ?? currentWeek();
  const pipeline = buildFixturePipeline(ctx.tenant_id, weekLabel, input.team_id);

  const filtered = filterByConfidence(pipeline);

  return {
    generated_at: new Date().toISOString(),
    week_label: formatWeekLabel(weekLabel),
    insights: filtered.insights,
    dropped_low_confidence: filtered.dropped,
  };
}

/**
 * Real-branch Postgres read. Stubbed to empty until the query columns are
 * re-aligned with the actual `insights` schema. Real table has
 * (`id`, `ts`, `org_id`, `team_id`, `week`, `body_json`, `confidence`) —
 * no `title` / `body` / `subject_kind` / `citations` / `generated_at`
 * columns, and `week` is the label column (not `week_label`). Tracked as
 * an M4 follow-up — the insight writer (Workstream H) will reshape this
 * when it lands.
 */
async function getWeeklyDigestReal(
  _ctx: Ctx,
  input: InsightsDigestInput,
): Promise<InsightsDigestOutput> {
  const weekLabel = input.week ?? currentWeek();
  return {
    generated_at: new Date().toISOString(),
    week_label: formatWeekLabel(weekLabel),
    insights: [],
    dropped_low_confidence: 0,
  };
}

/**
 * Load-bearing filter. Extracted so tests can exercise it directly without
 * plumbing a full Ctx.
 */
export function filterByConfidence(pipeline: PipelineInsight[]): {
  insights: Insight[];
  dropped: number;
} {
  const kept: Insight[] = [];
  let dropped = 0;
  for (const p of pipeline) {
    if (p.confidence === "low") {
      dropped += 1;
      continue;
    }
    // narrow: pipeline Confidence → wire WireConfidence
    kept.push({ ...p, confidence: p.confidence });
  }
  return { insights: kept, dropped };
}

function buildFixturePipeline(
  tenant: string,
  weekLabel: string,
  teamId: string | undefined,
): PipelineInsight[] {
  const seed = hash(`${tenant}:${weekLabel}:${teamId ?? ""}`);
  return [
    {
      id: `insight_${seed.toString(16).slice(0, 8)}_1`,
      title: "Cluster 'react component state refactor' accelerated merges",
      body: "Engineers whose sessions landed in the react-state-refactor cluster merged PRs 2.1× faster than the team median this week. Twelve sessions across four engineers; four merged PRs cited.",
      confidence: "high",
      subject_kind: "efficiency",
      citations: [
        { kind: "cluster", id: "cluster_001", label: "react component state refactor" },
        { kind: "session", id: "sess_01HXZK9M1C5P4W", label: "session 01HXZ…4W" },
      ],
    },
    {
      id: `insight_${seed.toString(16).slice(0, 8)}_2`,
      title: "Ci pipeline failures cluster shows elevated retry loops",
      body: "Sessions in the ci-pipeline-failures cluster averaged 4.2× more tool-call retries than the week-over-week baseline. No revert spike yet — investigating whether CI flakes or engineer behavior drives the pattern.",
      confidence: "medium",
      subject_kind: "waste",
      citations: [{ kind: "cluster", id: "cluster_005", label: "ci pipeline failures" }],
    },
    {
      id: `insight_${seed.toString(16).slice(0, 8)}_3`,
      title: "Docker build optimization promoted to playbook",
      body: "One engineer promoted their docker-build-optimization workflow as a team playbook; three other engineers' sessions have since landed in the same cluster. Early adoption signal; Team Impact subscore updated.",
      confidence: "high",
      subject_kind: "team_impact",
      citations: [{ kind: "cluster", id: "cluster_004", label: "docker build optimization" }],
    },
    // Low-confidence entry — MUST be filtered server-side. Tests assert this.
    {
      id: `insight_${seed.toString(16).slice(0, 8)}_low`,
      title: "Potential autonomy regression (suppressed — low confidence)",
      body: "Signals were noisy. The server drops this before the wire; it should never reach the client.",
      confidence: "low",
      subject_kind: "adoption",
      citations: [],
    },
  ];
}

function currentWeek(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const diffDays = Math.floor((d.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.max(1, Math.ceil((diffDays + start.getUTCDay() + 1) / 7));
  return `${year}-W${week.toString().padStart(2, "0")}`;
}

function formatWeekLabel(week: string): string {
  return `Week ${week}`;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
