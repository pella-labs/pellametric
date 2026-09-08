// Pure helpers used by refresh-cost-per-pr and refresh-daily-org-stats.
// Extracted so the bug-fix math (C1, C2, C3) is testable without a DB.

export type TokenBuckets = {
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
};

export type SessionLink = {
  sessionEventId: string;
  confidence: "high" | "medium" | "low";
};

export type SessionTokens = TokenBuckets & {
  id: string;
};

/**
 * C2 fix: stacked-PR subtraction. Subtract only sessions that are linked to
 * BOTH the parent and a child PR with high/medium confidence — the
 * intersection. The previous implementation subtracted every child-linked
 * session even when it was not linked to the parent at all, then clamped to
 * zero — masking the over-subtraction.
 *
 * Returns the adjusted token totals. Inputs are not mutated.
 */
export function subtractOverlap(
  parent: TokenBuckets,
  parentLinks: SessionLink[],
  childLinks: SessionLink[],
  childSessions: SessionTokens[],
): TokenBuckets {
  const parentIds = new Set(parentLinks.map(l => l.sessionEventId));
  const overlap = new Set(
    childLinks
      .filter(l => l.confidence === "high" || l.confidence === "medium")
      .map(l => l.sessionEventId)
      .filter(id => parentIds.has(id)),
  );
  let tokensIn = parent.tokensIn;
  let tokensOut = parent.tokensOut;
  let tokensCacheRead = parent.tokensCacheRead;
  let tokensCacheWrite = parent.tokensCacheWrite;
  for (const s of childSessions) {
    if (!overlap.has(s.id)) continue;
    tokensIn -= s.tokensIn;
    tokensOut -= s.tokensOut;
    tokensCacheRead -= s.tokensCacheRead;
    tokensCacheWrite -= s.tokensCacheWrite;
  }
  return { tokensIn, tokensOut, tokensCacheRead, tokensCacheWrite };
}

/**
 * C1 fix: monotonic priceVersion. Given the newest model_pricing.createdAt
 * across all models seen on a PR's sessions, returns its epoch in seconds.
 * `null` (no models matched) maps to 0.
 */
export function priceVersionFromMaxCreatedAt(maxCreatedAt: Date | null): number {
  if (!maxCreatedAt) return 0;
  return Math.floor(maxCreatedAt.getTime() / 1000);
}

export type PerSourceSum = {
  source: string;
  sessions: number;
  activeHoursCenti: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
};

export type DailyOrgStatRow = {
  source: string;
  sessions: number;
  activeHoursCenti: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  prsMerged: number;
  prsMergedAiAssisted: number;
  prsMergedBot: number;
  prsReverted: number;
};

export const META_SOURCE = "_meta";

/**
 * C3 fix: route PR counts to a single synthetic `_meta` row, write 0 PR counts
 * on every per-source row. Readers that want daily PR counts filter
 * `WHERE source='_meta'`. The previous implementation wrote the same PR counts
 * on every per-source row, so SUM(prsMerged) across sources double-counted.
 *
 * Returns the full row set to upsert into daily_org_stats. Always includes the
 * `_meta` row, even on days with no per-source activity.
 */
export function buildDailyOrgStatsRows(
  perSourceSums: PerSourceSum[],
  prCounts: {
    prsMerged: number;
    prsMergedAiAssisted: number;
    prsMergedBot: number;
    prsReverted: number;
  },
): DailyOrgStatRow[] {
  const out: DailyOrgStatRow[] = [];
  for (const s of perSourceSums) {
    if (s.source === META_SOURCE) continue;
    out.push({
      source: s.source,
      sessions: s.sessions,
      activeHoursCenti: s.activeHoursCenti,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead,
      tokensCacheWrite: s.tokensCacheWrite,
      prsMerged: 0,
      prsMergedAiAssisted: 0,
      prsMergedBot: 0,
      prsReverted: 0,
    });
  }
  out.push({
    source: META_SOURCE,
    sessions: 0,
    activeHoursCenti: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    prsMerged: prCounts.prsMerged,
    prsMergedAiAssisted: prCounts.prsMergedAiAssisted,
    prsMergedBot: prCounts.prsMergedBot,
    prsReverted: prCounts.prsReverted,
  });
  return out;
}
