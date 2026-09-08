// F3.20 — Server-side aggregator for the manager overview surface.
// Pulls KPI strip, scatter (Spend × Throughput per dev), attribution mix, top
// PRs by cost, and top devs. Reads pre-computed cost_per_pr where available
// (App-installed orgs) and falls back to per-session cost via costFor() for
// OAuth orgs.

import { db } from "@/lib/db";
import { sessionEvent, pr, costPerPr, user, backfillState } from "@/lib/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { costFor } from "@/lib/pricing";

export type ManagerOverviewData = {
  windowLabel: string;
  kpi: {
    costPerPrUsd: number;
    teamSpendUsd: number;
    prsMerged: number;
    wastePct: number;
    costPerPrSparkline: number[];
    teamSpendSparkline: number[];
    prsMergedSparkline: number[];
    wasteSparkline: number[];
  };
  scatter: Array<{
    id: string;
    label: string;
    x: number; // spend
    y: number; // PRs merged
    sessions: number;
  }>;
  attribution: {
    pctClaude: number;
    pctCodex: number;
    pctCursor: number;
    pctHuman: number;
  };
  topPrs: Array<{
    prId: string;
    repo: string;
    number: number;
    title: string | null;
    author: string | null;
    costUsd: number | null;
    confidence: "high" | "medium" | "low" | null;
    mergedAt: Date | null;
  }>;
  topDevs: Array<{
    login: string;
    sessions: number;
    prsMerged: number;
    spendUsd: number;
  }>;
  backfill: {
    status: "pending" | "running" | "done" | "error" | null;
    lastDay: string | null;
  };
};

