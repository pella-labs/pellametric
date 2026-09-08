// GET /api/insights/cost-per-pr?orgSlug=&window=
// Manager + dev. Returns per-PR rows from cost_per_pr joined to pr.

import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { costPerPr, pr } from "@/lib/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgSlug = url.searchParams.get("orgSlug") ?? "";
  const windowKey = url.searchParams.get("window") ?? "30d";
  const auth = await requireMembership(orgSlug);
  if (auth instanceof Response) return auth;

  const days = windowKey === "7d" ? 7 : windowKey === "90d" ? 90 : 30;
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await db
    .select({
      prId: pr.id,
      number: pr.number,
      title: pr.title,
      authorLogin: pr.authorLogin,
      kind: pr.kind,
      mergedAt: pr.mergedAt,
      url: pr.url,
      additions: pr.additions,
      deletions: pr.deletions,
      tokensIn: costPerPr.tokensIn,
      tokensOut: costPerPr.tokensOut,
      tokensCacheRead: costPerPr.tokensCacheRead,
      tokensCacheWrite: costPerPr.tokensCacheWrite,
      linkedSessions: costPerPr.linkedSessions,
      linkedUsers: costPerPr.linkedUsers,
      highConfLinks: costPerPr.highConfLinks,
      mediumConfLinks: costPerPr.mediumConfLinks,
      pctClaude: costPerPr.pctClaude,
      pctCodex: costPerPr.pctCodex,
      pctCursor: costPerPr.pctCursor,
      pctHuman: costPerPr.pctHuman,
      pctBot: costPerPr.pctBot,
    })
    .from(pr)
    .leftJoin(costPerPr, eq(costPerPr.prId, pr.id))
    .where(and(eq(pr.orgId, auth.org.id), gte(pr.createdAt, since)))
    .orderBy(desc(pr.mergedAt))
    .limit(500);

  return NextResponse.json({ orgSlug, window: windowKey, rows });
}
