import { assertRole, type Ctx } from "../../auth";
import { useFixtures } from "../../env";
import type {
  CodeDeliveryInput,
  CodeDeliveryOutput,
  PrByAuthor,
  PrByRepo,
  PrListItem,
  SizeDistribution,
  SubscriptionSummary,
  WeeklyThroughputPoint,
} from "../../schemas/new-dashboard";
import { hash8, round2, seededRand, seedFromString, WINDOW_DAYS } from "./_shared";

const AUTHOR_COHORT_FLOOR = 5;

// TODO(walid): swap these for a per-org plan config (orgs.seat_price_usd +
// orgs.plan_label, or a `subscriptions` table once we model multi-provider
// plans). Hardcoded for the dashboard PoC: $200/active-engineer/month is the
// current Anthropic Claude Max retail price as of 2026-04.
const HARDCODED_SEAT_PRICE_USD_PER_MONTH = 200;
const HARDCODED_PLAN_LABEL = "Claude Max ($200/seat/mo, hardcoded)";

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
    const m = Math.round(o * 0.85);
    const spend = round2(40 + seededRand(seed, 410 + i) * 200);
    const mergedSpend = round2(spend * 0.78);
    pr_by_author.push({
      author_hash: hash8(`${ctx.tenant_id}:fx-author-${i}`),
      opened: o,
      merged: m,
      revert_count: Math.round(o * 0.02),
      spend_usd: spend,
      spend_on_merged_usd: mergedSpend,
      spend_on_unmerged_usd: round2(spend - mergedSpend),
      tokens: Math.round(spend * 8000),
      cost_per_merged_pr: m > 0 ? round2(mergedSpend / m) : null,
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
    subscription: {
      active_engineers: authorCount,
      seat_price_usd_per_month: HARDCODED_SEAT_PRICE_USD_PER_MONTH,
      plan_label: HARDCODED_PLAN_LABEL,
      window_days: days,
      subscription_cost_usd: round2(
        ((authorCount * HARDCODED_SEAT_PRICE_USD_PER_MONTH) / 30) * days,
      ),
      actual_spend_usd: round2(opened * 4.31 * (days / 30)),
      savings_usd: round2(
        ((authorCount * HARDCODED_SEAT_PRICE_USD_PER_MONTH) / 30) * days -
          opened * 4.31 * (days / 30),
      ),
    } satisfies SubscriptionSummary,
    cohort_gated: false,
    updated_at: new Date().toISOString(),
  };
}