function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getManagerOverviewData(orgId: string, days = 30): Promise<ManagerOverviewData> {
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);

  // Pull all session rows in window. Only the fields we need for cost + activity.
  const sessions = await db
    .select({
      userId: sessionEvent.userId,
      source: sessionEvent.source,
      model: sessionEvent.model,
      startedAt: sessionEvent.startedAt,
      endedAt: sessionEvent.endedAt,
      tokensIn: sessionEvent.tokensIn,
      tokensOut: sessionEvent.tokensOut,
      tokensCacheRead: sessionEvent.tokensCacheRead,
      tokensCacheWrite: sessionEvent.tokensCacheWrite,
      errors: sessionEvent.errors,
    })
    .from(sessionEvent)
    .where(and(eq(sessionEvent.orgId, orgId), gte(sessionEvent.startedAt, since)));

  // PRs merged in window.
  const prs = await db
    .select({
      id: pr.id,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      authorLogin: pr.authorLogin,
      mergedAt: pr.mergedAt,
      kind: pr.kind,
    })
    .from(pr)
    .where(
      and(
        eq(pr.orgId, orgId),
        eq(pr.state, "merged"),
        gte(pr.mergedAt, since),
      ),
    );

  // cost_per_pr rollup rows for the PRs we just listed.
  const prIds = prs.map(p => p.id);
  let costRows: Array<{
    prId: string;
    tokensIn: number;
    tokensOut: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    pctClaude: number;
    pctCodex: number;
    pctCursor: number;
    pctHuman: number;
    highConfLinks: number;
    mediumConfLinks: number;
  }> = [];
  if (prIds.length > 0) {
    costRows = await db
      .select({
        prId: costPerPr.prId,
        tokensIn: costPerPr.tokensIn,
        tokensOut: costPerPr.tokensOut,
        tokensCacheRead: costPerPr.tokensCacheRead,
        tokensCacheWrite: costPerPr.tokensCacheWrite,
        pctClaude: costPerPr.pctClaude,
        pctCodex: costPerPr.pctCodex,
        pctCursor: costPerPr.pctCursor,
        pctHuman: costPerPr.pctHuman,
        highConfLinks: costPerPr.highConfLinks,
        mediumConfLinks: costPerPr.mediumConfLinks,
      })
      .from(costPerPr)
      .where(inArray(costPerPr.prId, prIds));
  }
  const costByPr = new Map(costRows.map(r => [r.prId, r]));

  // Resolve userId → githubLogin once.
  const userIds = Array.from(new Set(sessions.map(s => s.userId)));
  const userRows = userIds.length > 0
    ? await db
        .select({ id: user.id, login: user.githubLogin })
        .from(user)
        .where(inArray(user.id, userIds))
    : [];
  const loginByUser = new Map(userRows.map(u => [u.id, u.login]));

  // Per-session cost via costFor.
  function sessionCost(s: typeof sessions[number]): number {
    return costFor(s.model, {
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead,
      tokensCacheWrite: s.tokensCacheWrite,
    });
  }

  // KPI: team spend = sum of per-session cost.
  let teamSpendUsd = 0;
  let errorSessions = 0;
  const perDev = new Map<string, { sessions: number; spend: number }>();
  for (const s of sessions) {
    const c = sessionCost(s);
    teamSpendUsd += c;
    if (s.errors > 0) errorSessions++;
    const pd = perDev.get(s.userId) ?? { sessions: 0, spend: 0 };
    pd.sessions++;
    pd.spend += c;
    perDev.set(s.userId, pd);
  }

  // Cost per PR (over the window) = teamSpendUsd / max(merged PRs, 1).
  const prsMerged = prs.filter(p => p.kind !== "revert").length;
  const costPerPrUsd = prsMerged > 0 ? teamSpendUsd / prsMerged : 0;

  // Waste % = sessions with errors / total. (Coarse — better waste signal lives on the waste page.)
  const wastePct = sessions.length > 0 ? (errorSessions / sessions.length) * 100 : 0;

  // Per-day sparklines (last `days` buckets).
  const sparkLen = Math.min(30, days);
  const dailyCost = new Map<string, number>();
  const dailyErr = new Map<string, number>();
  const dailyAll = new Map<string, number>();
  for (const s of sessions) {
    const d = fmtDay(s.startedAt);
    dailyCost.set(d, (dailyCost.get(d) ?? 0) + sessionCost(s));
    dailyAll.set(d, (dailyAll.get(d) ?? 0) + 1);
    if (s.errors > 0) dailyErr.set(d, (dailyErr.get(d) ?? 0) + 1);
  }
  const dailyPrs = new Map<string, number>();
  for (const p of prs) {
    if (!p.mergedAt || p.kind === "revert") continue;
    const d = fmtDay(p.mergedAt);
    dailyPrs.set(d, (dailyPrs.get(d) ?? 0) + 1);
  }

  function lastNBuckets(map: Map<string, number>): number[] {
    const out: number[] = [];
    for (let i = sparkLen - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      out.push(map.get(fmtDay(d)) ?? 0);
    }
    return out;
  }

  // Scatter — top 32 devs by spend.
  const scatterAll = await Promise.all(
    Array.from(perDev.entries()).map(async ([uid, agg]) => {
      const login = loginByUser.get(uid) ?? uid.slice(0, 6);
      const myPrs = prs.filter(p => p.authorLogin === login && p.kind !== "revert").length;
      return {
        id: uid,
        label: login || "(unknown)",
        x: agg.spend,
        y: myPrs,
        sessions: agg.sessions,
      };
    }),
  );
  scatterAll.sort((a, b) => b.x - a.x);
  const scatter = scatterAll.slice(0, 32);

  // Attribution mix — weighted by linked-session tokens (so heavier PRs dominate).
  let tClaude = 0, tCodex = 0, tCursor = 0, tHuman = 0;
  for (const c of costRows) {
    const totalTok = c.tokensIn + c.tokensOut;
    if (totalTok <= 0) continue;
    tClaude += (c.pctClaude / 100) * totalTok;
    tCodex += (c.pctCodex / 100) * totalTok;
    tCursor += (c.pctCursor / 100) * totalTok;
    tHuman += (c.pctHuman / 100) * totalTok;
  }
  const tSum = tClaude + tCodex + tCursor + tHuman || 1;
  const attribution = {
    pctClaude: Math.round((tClaude / tSum) * 100),
    pctCodex: Math.round((tCodex / tSum) * 100),
    pctCursor: Math.round((tCursor / tSum) * 100),
    pctHuman: Math.round((tHuman / tSum) * 100),
  };

  // Top PRs by cost.
  const prsByCost = prs
    .map(p => {
      const c = costByPr.get(p.id);
      const u =
        c
          ? costFor(null, {
              tokensIn: c.tokensIn,
              tokensOut: c.tokensOut,
              tokensCacheRead: c.tokensCacheRead,
              tokensCacheWrite: c.tokensCacheWrite,
            })
          : null;
      const conf: "high" | "medium" | "low" | null = c
        ? c.highConfLinks > 0
          ? "high"
          : c.mediumConfLinks > 0
            ? "medium"
            : "low"
        : null;
      return {
        prId: p.id,
        repo: p.repo,
        number: p.number,
        title: p.title,
        author: p.authorLogin,
        costUsd: u,
        confidence: conf,
        mergedAt: p.mergedAt,
      };
    })
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));

  // Top devs.
  const topDevs = Array.from(perDev.entries())
    .map(([uid, agg]) => {
      const login = loginByUser.get(uid) ?? uid.slice(0, 6);
      const myPrs = prs.filter(p => p.authorLogin === login && p.kind !== "revert").length;
      return {
        login: login || "(unknown)",
        sessions: agg.sessions,
        prsMerged: myPrs,
        spendUsd: agg.spend,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  // F4.31 — backfill status banner data.
  const [bf] = await db
    .select()
    .from(backfillState)
    .where(eq(backfillState.orgId, orgId))
    .limit(1);

  return {
    windowLabel: `last ${days}d`,
    kpi: {
      costPerPrUsd,
      teamSpendUsd,
      prsMerged,
      wastePct,
      costPerPrSparkline: lastNBuckets(dailyCost).map((v, i) => {
        const merged = dailyPrs.get(fmtDay(new Date(now.getTime() - (sparkLen - 1 - i) * 86_400_000))) ?? 0;
        return merged > 0 ? v / merged : 0;
      }),
      teamSpendSparkline: lastNBuckets(dailyCost),
      prsMergedSparkline: lastNBuckets(dailyPrs),
      wasteSparkline: lastNBuckets(dailyAll).map((all, i) => {
        const errs = dailyErr.get(fmtDay(new Date(now.getTime() - (sparkLen - 1 - i) * 86_400_000))) ?? 0;
        return all > 0 ? (errs / all) * 100 : 0;
      }),
    },
    scatter,
    attribution,
    topPrs: prsByCost,
    topDevs,
    backfill: {
      status: (bf?.status as ManagerOverviewData["backfill"]["status"]) ?? null,
      lastDay: bf?.lastDay ?? null,
    },
  };
}
