import { assertRole, type Ctx } from "../auth";
import type {
  PerCommitOutcome,
  PerCommitOutcomesInput,
  PerCommitOutcomesOutput,
  PerDevOutcome,
  PerDevOutcomesInput,
  PerDevOutcomesOutput,
  PerPROutcome,
  PerPROutcomesInput,
  PerPROutcomesOutput,
} from "../schemas/outcomes";

/**
 * Per-engineer outcome aggregate for a team/window. Raw rows carry a stable
 * 8-char hash; names only render when an IC has opted in upstream. Callers
 * must also apply the k≥5 cohort floor for team-level tiles — we return
 * `cohort_size` so the UI can pick the right suppression banner.
 *
 * Fixture-backed until Jorge's `dev_daily_rollup` MV lands; swap the body,
 * keep the schema.
 */
export async function perDevOutcomes(
  ctx: Ctx,
  input: PerDevOutcomesInput,
): Promise<PerDevOutcomesOutput> {
  assertRole(ctx, ["admin", "manager", "viewer"]);

  const seed = hash(`${ctx.tenant_id}|perDev|${input.team_id ?? "_"}|${input.window}`);
  const cohortSize = 6 + (seed % 8);
  const rowCount = Math.min(cohortSize, input.limit);
  const rows: PerDevOutcome[] = [];

  for (let i = 0; i < rowCount; i++) {
    const r = (n: number) => rand(seed + i * 11, n);
    const engineerId = `dev-${(seed + i * 17).toString(16).slice(-6)}`;
    const sessions = 10 + Math.floor(r(1) * 90);
    const cost = round2(sessions * (0.25 + r(2) * 2.5));
    const accepted = Math.floor(sessions * (0.4 + r(3) * 0.5));
    const retained = Math.floor(accepted * (0.7 + r(4) * 0.28));
    const mergedPrs = Math.floor(sessions * (0.05 + r(5) * 0.12));
    const greenTests = Math.floor(sessions * (0.08 + r(6) * 0.18));
    const reverts = Math.floor(sessions * r(7) * 0.05);
    rows.push({
      engineer_id: engineerId,
      engineer_id_hash: hash8(`${ctx.tenant_id}:${engineerId}`),
      sessions,
      cost_usd: cost,
      accepted_edits: accepted,
      accepted_and_retained: retained,
      merged_prs: mergedPrs,
      green_tests: greenTests,
      reverts,
    });
  }

  rows.sort((a, b) => b.cost_usd - a.cost_usd);

  return {
    window: input.window,
    team_id: input.team_id ?? null,
    rows,
    cohort_size: cohortSize,
  };
}

/**
 * PR-level outcomes for a repo/window. The `ai_assisted` column flips true
 * when the merged commit carries the opt-in `AI-Assisted: bematist-<id>`
 * trailer (D29) OR when the PR joins through the accept-event anchor.
 *
 * Revert detection is the three-signal combiner from CLAUDE.md §Outcome
 * Attribution Rules (regex on commit msg + body marker + git revert marker);
 * we trust Jorge's worker to have set the flag upstream.
 */
export async function perPROutcomes(
  ctx: Ctx,
  input: PerPROutcomesInput,
): Promise<PerPROutcomesOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);

  const seed = hash(`${ctx.tenant_id}|perPR|${input.repo ?? "_"}|${input.window}`);
  const rowCount = Math.min(input.limit, 80);
  const repoName = input.repo ?? "acme/backend";

  const rows: PerPROutcome[] = [];
  for (let i = 0; i < rowCount; i++) {
    const r = (n: number) => rand(seed + i * 7, n);
    const reverted = r(1) < 0.04;
    const aiAssisted = r(2) < 0.68;
    const edits = aiAssisted ? 2 + Math.floor(r(3) * 22) : 0;
    rows.push({
      repo: repoName,
      pr_number: 2000 + i,
      merged_at: new Date(
        Date.UTC(2026, 3, 16, 12) - i * 60 * 60 * 1000,
      ).toISOString(),
      cost_usd: round2(aiAssisted ? 0.4 + r(4) * 6.5 : 0),
      accepted_edit_count: edits,
      reverted,
      ai_assisted: aiAssisted,
    });
  }

  const totals = rows.reduce(
    (acc, row) => {
      acc.prs += 1;
      acc.cost_usd = round2(acc.cost_usd + row.cost_usd);
      if (row.reverted) acc.reverted_prs += 1;
      if (row.ai_assisted) acc.ai_assisted_prs += 1;
      return acc;
    },
    { prs: 0, cost_usd: 0, reverted_prs: 0, ai_assisted_prs: 0 },
  );

  return {
    window: input.window,
    repo: input.repo ?? null,
    rows,
    totals,
  };
}

/**
 * Per-commit outcome rows. Fine-grained — useful for the CLI's `bematist
 * outcomes` drill-in. Author identity is always a hash; names live in `/me`
 * under the IC's own control.
 */
export async function perCommitOutcomes(
  ctx: Ctx,
  input: PerCommitOutcomesInput,
): Promise<PerCommitOutcomesOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);

  const seed = hash(
    `${ctx.tenant_id}|perCommit|${input.repo ?? "_"}|${input.window}`,
  );
  const rowCount = Math.min(input.limit, 120);
  const repoName = input.repo ?? "acme/backend";

  const rows: PerCommitOutcome[] = [];
  for (let i = 0; i < rowCount; i++) {
    const r = (n: number) => rand(seed + i * 13, n);
    const aiAssisted = r(1) < 0.55;
    rows.push({
      repo: repoName,
      commit_sha: hexSha(seed + i * 19),
      pr_number: r(2) < 0.78 ? 2000 + Math.floor(r(3) * 80) : null,
      author_engineer_id_hash: hash8(
        `${ctx.tenant_id}:${Math.floor(r(4) * 12)}`,
      ),
      ts: new Date(
        Date.UTC(2026, 3, 16, 10) - i * 30 * 60 * 1000,
      ).toISOString(),
      cost_usd_attributed: aiAssisted ? round2(0.05 + r(5) * 1.8) : 0,
      ai_assisted: aiAssisted,
      reverted: r(6) < 0.02,
    });
  }

  return {
    window: input.window,
    repo: input.repo ?? null,
    rows,
  };
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash8(s: string): string {
  return hash(s).toString(16).padStart(8, "0").slice(0, 8);
}

function hexSha(seed: number): string {
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += ((Math.imul(seed + i, 0x1b873593) >>> 0) & 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  }
  return out.slice(0, 40);
}

function rand(seed: number, n: number): number {
  const x = Math.sin(seed + n * 17.13) * 10000;
  return x - Math.floor(x);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
