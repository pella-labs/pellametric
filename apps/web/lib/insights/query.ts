// F2.12 — Server-only query compiler. Types + URL codec live in query-types.ts
// so the client bundle can import them without pulling drizzle in.

import { db } from "@/lib/db";
import { sessionEvent, pr, user } from "@/lib/db/schema";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { costFor } from "@/lib/pricing";
import type {
  InsightBreakdown,
  InsightMetric,
  InsightQuery,
  InsightRange,
  InsightResult,
  TimePoint,
  BreakdownRow,
} from "@/lib/insights/query-types";

export type {
  InsightBreakdown,
  InsightFilter,
  InsightMetric,
  InsightQuery,
  InsightRange,
  InsightResult,
  TimePoint,
  BreakdownRow,
} from "@/lib/insights/query-types";

export { DEFAULT_QUERY, decodeQuery, encodeQuery } from "@/lib/insights/query-types";

export type InsightScope =
  | { kind: "org"; orgId: string; managerUserId: string }
  | { kind: "user"; userId: string; orgId: string };

const K_FLOOR = 5;

function rangeBounds(r: InsightRange): { from: Date; to: Date } {
  if (r.kind === "absolute") {
    return { from: new Date(r.from), to: new Date(r.to) };
  }
  const days = r.preset === "7d" ? 7 : r.preset === "30d" ? 30 : 90;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}

function bucketDay(d: Date, granularity: "day" | "week"): string {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  if (granularity === "week") {
    const dow = c.getUTCDay();
    c.setUTCDate(c.getUTCDate() - dow);
  }
  return c.toISOString().slice(0, 10);
}

function breakdownKeyForRow(
  breakdown: InsightBreakdown,
  row: { source: string; model: string | null; repo: string; intentTop: string | null; userId: string; startedAt: Date },
  loginByUser: Map<string, string | null>,
): string {
  switch (breakdown) {
    case "source":
      return row.source;
    case "model":
      return row.model ?? "(unknown)";
    case "repo":
      return row.repo;
    case "intent_top":
      return row.intentTop ?? "(unclassified)";
    case "user":
      return loginByUser.get(row.userId) ?? row.userId;
    case "day_of_week": {
      const d = new Date(row.startedAt);
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
    }
    default:
      return "_total";
  }
}

function valueForRow(
  metric: InsightMetric,
  row: {
    tokensIn: number;
    tokensOut: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    errors: number;
    startedAt: Date;
    endedAt: Date;
    model: string | null;
  },
): number {
  switch (metric) {
    case "tokens_in":
      return row.tokensIn;
    case "tokens_out":
      return row.tokensOut;
    case "tokens_cache_read":
      return row.tokensCacheRead;
    case "errors":
      return row.errors;
    case "wall_sec":
      return Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000));
    case "sessions":
      return 1;
    case "cost_usd":
      return costFor(row.model, {
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        tokensCacheRead: row.tokensCacheRead,
        tokensCacheWrite: row.tokensCacheWrite,
      });
    case "prs_merged":
      // prs_merged is not derived from session_event; handled separately below.
      return 0;
  }
}

