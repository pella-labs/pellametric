// F3.22 — Devs leaderboard. /org/[provider]/[slug]/devs
// Dense table per design council §4.3 (Linear/Swarmia density).
// Reuses ManagerOverviewData's per-dev aggregation.

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMembership } from "@/lib/auth-middleware";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { getManagerOverviewData } from "@/lib/insights/manager-overview-data";
import { Sparkline } from "@/components/data/sparkline";

export const dynamic = "force-dynamic";

function money(x: number): string {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

export default async function DevsPage({
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
  const data = await getManagerOverviewData(auth.org.id, 30);
  const base = `/org/${provider}/${slug}`;
  const totalSessions = data.topDevs.reduce((s, d) => s + d.sessions, 0);
  const totalPrs = data.topDevs.reduce((s, d) => s + d.prsMerged, 0);
  const totalSpend = data.topDevs.reduce((s, d) => s + d.spendUsd, 0);

  return (
    <div className="p-6 space-y-6">
      <header>
        <p className="mk-eyebrow">Devs · last 30d</p>
        <h1 className="mk-heading text-2xl">Team leaderboard</h1>
        <p className="mk-table-cell text-(--muted-foreground)">
          {data.topDevs.length} devs · {totalSessions.toLocaleString()} sessions ·
          {" "}{totalPrs} PRs merged · {money(totalSpend)} spend
        </p>
      </header>

      <div className="mk-panel">
        {data.topDevs.length === 0 ? (
          <p className="mk-table-cell text-(--muted-foreground)">
            no devs with sessions yet
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-(--border) mk-table-cell text-(--muted-foreground)">
                <th className="py-2 pr-2">Dev</th>
                <th className="py-2 px-2 text-right">Sessions</th>
                <th className="py-2 px-2 text-right">PRs merged</th>
                <th className="py-2 px-2 text-right">Spend</th>
                <th className="py-2 px-2 text-right">$/PR</th>
                <th className="py-2 pl-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.topDevs.map(d => {
                const dollarPerPr = d.prsMerged > 0 ? d.spendUsd / d.prsMerged : 0;
                return (
                  <tr key={d.login} className="border-b border-(--border) mk-table-cell hover:bg-(--secondary)">
                    <td className="py-2 pr-2">
                      <Link
                        href={`${base}/devs/${d.login}`}
                        className="text-(--foreground) hover:underline"
                      >
                        {d.login}
                      </Link>
                    </td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{d.sessions}</td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{d.prsMerged}</td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{money(d.spendUsd)}</td>
                    <td className="py-2 px-2 text-right text-(--muted-foreground)">
                      {d.prsMerged > 0 ? money(dollarPerPr) : "—"}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <Link
                        href={`${base}/devs/${d.login}`}
                        className="text-(--accent) hover:underline"
                      >
                        view →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mk-table-cell text-(--muted-foreground)">
        Want to slice this differently?{" "}
        <Link href={`${base}/insights`} className="text-(--accent) hover:underline">
          Open the insight builder
        </Link>{" "}
        and switch the breakdown to{" "}
        <span className="text-(--foreground)">user</span>.
      </p>
    </div>
  );
}
