// Reader for PR detail page. Joins pr + cost_per_pr + session_pr_link + sessionEvent.

import { db } from "@/lib/db";
import { pr, costPerPr, sessionPrLink, sessionEvent, user, prCommit } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export type PrDetail = {
  pr: typeof pr.$inferSelect;
  cost: typeof costPerPr.$inferSelect | null;
  links: Array<{
    sessionEventId: string;
    confidence: string;
    confidenceScore: number;
    cwdMatch: boolean;
    branchMatch: boolean;
    timeOverlap: string;
    session: typeof sessionEvent.$inferSelect & { userLogin: string | null };
  }>;
  revertedBy: { id: string; number: number } | null;
};

export async function getPrDetail(orgId: string, repo: string, number: number): Promise<PrDetail | null> {
  const prRow = await db.query.pr.findFirst({
    where: and(eq(pr.orgId, orgId), eq(pr.repo, repo), eq(pr.number, number)),
  });
  if (!prRow) return null;

  const cost = (await db.query.costPerPr.findFirst({ where: eq(costPerPr.prId, prRow.id) })) ?? null;

  const linkRows = await db
    .select()
    .from(sessionPrLink)
    .where(eq(sessionPrLink.prId, prRow.id));

  const sessIds = linkRows.map(l => l.sessionEventId);
  const sessRows = sessIds.length
    ? await db.select().from(sessionEvent).where(inArray(sessionEvent.id, sessIds))
    : [];
  const userIds = Array.from(new Set(sessRows.map(s => s.userId)));
  const userRows = userIds.length
    ? await db
        .select({ id: user.id, githubLogin: user.githubLogin })
        .from(user)
        .where(inArray(user.id, userIds))
    : [];
  const loginByUser = new Map(userRows.map(u => [u.id, u.githubLogin]));
  const sessById = new Map(sessRows.map(s => [s.id, s]));

  const links = linkRows
    .map(l => {
      const s = sessById.get(l.sessionEventId);
      if (!s) return null;
      return {
        sessionEventId: l.sessionEventId,
        confidence: l.confidence,
        confidenceScore: l.confidenceScore,
        cwdMatch: l.cwdMatch,
        branchMatch: l.branchMatch,
        timeOverlap: l.timeOverlap,
        session: { ...s, userLogin: loginByUser.get(s.userId) ?? null },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  // Reverted-by: a PR whose revertsPrId points at this pr.id.
  const reverter = await db
    .select({ id: pr.id, number: pr.number })
    .from(pr)
    .where(and(eq(pr.orgId, orgId), eq(pr.revertsPrId, prRow.id)))
    .limit(1);
  const revertedBy = reverter[0] ?? null;

  return { pr: prRow, cost, links, revertedBy };
}

export async function getPrCommitsCounts(prId: string): Promise<{
  totalCommits: number;
  byAiSource: Record<string, number>;
}> {
  const rows = await db
    .select({ aiSources: prCommit.aiSources })
    .from(prCommit)
    .where(and(eq(prCommit.prId, prId), eq(prCommit.kind, "commit")));
  const byAiSource: Record<string, number> = {};
  for (const r of rows) {
    for (const s of (r.aiSources ?? [])) {
      byAiSource[s] = (byAiSource[s] ?? 0) + 1;
    }
  }
  return { totalCommits: rows.length, byAiSource };
}