export async function getInsight(query: InsightQuery, scope: InsightScope): Promise<InsightResult> {
  const { from, to } = rangeBounds(query.range);

  if (query.metric === "prs_merged") {
    return getPrsInsight(query, scope, from, to);
  }

  // Build base where for session_event.
  const baseWhere = [
    eq(sessionEvent.orgId, scope.orgId),
    gte(sessionEvent.startedAt, from),
    lte(sessionEvent.startedAt, to),
  ];
  if (scope.kind === "user") {
    baseWhere.push(eq(sessionEvent.userId, scope.userId));
  }
  for (const f of query.filters) {
    if (f.values.length === 0) continue;
    switch (f.field) {
      case "source":
        baseWhere.push(inArray(sessionEvent.source, f.values));
        break;
      case "repo":
        baseWhere.push(inArray(sessionEvent.repo, f.values));
        break;
      case "model":
        baseWhere.push(inArray(sessionEvent.model, f.values));
        break;
      case "intent_top":
        baseWhere.push(inArray(sessionEvent.intentTop, f.values));
        break;
      case "user":
        baseWhere.push(inArray(sessionEvent.userId, f.values));
        break;
      case "branch":
        baseWhere.push(inArray(sessionEvent.branch, f.values));
        break;
    }
  }

  // Pull only the columns we need for valueForRow + breakdown.
  const rows = await db
    .select({
      userId: sessionEvent.userId,
      source: sessionEvent.source,
      repo: sessionEvent.repo,
      model: sessionEvent.model,
      intentTop: sessionEvent.intentTop,
      startedAt: sessionEvent.startedAt,
      endedAt: sessionEvent.endedAt,
      tokensIn: sessionEvent.tokensIn,
      tokensOut: sessionEvent.tokensOut,
      tokensCacheRead: sessionEvent.tokensCacheRead,
      tokensCacheWrite: sessionEvent.tokensCacheWrite,
      errors: sessionEvent.errors,
    })
    .from(sessionEvent)
    .where(and(...baseWhere));

  // k-anon check: cohort = distinct userIds across the matched rows. Only
  // applies to manager scope. K-floor of 5 (system default).
  if (scope.kind === "org") {
    const cohort = new Set(rows.map(r => r.userId));
    if (cohort.size < K_FLOOR) {
      return { ok: false, error: "k_anonymity", required: K_FLOOR, actual: cohort.size };
    }
  }

  // Resolve userId → githubLogin for the user breakdown.
  let loginByUser = new Map<string, string | null>();
  if (query.breakdown === "user") {
    const ids = Array.from(new Set(rows.map(r => r.userId)));
    if (ids.length > 0) {
      const userRows = await db
        .select({ id: user.id, login: user.githubLogin })
        .from(user)
        .where(inArray(user.id, ids));
      loginByUser = new Map(userRows.map(u => [u.id, u.login]));
    }
  }

  // Aggregate. seriesMap[t][key] += value. breakdownTotals[key] += value.
  const seriesMap = new Map<string, Map<string, number>>();
  const breakdownTotals = new Map<string, number>();
  const breakdownSessions = new Map<string, number>();
  const breakdownUsers = new Map<string, Set<string>>();
  for (const r of rows) {
    const t = bucketDay(r.startedAt, query.granularity);
    const k = breakdownKeyForRow(query.breakdown, r, loginByUser);
    const v = valueForRow(query.metric, r);
    if (!seriesMap.has(t)) seriesMap.set(t, new Map());
    const ts = seriesMap.get(t)!;
    ts.set(k, (ts.get(k) ?? 0) + v);
    breakdownTotals.set(k, (breakdownTotals.get(k) ?? 0) + v);
    breakdownSessions.set(k, (breakdownSessions.get(k) ?? 0) + 1);
    if (!breakdownUsers.has(k)) breakdownUsers.set(k, new Set());
    breakdownUsers.get(k)!.add(r.userId);
  }

  const series: TimePoint[] = Array.from(seriesMap.entries())
    .map(([t, m]) => ({ t, series: Object.fromEntries(m) }))
    .sort((a, b) => (a.t < b.t ? -1 : 1));

  const breakdown: BreakdownRow[] = Array.from(breakdownTotals.entries())
    .map(([key, total]) => ({
      key,
      label: key,
      total,
      sessions: breakdownSessions.get(key) ?? 0,
      users: breakdownUsers.get(key)?.size ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    ok: true,
    series,
    breakdown,
    meta: {
      kAnonymous: scope.kind === "org",
      cohortSize: scope.kind === "org" ? new Set(rows.map(r => r.userId)).size : undefined,
    },
  };
}

async function getPrsInsight(
  query: InsightQuery,
  scope: InsightScope,
  from: Date,
  to: Date,
): Promise<InsightResult> {
  // PRs are org-wide. For user scope, we filter to PRs whose authorLogin
  // matches the user's githubLogin.
  let authorFilter: string | null = null;
  if (scope.kind === "user") {
    const [u] = await db
      .select({ login: user.githubLogin })
      .from(user)
      .where(eq(user.id, scope.userId));
    authorFilter = u?.login ?? null;
    if (!authorFilter) {
      return { ok: true, series: [], breakdown: [], meta: { kAnonymous: false } };
    }
  }

  const conds = [
    eq(pr.orgId, scope.orgId),
    eq(pr.state, "merged"),
    gte(pr.mergedAt, from),
    lte(pr.mergedAt, to),
  ];
  if (authorFilter) conds.push(eq(pr.authorLogin, authorFilter));
  for (const f of query.filters) {
    if (f.field === "repo" && f.values.length > 0) conds.push(inArray(pr.repo, f.values));
  }

  const rows = await db
    .select({
      mergedAt: pr.mergedAt,
      repo: pr.repo,
      authorLogin: pr.authorLogin,
      kind: pr.kind,
    })
    .from(pr)
    .where(and(...conds));

  // k-anon: distinct authors must be >=5 when scope=org.
  if (scope.kind === "org") {
    const cohort = new Set(rows.map(r => r.authorLogin).filter((x): x is string => !!x));
    if (cohort.size < K_FLOOR) {
      return { ok: false, error: "k_anonymity", required: K_FLOOR, actual: cohort.size };
    }
  }

  const seriesMap = new Map<string, Map<string, number>>();
  const breakdownTotals = new Map<string, number>();
  for (const r of rows) {
    if (!r.mergedAt) continue;
    const t = bucketDay(r.mergedAt, query.granularity);
    const k =
      query.breakdown === "repo"
        ? r.repo
        : query.breakdown === "user"
          ? r.authorLogin ?? "(unknown)"
          : query.breakdown === "day_of_week"
            ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][r.mergedAt.getUTCDay()]
            : "_total";
    if (!seriesMap.has(t)) seriesMap.set(t, new Map());
    seriesMap.get(t)!.set(k, (seriesMap.get(t)!.get(k) ?? 0) + 1);
    breakdownTotals.set(k, (breakdownTotals.get(k) ?? 0) + 1);
  }
  const series: TimePoint[] = Array.from(seriesMap.entries())
    .map(([t, m]) => ({ t, series: Object.fromEntries(m) }))
    .sort((a, b) => (a.t < b.t ? -1 : 1));
  const breakdown: BreakdownRow[] = Array.from(breakdownTotals.entries())
    .map(([key, total]) => ({ key, label: key, total }))
    .sort((a, b) => b.total - a.total);

  return { ok: true, series, breakdown, meta: { kAnonymous: scope.kind === "org" } };
}

