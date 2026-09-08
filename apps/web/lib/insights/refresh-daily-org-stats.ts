// Phase 3 T3.2 — daily_org_stats rollup.
// Aggregates from daily_user_stats for the day, plus per-PR counts from pr +
// pr_commit (P5 reverts excluded; P6 aiSources determines AI-assisted vs bot).

import { db } from "@/lib/db";
import {
  dailyUserStats,
  dailyOrgStats,
  pr,
  prCommit,
} from "@/lib/db/schema";
import { and, eq, sql, gte, lt } from "drizzle-orm";
import { buildDailyOrgStatsRows } from "@/lib/insights/rollup-math";

function startOfUtcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}
function endOfUtcDay(day: string): Date {
  return new Date(startOfUtcDay(day).getTime() + 86_400_000);
}

export async function refreshDailyOrgStats(orgId: string, day: string): Promise<void> {
  // Per-source token + active-time aggregates from daily_user_stats.
  const sums = await db
    .select({
      source: dailyUserStats.source,
      sessions: sql<number>`coalesce(sum(${dailyUserStats.sessions}), 0)`.mapWith(Number),
      activeHoursCenti: sql<number>`coalesce(sum(${dailyUserStats.activeHoursCenti}), 0)`.mapWith(Number),
      tokensIn: sql<number>`coalesce(sum(${dailyUserStats.tokensIn}), 0)`.mapWith(Number),
      tokensOut: sql<number>`coalesce(sum(${dailyUserStats.tokensOut}), 0)`.mapWith(Number),
      tokensCacheRead: sql<number>`coalesce(sum(${dailyUserStats.tokensCacheRead}), 0)`.mapWith(Number),
      tokensCacheWrite: sql<number>`coalesce(sum(${dailyUserStats.tokensCacheWrite}), 0)`.mapWith(Number),
    })
    .from(dailyUserStats)
    .where(and(eq(dailyUserStats.orgId, orgId), eq(dailyUserStats.day, day)))
    .groupBy(dailyUserStats.source);

  // PR counts (mergedAt within [dayStart, dayEnd)).
  const dayStart = startOfUtcDay(day);
  const dayEnd = endOfUtcDay(day);
  const prs = await db
    .select({
      id: pr.id,
      kind: pr.kind,
    })
    .from(pr)
    .where(
      and(
        eq(pr.orgId, orgId),
        gte(pr.mergedAt, dayStart),
        lt(pr.mergedAt, dayEnd),
        eq(pr.state, "merged"),
      ),
    );

  let prsMerged = 0;
  let prsReverted = 0;
  let prsMergedAiAssisted = 0;
  let prsMergedBot = 0;

  // Per-PR check aiSources of any commit row.
  for (const p of prs) {
    if (p.kind === "revert") {
      prsReverted++;
      continue;
    }
    prsMerged++;
    const aiCheck = await db
      .select({ aiSources: prCommit.aiSources })
      .from(prCommit)
      .where(eq(prCommit.prId, p.id));
    const seen = new Set<string>();
    for (const r of aiCheck) {
      for (const s of (r.aiSources ?? [])) seen.add(s);
    }
    if (seen.has("bot")) {
      prsMergedBot++;
    } else if (seen.has("claude") || seen.has("codex") || seen.has("cursor")) {
      prsMergedAiAssisted++;
    }
  }

  // C3 fix: PR counts → synthetic `_meta` row; per-source rows carry 0 PR
  // counts. Math in buildDailyOrgStatsRows(); see rollup-math.ts.
  const rows = buildDailyOrgStatsRows(
    sums,
    { prsMerged, prsMergedAiAssisted, prsMergedBot, prsReverted },
  );
  const computedAt = new Date();

  for (const r of rows) {
    const values = { orgId, day, computedAt, ...r };
    await db
      .insert(dailyOrgStats)
      .values(values)
      .onConflictDoUpdate({
        target: [dailyOrgStats.orgId, dailyOrgStats.day, dailyOrgStats.source],
        set: {
          sessions: values.sessions,
          activeHoursCenti: values.activeHoursCenti,
          tokensIn: values.tokensIn,
          tokensOut: values.tokensOut,
          tokensCacheRead: values.tokensCacheRead,
          tokensCacheWrite: values.tokensCacheWrite,
          prsMerged: values.prsMerged,
          prsMergedAiAssisted: values.prsMergedAiAssisted,
          prsMergedBot: values.prsMergedBot,
          prsReverted: values.prsReverted,
          computedAt,
        },
      });
  }
}
