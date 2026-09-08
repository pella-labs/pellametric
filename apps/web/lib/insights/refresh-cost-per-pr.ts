// Phase 3 T3.4 — cost_per_pr rollup.
// - Token sums from session_event ⋈ session_pr_link (confidence in high/medium).
// - Source-mix from pr_commit.aiSources (commits of kind='commit' only; each
//   commit's additions count fully toward every source in its aiSources array,
//   then normalized to 100).
// - priceVersion = max(model_pricing.id) for any model in linked sessions.
// - Stacked PR adjustment (P11): subtract sessions already attributed to
//   children whose pr.stackedOn=$parent.

import { db } from "@/lib/db";
import {
  sessionEvent,
  sessionPrLink,
  pr,
  prCommit,
  costPerPr,
  modelPricing,
} from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  subtractOverlap,
  priceVersionFromMaxCreatedAt,
  type SessionLink,
  type SessionTokens,
} from "@/lib/insights/rollup-math";

export async function refreshCostPerPr(prId: string): Promise<void> {
  const prRow = await db.query.pr.findFirst({ where: eq(pr.id, prId) });
  if (!prRow) return;

  // Linked sessions with confidence in high/medium (drop low).
  const links = await db
    .select({
      sessionEventId: sessionPrLink.sessionEventId,
      confidence: sessionPrLink.confidence,
    })
    .from(sessionPrLink)
    .where(
      and(
        eq(sessionPrLink.prId, prId),
        inArray(sessionPrLink.confidence, ["high", "medium"]),
      ),
    );

  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCacheRead = 0;
  let tokensCacheWrite = 0;
  let totalSessionWallSec = 0;
  let highConfLinks = 0;
  let mediumConfLinks = 0;
  const linkedUsers = new Set<string>();
  const modelsSeen = new Set<string>();

  if (links.length > 0) {
    const sessionIds = links.map(l => l.sessionEventId);
    const sessions = await db
      .select()
      .from(sessionEvent)
      .where(inArray(sessionEvent.id, sessionIds));
    for (const s of sessions) {
      tokensIn += s.tokensIn;
      tokensOut += s.tokensOut;
      tokensCacheRead += s.tokensCacheRead;
      tokensCacheWrite += s.tokensCacheWrite;
      totalSessionWallSec += Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000));
      linkedUsers.add(s.userId);
      if (s.model) modelsSeen.add(s.model);
    }
    for (const l of links) {
      if (l.confidence === "high") highConfLinks++;
      else if (l.confidence === "medium") mediumConfLinks++;
    }
  }

  // P11 (C2 fix): subtract only sessions linked to BOTH the parent and a
  // child PR. Math is in subtractOverlap() — see rollup-math.ts for the why.
  if (links.length > 0) {
    const children = await db
      .select({ id: pr.id })
      .from(pr)
      .where(eq(pr.stackedOn, prId));
    if (children.length > 0) {
      const childIds = children.map(c => c.id);
      const childLinks = await db
        .select({
          sessionEventId: sessionPrLink.sessionEventId,
          confidence: sessionPrLink.confidence,
        })
        .from(sessionPrLink)
        .where(inArray(sessionPrLink.prId, childIds));
      const parentLinksTyped: SessionLink[] = links.map(l => ({
        sessionEventId: l.sessionEventId,
        confidence: l.confidence as SessionLink["confidence"],
      }));
      const childLinksTyped: SessionLink[] = childLinks.map(l => ({
        sessionEventId: l.sessionEventId,
        confidence: l.confidence as SessionLink["confidence"],
      }));
      // Only fetch session rows we might subtract — the overlap set.
      const parentSet = new Set(parentLinksTyped.map(l => l.sessionEventId));
      const candidateOverlap = Array.from(
        new Set(
          childLinksTyped
            .filter(l => l.confidence === "high" || l.confidence === "medium")
            .map(l => l.sessionEventId)
            .filter(id => parentSet.has(id)),
        ),
      );
      if (candidateOverlap.length > 0) {
        const childSessionRows = await db
          .select()
          .from(sessionEvent)
          .where(inArray(sessionEvent.id, candidateOverlap));
        const childSessions: SessionTokens[] = childSessionRows.map(s => ({
          id: s.id,
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
          tokensCacheRead: s.tokensCacheRead,
          tokensCacheWrite: s.tokensCacheWrite,
        }));
        const adjusted = subtractOverlap(
          { tokensIn, tokensOut, tokensCacheRead, tokensCacheWrite },
          parentLinksTyped,
          childLinksTyped,
          childSessions,
        );
        tokensIn = adjusted.tokensIn;
        tokensOut = adjusted.tokensOut;
        tokensCacheRead = adjusted.tokensCacheRead;
        tokensCacheWrite = adjusted.tokensCacheWrite;
      }
    }
  }

  // Source mix from pr_commit (kind='commit' only; merge/squash excluded from %s).
  const commits = await db
    .select({
      additions: prCommit.additions,
      aiSources: prCommit.aiSources,
    })
    .from(prCommit)
    .where(and(eq(prCommit.prId, prId), eq(prCommit.kind, "commit")));

  const counts: Record<string, number> = { claude: 0, codex: 0, cursor: 0, human: 0, bot: 0 };
  let totalAdditions = 0;
  for (const c of commits) {
    const adds = c.additions ?? 0;
    if (adds <= 0) continue;
    totalAdditions += adds;
    const sources = c.aiSources ?? [];
    if (sources.length === 0) {
      counts.human += adds;
      continue;
    }
    for (const s of sources) {
      if (s in counts) counts[s] += adds;
    }
  }

  const denom = totalAdditions || 1;
  const rawPct = {
    claude: (counts.claude / denom) * 100,
    codex: (counts.codex / denom) * 100,
    cursor: (counts.cursor / denom) * 100,
    human: (counts.human / denom) * 100,
    bot: (counts.bot / denom) * 100,
  };
  // Normalize to sum=100 (the multi-source overcount means sum may exceed 100).
  const rawSum = rawPct.claude + rawPct.codex + rawPct.cursor + rawPct.human + rawPct.bot;
  const factor = rawSum > 0 ? 100 / rawSum : 0;
  const pct = {
    claude: Math.round(rawPct.claude * factor),
    codex: Math.round(rawPct.codex * factor),
    cursor: Math.round(rawPct.cursor * factor),
    human: Math.round(rawPct.human * factor),
    bot: Math.round(rawPct.bot * factor),
  };

  // priceVersion (C1 fix): epoch seconds of the newest model_pricing row for
  // any model seen on this PR's linked sessions. Pure helper in rollup-math.ts.
  let priceVersion = 0;
  if (modelsSeen.size > 0) {
    const [maxRow] = await db
      .select({
        maxCreated: sql<Date | null>`max(${modelPricing.createdAt})`,
      })
      .from(modelPricing)
      .where(inArray(modelPricing.model, Array.from(modelsSeen)));
    priceVersion = priceVersionFromMaxCreatedAt(maxRow?.maxCreated ?? null);
  }

  const values = {
    prId,
    orgId: prRow.orgId,
    linkedSessions: links.length,
    linkedUsers: linkedUsers.size,
    tokensIn,
    tokensOut,
    tokensCacheRead,
    tokensCacheWrite,
    totalSessionWallSec,
    highConfLinks,
    mediumConfLinks,
    pctClaude: pct.claude,
    pctCodex: pct.codex,
    pctCursor: pct.cursor,
    pctHuman: pct.human,
    pctBot: pct.bot,
    priceVersion,
    computedAt: new Date(),
  };

  await db
    .insert(costPerPr)
    .values(values)
    .onConflictDoUpdate({
      target: costPerPr.prId,
      set: {
        linkedSessions: values.linkedSessions,
        linkedUsers: values.linkedUsers,
        tokensIn: values.tokensIn,
        tokensOut: values.tokensOut,
        tokensCacheRead: values.tokensCacheRead,
        tokensCacheWrite: values.tokensCacheWrite,
        totalSessionWallSec: values.totalSessionWallSec,
        highConfLinks: values.highConfLinks,
        mediumConfLinks: values.mediumConfLinks,
        pctClaude: values.pctClaude,
        pctCodex: values.pctCodex,
        pctCursor: values.pctCursor,
        pctHuman: values.pctHuman,
        pctBot: values.pctBot,
        priceVersion: values.priceVersion,
        computedAt: values.computedAt,
      },
    });
}
