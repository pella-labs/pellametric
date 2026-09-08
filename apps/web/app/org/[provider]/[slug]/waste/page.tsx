// F3.23 — Waste page per design council §2.7.
// Three-column summary (stuck sessions / abandoned work / top sinks) + table
// of stuck/abandoned sessions. Stuck = session with errors > 0 OR
// wall_sec > 2h cap with no linked PR. Abandoned = sessions without any
// linked commit/PR.

import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq, gte, inArray } from "drizzle-orm";
import { requireMembership } from "@/lib/auth-middleware";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { db } from "@/lib/db";
import { sessionEvent, sessionPrLink, user } from "@/lib/db/schema";
import { costFor } from "@/lib/pricing";
import { SourceChip } from "@/components/data/source-chip";

export const dynamic = "force-dynamic";

const SESSION_CAP_SEC = 2 * 60 * 60;

function money(x: number): string {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

export default async function WastePage({
  params,
}: {
  params: Promise<{ provider: string; slug: string }>;
}) {
  if (!insightsRevampEnabled()) notFound();
  const { provider, slug } = await params;
  const auth = await requireMembership(slug, { provider });
  if (auth instanceof Response) {
    return <div className="p-8 mk-table-cell">Access denied.</div>;
  }

  const since = new Date(Date.now() - 30 * 86_400_000);
  const sessions = await db
    .select()
    .from(sessionEvent)
    .where(and(eq(sessionEvent.orgId, auth.org.id), gte(sessionEvent.startedAt, since)));

  const linked = await db
    .select({ sessionEventId: sessionPrLink.sessionEventId, confidence: sessionPrLink.confidence })
    .from(sessionPrLink)
    .where(inArray(sessionPrLink.sessionEventId, sessions.map(s => s.id)));
  const linkedHighMed = new Set(
    linked.filter(l => l.confidence === "high" || l.confidence === "medium").map(l => l.sessionEventId),
  );

  // Resolve logins.
  const userIds = Array.from(new Set(sessions.map(s => s.userId)));
  const userRows = userIds.length > 0
    ? await db.select({ id: user.id, login: user.githubLogin }).from(user).where(inArray(user.id, userIds))
    : [];
  const loginByUser = new Map(userRows.map(u => [u.id, u.login]));

  const stuck: typeof sessions = [];
  const abandoned: typeof sessions = [];
  const sinkBy: Record<string, { tokens: number; cost: number; sessions: number }> = {};
  let stuckCost = 0;
  let abandonedCost = 0;

  for (const s of sessions) {
    const wall = Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000));
    const cost = costFor(s.model, {
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead,
      tokensCacheWrite: s.tokensCacheWrite,
    });
    const intent = s.intentTop ?? "(unclassified)";
    if (!sinkBy[intent]) sinkBy[intent] = { tokens: 0, cost: 0, sessions: 0 };
    sinkBy[intent].tokens += s.tokensOut;
    sinkBy[intent].cost += cost;
    sinkBy[intent].sessions++;

    const isLinked = linkedHighMed.has(s.id);
    if (s.errors > 0 || (wall > SESSION_CAP_SEC && !isLinked)) {
      stuck.push(s);
      stuckCost += cost;
    } else if (!isLinked) {
      abandoned.push(s);
      abandonedCost += cost;
    }
  }

  const topSinks = Object.entries(sinkBy)
    .map(([intent, v]) => ({ intent, ...v }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 6);

  const wasteRows = [...stuck.map(s => ({ s, status: "stuck" })), ...abandoned.map(s => ({ s, status: "abandoned" }))]
    .sort((a, b) => b.s.startedAt.getTime() - a.s.startedAt.getTime())
    .slice(0, 24);

  return (
    <div className="p-6 space-y-6">
      <header>
        <p className="mk-eyebrow">Waste · last 30d</p>
        <h1 className="mk-heading text-2xl">Where is effort leaking?</h1>
        <p className="mk-table-cell text-(--muted-foreground)">
          A session is "stuck" when it errors or runs past the 2-hour cap with no linked
          high-confidence PR. "Abandoned" when nothing high-confidence ever links to it.
        </p>
      </header>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="mk-panel">
          <p className="mk-label">Stuck sessions</p>
          <p className="mk-stat-numeric text-(--foreground)">{stuck.length}</p>
          <p className="mk-table-cell text-(--muted-foreground)">{money(stuckCost)} cost · last 30d</p>
        </div>
        <div className="mk-panel">
          <p className="mk-label">Abandoned work</p>
          <p className="mk-stat-numeric text-(--foreground)">{abandoned.length}</p>
          <p className="mk-table-cell text-(--muted-foreground)">{money(abandonedCost)} cost · last 30d</p>
        </div>
        <div className="mk-panel">
          <p className="mk-label">Top sinks</p>
          <ul className="space-y-1 mt-2 mk-table-cell">
            {topSinks.length === 0 && <li className="text-(--muted-foreground)">no data</li>}
            {topSinks.map(s => (
              <li key={s.intent} className="flex items-baseline gap-2">
                <span className="text-(--foreground) flex-1 truncate">{s.intent}</span>
                <span className="text-(--muted-foreground)">{s.sessions}s</span>
                <span className="text-(--foreground)">{money(s.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mk-panel">
        <p className="mk-label mb-2">Recent stuck or abandoned sessions</p>
        {wasteRows.length === 0 ? (
          <p className="mk-table-cell text-(--muted-foreground)">none in window</p>
        ) : (
          <table className="w-full mk-table-cell">
            <thead className="text-left border-b border-(--border) text-(--muted-foreground)">
              <tr>
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 px-2">Dev</th>
                <th className="py-2 px-2">Source</th>
                <th className="py-2 px-2">Intent</th>
                <th className="py-2 px-2 text-right">Duration</th>
                <th className="py-2 px-2 text-right">Cost</th>
                <th className="py-2 pl-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {wasteRows.map(({ s, status }) => {
                const wall = Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60));
                const cost = costFor(s.model, {
                  tokensIn: s.tokensIn,
                  tokensOut: s.tokensOut,
                  tokensCacheRead: s.tokensCacheRead,
                  tokensCacheWrite: s.tokensCacheWrite,
                });
                return (
                  <tr key={s.id} className="border-b border-(--border)">
                    <td className="py-2 pr-2 text-(--muted-foreground)">
                      {s.startedAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2 px-2 text-(--foreground)">
                      {loginByUser.get(s.userId) ?? s.userId.slice(0, 6)}
                    </td>
                    <td className="py-2 px-2">
                      <SourceChip kind={s.source as "claude" | "codex" | "cursor"} />
                    </td>
                    <td className="py-2 px-2 text-(--muted-foreground)">
                      {s.intentTop ?? "(unclassified)"}
                    </td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{wall}m</td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{money(cost)}</td>
                    <td className="py-2 pl-2 text-(--foreground)">
                      {status === "stuck" ? (
                        <span className="text-(--warning)">⚠ stuck</span>
                      ) : (
                        <span className="text-(--muted-foreground)">abandoned</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mk-table-cell text-(--muted-foreground)">
        Tip: hit the{" "}
        <Link href={`/org/${provider}/${slug}/insights`} className="text-(--accent) hover:underline">
          insight builder
        </Link>{" "}
        with metric=Errors and breakdown=intent to find the top error sources.
      </p>
    </div>
  );
}
