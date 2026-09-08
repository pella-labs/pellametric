// F3.24 — Intent page. Calendar heatmap (sessions/day) + intent-frequency
// breakdown. Both are reads against session_event; no extra schema needed.

import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq, gte } from "drizzle-orm";
import { requireMembership } from "@/lib/auth-middleware";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { db } from "@/lib/db";
import { sessionEvent } from "@/lib/db/schema";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";

export const dynamic = "force-dynamic";

export default async function IntentPage({
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

  const since = new Date(Date.now() - 84 * 86_400_000);
  const rows = await db
    .select({
      startedAt: sessionEvent.startedAt,
      intentTop: sessionEvent.intentTop,
      errors: sessionEvent.errors,
    })
    .from(sessionEvent)
    .where(and(eq(sessionEvent.orgId, auth.org.id), gte(sessionEvent.startedAt, since)));

  // Daily counts for the heatmap.
  const dailyCount = new Map<string, number>();
  const intentCounts = new Map<string, { sessions: number; errors: number }>();
  for (const r of rows) {
    const k = r.startedAt.toISOString().slice(0, 10);
    dailyCount.set(k, (dailyCount.get(k) ?? 0) + 1);
    const intent = r.intentTop ?? "(unclassified)";
    const v = intentCounts.get(intent) ?? { sessions: 0, errors: 0 };
    v.sessions++;
    if (r.errors > 0) v.errors++;
    intentCounts.set(intent, v);
  }
  const cells = Array.from(dailyCount.entries()).map(([day, value]) => ({ day, value }));
  const intentSorted = Array.from(intentCounts.entries())
    .map(([intent, v]) => ({ intent, ...v }))
    .sort((a, b) => b.sessions - a.sessions);

  return (
    <div className="p-6 space-y-6">
      <header>
        <p className="mk-eyebrow">Intent · last 12 weeks</p>
        <h1 className="mk-heading text-2xl">When are devs using AI, and for what?</h1>
      </header>

      <div className="mk-panel">
        <p className="mk-label mb-2">Daily session volume</p>
        <CalendarHeatmap cells={cells} days={84} metricLabel="sessions" />
      </div>

      <div className="mk-panel">
        <p className="mk-label mb-2">Intent frequency · last 84d</p>
        {intentSorted.length === 0 ? (
          <p className="mk-table-cell text-(--muted-foreground)">no sessions in window</p>
        ) : (
          <table className="w-full mk-table-cell">
            <thead className="text-left border-b border-(--border) text-(--muted-foreground)">
              <tr>
                <th className="py-2 pr-2">Intent</th>
                <th className="py-2 px-2 text-right">Sessions</th>
                <th className="py-2 px-2 text-right">Errors</th>
                <th className="py-2 pl-2 text-right">Error rate</th>
              </tr>
            </thead>
            <tbody>
              {intentSorted.map(r => {
                const rate = r.sessions > 0 ? (r.errors / r.sessions) * 100 : 0;
                return (
                  <tr key={r.intent} className="border-b border-(--border)">
                    <td className="py-2 pr-2 text-(--foreground)">{r.intent}</td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{r.sessions}</td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{r.errors}</td>
                    <td className="py-2 pl-2 text-right text-(--muted-foreground)">
                      {rate.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mk-table-cell text-(--muted-foreground)">
        Want a different cut? Open the{" "}
        <Link href={`/org/${provider}/${slug}/insights`} className="text-(--accent) hover:underline">
          insight builder
        </Link>{" "}
        with breakdown=intent.
      </p>
    </div>
  );
}
