// F3.26 — Dev overview with Sankey hero per §2.4.
// Replaces the plain table the previous orchestrator shipped.

import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq, desc, gte, inArray } from "drizzle-orm";
import { requireMembership } from "@/lib/auth-middleware";
import { SourceChip } from "@/components/data/source-chip";
import { KpiTile } from "@/components/data/kpi-tile";
import { SankeyChart, type SankeyNode, type SankeyLink } from "@/components/charts/sankey-chart";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { costFor } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function money(x: number): string {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string; slug: string }>;
}) {
  const { provider, slug } = await params;
  const memb = await requireMembership(slug, { provider });
  if (memb instanceof Response) {
    return <div className="p-8 mk-table-cell">Access denied.</div>;
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return <div className="p-8 mk-table-cell">Not signed in.</div>;
  }

  const since = new Date(Date.now() - 30 * 86_400_000);
  const sessions = await db
    .select()
    .from(schema.sessionEvent)
    .where(
      and(
        eq(schema.sessionEvent.userId, userId),
        eq(schema.sessionEvent.orgId, memb.org.id),
        gte(schema.sessionEvent.startedAt, since),
      ),
    )
    .orderBy(desc(schema.sessionEvent.startedAt));

  // Session → PR links (high/med only) for the Sankey.
  const sIds = sessions.map(s => s.id);
  const links = sIds.length > 0
    ? await db
        .select()
        .from(schema.sessionPrLink)
        .where(
          and(
            inArray(schema.sessionPrLink.sessionEventId, sIds),
            inArray(schema.sessionPrLink.confidence, ["high", "medium"]),
          ),
        )
    : [];
  const linkedPrIds = Array.from(new Set(links.map(l => l.prId)));
  const prs = linkedPrIds.length > 0
    ? await db.select().from(schema.pr).where(inArray(schema.pr.id, linkedPrIds))
    : [];
  const prById = new Map(prs.map(p => [p.id, p]));

  // KPI strip values.
  let totalSpend = 0;
  let totalTokensOut = 0;
  for (const s of sessions) {
    totalSpend += costFor(s.model, {
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead,
      tokensCacheWrite: s.tokensCacheWrite,
    });
    totalTokensOut += s.tokensOut;
  }
  const linkedPrIdsHigh = new Set(
    links.filter(l => l.confidence === "high").map(l => l.prId),
  );
  const prsMerged = prs.filter(p => p.state === "merged" && linkedPrIdsHigh.has(p.id)).length;

  // Sankey: source-intent → PR node. Weight = tokensOut summed over linking sessions.
  const sessionsById = new Map(sessions.map(s => [s.id, s]));
  const sourceIntentKey = (s: typeof sessions[number]) => `${s.source}·${s.intentTop ?? "—"}`;
  const sourceIntentLabels = new Map<string, { label: string; source: SankeyNode["source"] }>();
  const linkWeights = new Map<string, number>(); // key: source-intent|prId
  for (const l of links) {
    const s = sessionsById.get(l.sessionEventId);
    if (!s) continue;
    const k = sourceIntentKey(s);
    sourceIntentLabels.set(k, {
      label: `${s.intentTop ?? "session"} · ${s.source}`,
      source: (s.source as SankeyNode["source"]) ?? "human",
    });
    const w = s.tokensOut;
    const key = `${k}|${l.prId}`;
    linkWeights.set(key, (linkWeights.get(key) ?? 0) + w);
  }
  const sankeyNodes: SankeyNode[] = [];
  const sankeyLinks: SankeyLink[] = [];
  for (const [k, meta] of sourceIntentLabels) {
    sankeyNodes.push({
      id: `src-${k}`,
      label: meta.label,
      kind: "session",
      source: meta.source,
    });
  }
  for (const p of prs) {
    sankeyNodes.push({
      id: `pr-${p.id}`,
      label: `#${p.number} ${p.state}`,
      kind: "pr",
    });
  }
  for (const [key, value] of linkWeights) {
    if (value <= 0) continue;
    const [srcKey, prId] = key.split("|");
    sankeyLinks.push({
      source: `src-${srcKey}`,
      target: `pr-${prId}`,
      value,
    });
  }

  // Calendar of activity.
  const heatmap = new Map<string, number>();
  for (const s of sessions) {
    const k = s.startedAt.toISOString().slice(0, 10);
    heatmap.set(k, (heatmap.get(k) ?? 0) + 1);
  }
  const heatmapCells = Array.from(heatmap.entries()).map(([day, value]) => ({ day, value }));

  const base = `/me/${provider}/${slug}`;
  return (
    <div className="p-6 space-y-6">
      <header>
        <p className="mk-eyebrow">Me · last 30d</p>
        <h1 className="mk-heading text-2xl">Your sessions → commits → merged PRs</h1>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Sessions" value={String(sessions.length)} caption="last 30d" />
        <KpiTile
          label="Tokens out"
          value={totalTokensOut >= 1e6 ? `${(totalTokensOut / 1e6).toFixed(1)}M` : totalTokensOut.toLocaleString()}
          caption="last 30d"
        />
        <KpiTile label="Spend" value={money(totalSpend)} caption="last 30d" goodDirection="down" />
        <KpiTile label="PRs merged · high-conf link" value={String(prsMerged)} caption="last 30d" />
      </div>

      {/* Sankey hero */}
      <div className="mk-panel">
        <p className="mk-label mb-2">Session → PR flow</p>
        {sankeyNodes.length === 0 ? (
          <p className="mk-table-cell text-(--muted-foreground)">
            No high/medium confidence links yet — once lineage runs, this hero will show
            your session → commit → PR flow.
          </p>
        ) : (
          <SankeyChart nodes={sankeyNodes} links={sankeyLinks} width={980} height={Math.max(280, sankeyNodes.length * 18)} />
        )}
      </div>

      {/* Activity calendar */}
      <div className="mk-panel">
        <p className="mk-label mb-2">Daily session volume · last 12 weeks</p>
        <CalendarHeatmap cells={heatmapCells} days={84} metricLabel="sessions" />
      </div>

      {/* Recent sessions */}
      <div className="mk-panel">
        <div className="flex items-baseline justify-between mb-3">
          <p className="mk-label">Recent sessions</p>
          <Link href={`${base}/sessions`} className="mk-table-cell text-(--accent) hover:underline">
            All sessions →
          </Link>
        </div>
        {sessions.length === 0 ? (
          <p className="mk-table-cell text-(--muted-foreground)">No sessions in the last 30 days.</p>
        ) : (
          <table className="w-full mk-table-cell">
            <thead>
              <tr className="text-left border-b border-(--border) text-(--muted-foreground)">
                <th className="py-2 pr-2">When</th>
                <th className="py-2 px-2">Source</th>
                <th className="py-2 px-2">Intent</th>
                <th className="py-2 px-2">Repo</th>
                <th className="py-2 pl-2 text-right">Tokens out</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 16).map(s => (
                <tr key={s.id} className="border-b border-(--border) hover:bg-(--secondary)">
                  <td className="py-2 pr-2">
                    <Link href={`${base}/sessions/${s.id}`} className="text-(--foreground) hover:underline">
                      {s.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </Link>
                  </td>
                  <td className="py-2 px-2">
                    <SourceChip kind={s.source as "claude" | "codex" | "cursor"} />
                  </td>
                  <td className="py-2 px-2 text-(--muted-foreground)">{s.intentTop ?? "—"}</td>
                  <td className="py-2 px-2 text-(--muted-foreground) truncate max-w-[280px]">{s.repo}</td>
                  <td className="py-2 pl-2 text-right text-(--foreground)">{s.tokensOut.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
