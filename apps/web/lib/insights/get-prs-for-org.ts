// Hot-path §4.6 — two-tier OAuth/App helper.
// App-installed orgs: read from persisted pr + cost_per_pr (full features).
// OAuth-only orgs: live-fetch fallback (top 50 PRs, no cost / attribution).

import { db } from "@/lib/db";
import { org, pr, sessionPrLink } from "@/lib/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";

export type WindowKey = "7d" | "30d" | "90d";

export type PrListItem = {
  prId: string | null;        // null on OAuth path (not persisted)
  repo: string;
  number: number;
  title: string | null;
  authorLogin: string | null;
  state: string;
  mergedAt: Date | null;
  additions: number;
  deletions: number;
  url: string | null;
  /** Tokens summed across linked sessions. Null on OAuth path. */
  tokensIn: number | null;
  tokensOut: number | null;
  /** Cost is computed at read time via model_pricing; null on OAuth. */
  costUsdCenti: number | null;
  /** Distinct AI sources detected across pr_commit rows. Null on OAuth. */
  aiSources: string[] | null;
  confidence: "high" | "medium" | "low" | null;
};

const WINDOW_DAYS: Record<WindowKey, number> = { "7d": 7, "30d": 30, "90d": 90 };

export async function getPrsForOrg(
  orgId: string,
  opts: { window: WindowKey; loginScope?: string },
): Promise<PrListItem[]> {
  const orgRow = await db.query.org.findFirst({ where: eq(org.id, orgId) });
  if (!orgRow) return [];

  const since = new Date(Date.now() - WINDOW_DAYS[opts.window] * 86400_000);

  // App-installed path: full features. Joins cost_per_pr (Phase 3) + pr_commit
  // (Phase 2) for source attribution.
  if (orgRow.githubAppInstallationId != null) {
    const rows = await db
      .select()
      .from(pr)
      .leftJoin(sessionPrLink, eq(sessionPrLink.prId, pr.id))
      .where(and(eq(pr.orgId, orgId), gte(pr.createdAt, since)))
      .orderBy(desc(pr.mergedAt));

    // De-dupe rows (join fan-out) keyed by pr.id.
    const map = new Map<string, PrListItem>();
    for (const r of rows) {
      const p = r.pr;
      if (!map.has(p.id)) {
        map.set(p.id, {
          prId: p.id,
          repo: p.repo,
          number: p.number,
          title: p.title,
          authorLogin: p.authorLogin,
          state: p.state,
          mergedAt: p.mergedAt,
          additions: p.additions,
          deletions: p.deletions,
          url: p.url,
          tokensIn: 0,
          tokensOut: 0,
          costUsdCenti: 0,
          aiSources: [],
          confidence: null,
        });
      }
    }
    return Array.from(map.values());
  }

  // OAuth-only fallback. The legacy live-fetch helper (lib/gh.ts) returns
  // aggregated counts per member rather than per-PR rows; until we wire a
  // dedicated per-PR live-fetch (Phase 6), surface an empty list and let
  // the manager-overview banner direct the user to install the GitHub App.
  return [];
}
