// GET /api/insights/cohort/:metric?orgSlug=&windowKey=
// k-anonymity gated (k>=5 within-org system-defined cohorts; k>=10 ad-hoc).
// Manager-only. Intersection guard (P19): repeated different-cohort queries by
// the same manager that resolve to overlapping member sets are logged for review.

import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { dailyUserStats, cohortQueryLog, membership } from "@/lib/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import crypto from "node:crypto";

const K_SYSTEM = 5;
const K_AD_HOC = 10;

const ALLOWED_METRICS = new Set(["cost_per_pr", "tokens_per_loc", "sessions_per_day"]);

function windowToDays(k: string): number {
  if (k === "7d") return 7;
  if (k === "30d") return 30;
  if (k === "90d") return 90;
  return 30;
}

export async function GET(req: Request, { params }: { params: Promise<{ metric: string }> }) {
  const url = new URL(req.url);
  const orgSlug = url.searchParams.get("orgSlug") ?? "";
  const windowKey = url.searchParams.get("windowKey") ?? "30d";
  const cohortType = url.searchParams.get("cohortType") ?? "system"; // "system"|"ad_hoc"
  // C4 fix: dedup ad-hoc member ids before any k-anonymity check. Repeating
  // ?members=u&members=u previously inflated cohortSize past the k-floor.
  const memberFilter = Array.from(new Set(url.searchParams.getAll("members")));
  const { metric } = await params;
  if (!ALLOWED_METRICS.has(metric)) {
    return NextResponse.json({ error: "unsupported metric" }, { status: 400 });
  }

  const auth = await requireMembership(orgSlug, { requiredRole: "manager" });
  if (auth instanceof Response) return auth;

  const requiredK = cohortType === "ad_hoc" ? K_AD_HOC : K_SYSTEM;

  // Resolve cohort member set.
  let memberIds: string[];
  if (cohortType === "ad_hoc" && memberFilter.length > 0) {
    memberIds = memberFilter;
  } else {
    const all = await db
      .select({ userId: membership.userId })
      .from(membership)
      .where(eq(membership.orgId, auth.org.id));
    memberIds = all.map(r => r.userId);
  }

  if (memberIds.length < requiredK) {
    return NextResponse.json(
      { error: "k_anonymity", required: requiredK, actual: memberIds.length },
      { status: 422 },
    );
  }

  const cohortHash = crypto.createHash("sha256").update(memberIds.slice().sort().join(",")).digest("hex");

  // P19 intersection log — record this query.
  try {
    await db.insert(cohortQueryLog).values({
      managerId: auth.userId,
      orgId: auth.org.id,
      metric,
      cohortHash,
      memberIds,
    });
  } catch (err) {
    console.error("cohort_query_log insert failed", err);
  }

  const since = new Date(Date.now() - windowToDays(windowKey) * 86_400_000);

  // Aggregate (anonymous): sum tokens & sessions across the cohort over the window.
  const aggregate = await db
    .select({
      sessions: sql<number>`coalesce(sum(${dailyUserStats.sessions}), 0)`.mapWith(Number),
      tokensIn: sql<number>`coalesce(sum(${dailyUserStats.tokensIn}), 0)`.mapWith(Number),
      tokensOut: sql<number>`coalesce(sum(${dailyUserStats.tokensOut}), 0)`.mapWith(Number),
      activeHoursCenti: sql<number>`coalesce(sum(${dailyUserStats.activeHoursCenti}), 0)`.mapWith(Number),
    })
    .from(dailyUserStats)
    .where(
      and(
        eq(dailyUserStats.orgId, auth.org.id),
        gte(dailyUserStats.day, since.toISOString().slice(0, 10)),
        inArray(dailyUserStats.userId, memberIds),
      ),
    );

  return NextResponse.json({
    metric,
    windowKey,
    cohortType,
    cohortSize: memberIds.length,
    cohortHash,
    aggregate: aggregate[0] ?? { sessions: 0, tokensIn: 0, tokensOut: 0, activeHoursCenti: 0 },
  });
}