async function codeDeliveryReal(ctx: Ctx, input: CodeDeliveryInput): Promise<CodeDeliveryOutput> {
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
     LEFT JOIN repos r ON r.provider = 'github' AND r.provider_repo_id = pr.provider_repo_id
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
      ({
        author_hash: key,
        opened: 0,
        merged: 0,
        revert_count: 0,
        spend_usd: null,
        spend_on_merged_usd: null,
        spend_on_unmerged_usd: null,
        tokens: null,
        cost_per_merged_pr: null,
      } satisfies PrByAuthor);
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

  // cost_per_merged_pr is computed below alongside the per-author match,
  // so it uses the same (branch + time-overlap) attribution as the table
  // rows. The previous session_repo_links-based query joined PRs × links
  // on repo only, producing a cartesian overcount — superseded.
  let cost_per_merged_pr: number | null = null;

  // Per-author cost breakdown — READ-ONLY inline match. We skip
  // session_repo_links (which is populated by the branch-time linker cron
  // and is often empty on fresh deploys) and do the branch + time-overlap
  // match ourselves against CH session windows + PG PRs. No writes.
  //
  // Match rule: session.branch = pr.head_ref AND session's [min_ts, max_ts]
  // overlaps pr's [opened_at, coalesce(merged_at, closed_at, now())]. A
  // session can legitimately match multiple PRs (rebased, reopened, long-
  // lived branch); each matching author gets that session's cost counted
  // once (deduped per (author, session) pair). This mirrors the linker at
  // apps/worker/scripts/link-sessions-by-branch.ts so numbers agree once
  // the linker starts running.
  if (!cohort_gated && pr_by_author.length > 0) {
    const sessionRows = (await ctx.db.ch
      .query<{
        session_id: string;
        branch: string;
        started_at: string;
        ended_at: string;
        cost: number | string;
        tokens: number | string;
      }>(
        `SELECT session_id,
                branch,
                toString(min(ts))                      AS started_at,
                toString(max(ts))                      AS ended_at,
                round(sum(cost_usd), 6)                AS cost,
                sum(input_tokens) + sum(output_tokens) AS tokens
           FROM events
          WHERE org_id = {tid:String}
            AND branch != ''
            AND ts >= now() - toIntervalDay({days:UInt16})
          GROUP BY session_id, branch`,
        { tid: ctx.tenant_id, days },
      )
      .catch(() => [])) as Array<{
      session_id: string;
      branch: string;
      started_at: string;
      ended_at: string;
      cost: number | string;
      tokens: number | string;
    }>;

    // Index PRs by head_ref; branches can be reused (e.g. reopened PRs),
    // so the value is an array, not a single PR.
    const prsByBranch = new Map<string, typeof base>();
    for (const pr of base) {
      if (!pr.head_ref) continue;
      const arr = prsByBranch.get(pr.head_ref) ?? [];
      arr.push(pr);
      prsByBranch.set(pr.head_ref, arr);
    }

    type AuthorAcc = {
      sessions: Set<string>;
      cost: number;
      merged_cost: number;
      tokens: number;
    };
    const accByAuthor = new Map<string, AuthorAcc>();
    // Tenant-wide merged-session cost dedup for the global cost_per_merged_pr
    // (summing per-author merged_cost would double-count sessions that
    // matched multiple authors' PRs on the same branch).
    const globalMergedSessions = new Map<string, number>();
    const nowMs = Date.now();

    for (const s of sessionRows) {
      const candidates = prsByBranch.get(String(s.branch));
      if (!candidates) continue;
      const startedMs = Date.parse(s.started_at);
      const endedMs = Date.parse(s.ended_at);
      if (Number.isNaN(startedMs) || Number.isNaN(endedMs)) continue;

      // Collect authors whose PR windows overlap this session; remember
      // which of those authors owned a merged PR for the merged-vs-unmerged
      // bucket.
      const matchedAuthors = new Map<string, { merged: boolean }>();
      for (const pr of candidates) {
        const prOpen = Date.parse(pr.opened_at);
        const prClose = pr.merged_at
          ? Date.parse(pr.merged_at)
          : pr.closed_at
            ? Date.parse(pr.closed_at)
            : nowMs;
        if (Number.isNaN(prOpen)) continue;
        if (endedMs < prOpen || startedMs > prClose) continue;
        const author8 = pr.author_login_hash.slice(0, 8);
        const prev = matchedAuthors.get(author8);
        const mergedNow = pr.state === "merged";
        matchedAuthors.set(author8, { merged: (prev?.merged ?? false) || mergedNow });
      }
      if (matchedAuthors.size === 0) continue;

      const sessionId = String(s.session_id);
      const sessionCost = Number(s.cost ?? 0);
      const sessionTokens = Number(s.tokens ?? 0);
      let touchedAnyMerged = false;
      for (const [author8, { merged }] of matchedAuthors) {
        const acc = accByAuthor.get(author8) ?? {
          sessions: new Set<string>(),
          cost: 0,
          merged_cost: 0,
          tokens: 0,
        };
        if (!acc.sessions.has(sessionId)) {
          acc.sessions.add(sessionId);
          acc.cost += sessionCost;
          acc.tokens += sessionTokens;
          if (merged) acc.merged_cost += sessionCost;
        }
        accByAuthor.set(author8, acc);
        if (merged) touchedAnyMerged = true;
      }
      if (touchedAnyMerged && !globalMergedSessions.has(sessionId)) {
        globalMergedSessions.set(sessionId, sessionCost);
      }
    }

    for (const author of pr_by_author) {
      const acc = accByAuthor.get(author.author_hash);
      if (!acc) continue;
      author.spend_usd = round2(acc.cost);
      author.spend_on_merged_usd = round2(acc.merged_cost);
      author.spend_on_unmerged_usd = round2(Math.max(0, acc.cost - acc.merged_cost));
      author.tokens = acc.tokens;
      author.cost_per_merged_pr =
        author.merged > 0 ? round2(acc.merged_cost / author.merged) : null;
    }

    // Tenant-wide cost_per_merged_pr — sum cost across distinct merged
    // sessions (dedup via globalMergedSessions, so a session matched to
    // multiple authors on the same branch only counts once).
    if (merged > 0 && globalMergedSessions.size > 0) {
      let totalMergedCost = 0;
      for (const c of globalMergedSessions.values()) totalMergedCost += c;
      if (totalMergedCost > 0) cost_per_merged_pr = round2(totalMergedCost / merged);
    }
  }

  // Subscription summary — counts distinct engineer_ids active in the window
  // from CH events, multiplies by the hardcoded seat price. See the TODO at
  // the top of this file for the wiring plan.
  let subscription: SubscriptionSummary | null = null;
  const subRows = await ctx.db.ch
    .query<{ engineers: number | string; spend: number | string }>(
      `SELECT uniqExact(engineer_id)         AS engineers,
              round(sum(cost_usd), 6)        AS spend
         FROM events
        WHERE org_id = {tid:String}
          AND ts >= now() - toIntervalDay({days:UInt16})`,
      { tid: ctx.tenant_id, days },
    )
    .catch(() => []);
  if (subRows[0]) {
    const engineers = Number(subRows[0].engineers ?? 0);
    const actual = Number(subRows[0].spend ?? 0);
    const subCost = (engineers * HARDCODED_SEAT_PRICE_USD_PER_MONTH * days) / 30;
    subscription = {
      active_engineers: engineers,
      seat_price_usd_per_month: HARDCODED_SEAT_PRICE_USD_PER_MONTH,
      plan_label: HARDCODED_PLAN_LABEL,
      window_days: days,
      subscription_cost_usd: round2(subCost),
      actual_spend_usd: round2(actual),
      savings_usd: round2(subCost - actual),
    };
  }

  const commitsOnlyRows = await ctx.db.pg
    .query<{ n: number | string }>(
      `SELECT count(*) AS n
       FROM git_events
      WHERE org_id = $1
        AND event_kind = 'push'
        AND received_at >= now() - ($2 || ' days')::interval`,
      [ctx.tenant_id, String(days)],
    )
    .catch(() => [{ n: 0 }]);
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
    subscription,
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
