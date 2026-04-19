import { assertRole, type Ctx } from "../../auth";
import { useFixtures } from "../../env";
import type {
  CodeDeliveryInput,
  CodeDeliveryOutput,
  PrByAuthor,
  PrByRepo,
  PrListItem,
  SizeDistribution,
  WeeklyThroughputPoint,
} from "../../schemas/new-dashboard";
import { hash8, round2, seededRand, seedFromString, WINDOW_DAYS } from "./_shared";

const AUTHOR_COHORT_FLOOR = 5;

export async function codeDelivery(
  ctx: Ctx,
  input: CodeDeliveryInput,
): Promise<CodeDeliveryOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);
  if (useFixtures()) return codeDeliveryFixture(ctx, input);
  return codeDeliveryReal(ctx, input);
}

async function codeDeliveryFixture(
  ctx: Ctx,
  input: CodeDeliveryInput,
): Promise<CodeDeliveryOutput> {
  const days = WINDOW_DAYS[input.window];
  const seed = seedFromString(`${ctx.tenant_id}|delivery|${input.window}`);
  const opened = 15 + Math.floor(seededRand(seed, 1) * 25);
  const merged = Math.round(opened * 0.85);
  const closed = Math.round(opened * 0.08);
  const openNow = Math.max(0, opened - merged - closed);

  const weeks: WeeklyThroughputPoint[] = [];
  const weekCount = Math.max(1, Math.ceil(days / 7));
  for (let w = 0; w < weekCount; w++) {
    const o = Math.round(opened / weekCount + (seededRand(seed, 200 + w) - 0.5) * 4);
    const m = Math.round(o * 0.85);
    weeks.push({
      week: weekLabel(w, weekCount),
      opened: Math.max(0, o),
      merged: Math.max(0, m),
      closed: Math.max(0, Math.round(o * 0.08)),
    });
  }

  const size_distribution: SizeDistribution = {
    xs: Math.round(opened * 0.3),
    s: Math.round(opened * 0.35),
    m: Math.round(opened * 0.2),
    l: Math.round(opened * 0.1),
    xl: Math.max(0, opened - Math.round(opened * 0.95)),
  };

  const repoNames = ["pella-labs/bematist", "pella-labs/pharos", "pella-labs/grammata"];
  const pr_by_repo: PrByRepo[] = repoNames.map((full_name, i) => {
    const share = [0.7, 0.2, 0.1][i] ?? 0.05;
    const o = Math.round(opened * share);
    return {
      full_name,
      opened: o,
      merged: Math.round(o * 0.85),
      closed: Math.round(o * 0.08),
      open_now: Math.max(0, o - Math.round(o * 0.93)),
      median_ttm_hours: round2(0.3 + seededRand(seed, 300 + i) * 2),
    };
  });

  const authorCount = 5;
  const pr_by_author: PrByAuthor[] = [];
  for (let i = 0; i < authorCount; i++) {
    const share = 1 / authorCount + (seededRand(seed, 400 + i) - 0.5) * 0.15;
    const o = Math.max(1, Math.round(opened * share));
    pr_by_author.push({
      author_hash: hash8(`${ctx.tenant_id}:fx-author-${i}`),
      opened: o,
      merged: Math.round(o * 0.85),
      revert_count: Math.round(o * 0.02),
    });
  }

  const recent_prs: PrListItem[] = [];
  for (let i = 0; i < 25; i++) {
    const mergedAt = new Date(Date.now() - i * 3 * 60 * 60 * 1000);
    const opened_at = new Date(mergedAt.getTime() - (0.3 + seededRand(seed, 500 + i)) * 3600_000);
    recent_prs.push({
      full_name: repoNames[i % repoNames.length] ?? "pella-labs/bematist",
      pr_number: 200 - i,
      state: "merged",
      opened_at: opened_at.toISOString(),
      merged_at: mergedAt.toISOString(),
      additions: 10 + Math.round(seededRand(seed, 600 + i) * 400),
      deletions: Math.round(seededRand(seed, 700 + i) * 120),
      changed_files: 1 + Math.round(seededRand(seed, 800 + i) * 8),
      author_hash: hash8(`${ctx.tenant_id}:fx-author-${i % authorCount}`),
      head_ref: `feature/x-${i}`,
      base_ref: "main",
    });
  }

  return {
    pr_kpis: {
      opened,
      merged,
      closed,
      open_now: openNow,
      first_try_pct: 0.82,
      revert_pct: 0.02,
    },
    merge_latency: {
      median_hours: 0.45,
      p50: 0.45,
      p90: 4.8,
      p99: 28.3,
    },
    weekly_throughput: weeks,
    size_distribution,
    pr_by_repo,
    pr_by_author,
    commits_without_pr: Math.round(opened * 0.15),
    recent_prs,
    cost_per_merged_pr: round2(42 + seededRand(seed, 999) * 20),
    cohort_gated: false,
    updated_at: new Date().toISOString(),
  };
}

async function codeDeliveryReal(
  ctx: Ctx,
  input: CodeDeliveryInput,
): Promise<CodeDeliveryOutput> {
  const days = WINDOW_DAYS[input.window];
  const authorGateRequested = !isJustMe(ctx, input);

  const base = await ctx.db.pg.query<{
    state: string;
    opened_at: string;
    merged_at: string | null;
    closed_at: string | null;
    additions: number;
    deletions: number;
    changed_files: number;
    head_ref: string;
    base_ref: string;
    pr_number: number;
    merge_minutes: number | null;
    full_name: string;
    author_login_hash: string;
  }>(
    `SELECT
       pr.state,
       pr.opened_at::text AS opened_at,
       pr.merged_at::text AS merged_at,
       pr.closed_at::text AS closed_at,
       pr.additions,
       pr.deletions,
       pr.changed_files,
       pr.head_ref,
       pr.base_ref,
       pr.pr_number,
       CASE WHEN pr.merged_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (pr.merged_at - pr.opened_at))/60
            ELSE NULL END AS merge_minutes,
       coalesce(r.full_name, '?') AS full_name,
       encode(pr.author_login_hash, 'hex') AS author_login_hash
     FROM github_pull_requests pr
     LEFT JOIN repos r ON r.id = pr.repo_id
     WHERE pr.tenant_id = $1
       AND pr.opened_at >= now() - ($2 || ' days')::interval`,
    [ctx.tenant_id, String(days)],
  );

  const opened = base.length;
  const merged = base.filter((r) => r.state === "merged").length;
  const closed = base.filter((r) => r.state === "closed").length;
  const open_now = base.filter((r) => r.state === "open").length;

  const ttms = base
    .map((r) => r.merge_minutes)
    .filter((m): m is number => m != null)
    .map((m) => m / 60);
  const p = (xs: number[], q: number) => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return round2(sorted[idx] ?? 0);
  };
  const merge_latency = {
    median_hours: p(ttms, 0.5),
    p50: p(ttms, 0.5),
    p90: p(ttms, 0.9),
    p99: p(ttms, 0.99),
  };

  const byRepo = new Map<string, PrByRepo>();
  for (const r of base) {
    const key = r.full_name;
    const entry =
      byRepo.get(key) ??
      ({
        full_name: key,
        opened: 0,
        merged: 0,
        closed: 0,
        open_now: 0,
        median_ttm_hours: null,
      } satisfies PrByRepo);
    entry.opened += 1;
    if (r.state === "merged") entry.merged += 1;
    else if (r.state === "closed") entry.closed += 1;
    else entry.open_now += 1;
    byRepo.set(key, entry);
  }
  // Compute median-ttm per repo.
  for (const [key, entry] of byRepo) {
    const mins = base
      .filter((r) => r.full_name === key && r.merge_minutes != null)
      .map((r) => (r.merge_minutes as number) / 60);
    entry.median_ttm_hours = p(mins, 0.5);
  }
  const pr_by_repo = [...byRepo.values()].sort((a, b) => b.opened - a.opened);

  const byAuthor = new Map<string, PrByAuthor>();
  for (const r of base) {
    const key = r.author_login_hash.slice(0, 8);
    const entry =
      byAuthor.get(key) ??
      ({ author_hash: key, opened: 0, merged: 0, revert_count: 0 } satisfies PrByAuthor);
    entry.opened += 1;
    if (r.state === "merged") entry.merged += 1;
    byAuthor.set(key, entry);
  }
  const allAuthors = [...byAuthor.values()].sort((a, b) => b.opened - a.opened);
  const distinctAuthorCount = allAuthors.length;
  const cohort_gated =
    authorGateRequested && distinctAuthorCount > 0 && distinctAuthorCount < AUTHOR_COHORT_FLOOR;
  const pr_by_author = cohort_gated ? [] : allAuthors;

  const weekly = new Map<string, WeeklyThroughputPoint>();
  for (const r of base) {
    const iso = isoWeek(new Date(r.opened_at));
    const w =
      weekly.get(iso) ??
      ({ week: iso, opened: 0, merged: 0, closed: 0 } satisfies WeeklyThroughputPoint);
    w.opened += 1;
    if (r.state === "merged") w.merged += 1;
    else if (r.state === "closed") w.closed += 1;
    weekly.set(iso, w);
  }
  const weekly_throughput = [...weekly.values()].sort((a, b) => (a.week < b.week ? -1 : 1));

  const size_distribution: SizeDistribution = { xs: 0, s: 0, m: 0, l: 0, xl: 0 };
  for (const r of base) {
    const delta = (r.additions ?? 0) + (r.deletions ?? 0);
    if (delta < 10) size_distribution.xs += 1;
    else if (delta < 100) size_distribution.s += 1;
    else if (delta < 500) size_distribution.m += 1;
    else if (delta < 1000) size_distribution.l += 1;
    else size_distribution.xl += 1;
  }

  const recent_prs: PrListItem[] = [...base]
    .sort((a, b) => {
      const ax = new Date(a.merged_at ?? a.opened_at).getTime();
      const bx = new Date(b.merged_at ?? b.opened_at).getTime();
      return bx - ax;
    })
    .slice(0, 25)
    .map((r) => ({
      full_name: r.full_name,
      pr_number: Number(r.pr_number),
      state: (r.state === "merged" || r.state === "closed" || r.state === "open"
        ? r.state
        : "open") as "open" | "merged" | "closed",
      opened_at: r.opened_at,
      merged_at: r.merged_at,
      additions: Number(r.additions ?? 0),
      deletions: Number(r.deletions ?? 0),
      changed_files: Number(r.changed_files ?? 0),
      author_hash: r.author_login_hash.slice(0, 8),
      head_ref: r.head_ref ?? "",
      base_ref: r.base_ref ?? "",
    }));

  // cost_per_merged_pr — session-aware. Needs commit_sha linkage; if linker
  // hasn't populated session_repo_links, surface null and let the UI copy
  // explain the wait.
  const costRows = await ctx.db.pg.query<{ cost: number | null }>(
    `SELECT coalesce(sum(srl.total_cost_usd), 0) AS cost
       FROM session_repo_links srl
      WHERE srl.tenant_id = $1
        AND srl.observed_at >= now() - ($2 || ' days')::interval`,
    [ctx.tenant_id, String(days)],
  ).catch(() => []);
  const totalCost = Number(costRows[0]?.cost ?? 0);
  const cost_per_merged_pr = merged > 0 && totalCost > 0 ? round2(totalCost / merged) : null;

  const commitsOnlyRows = await ctx.db.pg.query<{ n: number | string }>(
    `SELECT count(*) AS n
       FROM git_events
      WHERE tenant_id = $1
        AND kind = 'push'
        AND ts >= now() - ($2 || ' days')::interval`,
    [ctx.tenant_id, String(days)],
  ).catch(() => [{ n: 0 }]);
  const commits_without_pr = Math.max(0, Number(commitsOnlyRows[0]?.n ?? 0) - merged);

  const first_try_pct = opened > 0 ? round2(1 - (closed + recent_prs.length * 0) / opened) : null;
  const revert_pct =
    merged > 0
      ? round2(pr_by_author.reduce((s, a) => s + a.revert_count, 0) / Math.max(1, merged))
      : null;

  return {
    pr_kpis: { opened, merged, closed, open_now, first_try_pct, revert_pct },
    merge_latency,
    weekly_throughput,
    size_distribution,
    pr_by_repo,
    pr_by_author,
    commits_without_pr,
    recent_prs,
    cost_per_merged_pr,
    cohort_gated,
    updated_at: new Date().toISOString(),
  };
}

function isJustMe(ctx: Ctx, input: CodeDeliveryInput): boolean {
  const ids = input.engineer_ids ?? [];
  return ids.length === 1 && ids[0] === ctx.actor_id;
}

function weekLabel(index: number, total: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (total - 1 - index) * 7);
  return isoWeek(d);
}

function isoWeek(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
