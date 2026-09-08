// F3.20 — Manager overview per design council §2.1.
// KPI hero (4 tiles) + scatter Spend × Throughput + attribution mix +
// recent activity tables. Server component; receives pre-aggregated data.

import React from "react";
import Link from "next/link";
import { KpiTile } from "@/components/data/kpi-tile";
import { SourceBar } from "@/components/data/source-bar";
import { ScatterChart, type ScatterPoint } from "@/components/charts/scatter-chart";
import { ConfidencePip } from "@/components/data/confidence-pip";

export type ManagerOverviewProps = {
  base: string;
  windowLabel: string;
  kpi: {
    costPerPrUsd: number;
    teamSpendUsd: number;
    prsMerged: number;
    wastePct: number;
    costPerPrSparkline?: number[];
    teamSpendSparkline?: number[];
    prsMergedSparkline?: number[];
    wasteSparkline?: number[];
    deltas?: {
      costPerPr?: number;
      teamSpend?: number;
      prsMerged?: number;
      waste?: number;
    };
  };
  scatter: ScatterPoint[];
  attribution: {
    pctClaude: number;
    pctCodex: number;
    pctCursor: number;
    pctHuman: number;
  };
  topPrs: Array<{
    prId: string;
    repo: string;
    number: number;
    title: string | null;
    author: string | null;
    costUsd: number | null;
    confidence: "high" | "medium" | "low" | null;
    mergedAt: Date | null;
  }>;
  topDevs: Array<{
    login: string;
    sessions: number;
    prsMerged: number;
    spendUsd: number;
  }>;
  backfill?: {
    status: "pending" | "running" | "done" | "error" | null;
    lastDay: string | null;
  };
};

function money(x: number): string {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}

export function ManagerOverview({
  base,
  windowLabel,
  kpi,
  scatter,
  attribution,
  topPrs,
  topDevs,
  backfill,
}: ManagerOverviewProps): React.ReactElement {
  return (
    <div className="p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="mk-eyebrow">Overview · {windowLabel}</p>
          <h1 className="mk-heading text-2xl">How is the team using AI assistance?</h1>
        </div>
        <Link
          href={`${base}/insights`}
          className="mk-table-cell border border-(--border) hover:border-(--border-hover) rounded-[var(--radius)] px-3 py-1.5"
        >
          Open insight builder →
        </Link>
      </header>

      {/* F4.31 — backfill progress banner */}
      {backfill && (backfill.status === "pending" || backfill.status === "running") && (
        <div className="mk-panel border-(--warning)">
          <p className="mk-label">Backfilling historical PRs</p>
          <p className="mk-table-cell text-(--muted-foreground) mt-1">
            We're pulling recent merged PRs from your GitHub App installation so cost-per-PR and
            attribution backfill. Status: {backfill.status}
            {backfill.lastDay ? ` · last day fetched: ${backfill.lastDay}` : ""}. Refresh this page
            in a few minutes for updated data.
          </p>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          label="Cost / merged PR"
          value={money(kpi.costPerPrUsd)}
          caption={windowLabel}
          delta={kpi.deltas?.costPerPr !== undefined ? { pct: kpi.deltas.costPerPr } : undefined}
          goodDirection="down"
          sparkline={kpi.costPerPrSparkline}
          sparklineTone="positive"
        />
        <KpiTile
          label="Team spend"
          value={money(kpi.teamSpendUsd)}
          caption={windowLabel}
          delta={kpi.deltas?.teamSpend !== undefined ? { pct: kpi.deltas.teamSpend } : undefined}
          goodDirection="down"
          sparkline={kpi.teamSpendSparkline}
          sparklineTone="warning"
        />
        <KpiTile
          label="PRs merged"
          value={String(kpi.prsMerged)}
          caption={windowLabel}
          delta={kpi.deltas?.prsMerged !== undefined ? { pct: kpi.deltas.prsMerged } : undefined}
          goodDirection="up"
          sparkline={kpi.prsMergedSparkline}
          sparklineTone="positive"
        />
        <KpiTile
          label="Waste %"
          value={`${kpi.wastePct.toFixed(1)}%`}
          caption={windowLabel}
          delta={kpi.deltas?.waste !== undefined ? { pct: kpi.deltas.waste } : undefined}
          goodDirection="down"
          sparkline={kpi.wasteSparkline}
          sparklineTone="positive"
        />
      </div>

      {/* Hero row: scatter + attribution */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-3">
        <div className="mk-panel">
          <div className="flex items-baseline justify-between mb-3">
            <p className="mk-label">Spend × Throughput per dev</p>
            <p className="mk-table-cell text-(--muted-foreground)">
              dot size = sessions
            </p>
          </div>
          {scatter.length > 0 ? (
            <ScatterChart
              points={scatter}
              width={840}
              height={320}
              xLabel="$ spent"
              yLabel="Merged PRs"
            />
          ) : (
            <p className="mk-table-cell text-(--muted-foreground)">
              no per-dev data yet — install GitHub App + run lineage for attribution
            </p>
          )}
        </div>
        <div className="mk-panel space-y-3">
          <p className="mk-label">Attribution mix · {windowLabel}</p>
          <SourceBar
            pctClaude={attribution.pctClaude}
            pctCodex={attribution.pctCodex}
            pctCursor={attribution.pctCursor}
            pctHuman={attribution.pctHuman}
            height={16}
          />
        </div>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="mk-panel">
          <div className="flex items-baseline justify-between mb-3">
            <p className="mk-label">Top PRs by cost · {windowLabel}</p>
            <Link href={`${base}/prs`} className="mk-table-cell text-(--accent) hover:underline">
              All PRs →
            </Link>
          </div>
          {topPrs.length === 0 ? (
            <p className="mk-table-cell text-(--muted-foreground)">no PRs in window</p>
          ) : (
            <table className="w-full mk-table-cell">
              <thead className="text-left border-b border-(--border) text-(--muted-foreground)">
                <tr>
                  <th className="py-2 pr-2">PR</th>
                  <th className="py-2 px-2">Author</th>
                  <th className="py-2 px-2 text-right">Cost</th>
                  <th className="py-2 pl-2 text-right">Conf</th>
                </tr>
              </thead>
              <tbody>
                {topPrs.slice(0, 8).map(p => (
                  <tr key={p.prId} className="border-b border-(--border)">
                    <td className="py-2 pr-2 text-(--foreground)">
                      <Link
                        href={`${base}/prs/${p.number}`}
                        className="hover:underline"
                      >
                        #{p.number} {p.title?.slice(0, 50) ?? "(untitled)"}
                      </Link>
                    </td>
                    <td className="py-2 px-2 text-(--muted-foreground)">{p.author ?? "—"}</td>
                    <td className="py-2 px-2 text-right text-(--foreground)">
                      {p.costUsd !== null ? money(p.costUsd) : "—"}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {p.confidence ? <ConfidencePip confidence={p.confidence} /> : <span className="text-(--ink-faint)">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mk-panel">
          <div className="flex items-baseline justify-between mb-3">
            <p className="mk-label">Devs · top by activity</p>
            <Link href={`${base}/devs`} className="mk-table-cell text-(--accent) hover:underline">
              All devs →
            </Link>
          </div>
          {topDevs.length === 0 ? (
            <p className="mk-table-cell text-(--muted-foreground)">no devs with sessions yet</p>
          ) : (
            <table className="w-full mk-table-cell">
              <thead className="text-left border-b border-(--border) text-(--muted-foreground)">
                <tr>
                  <th className="py-2 pr-2">Dev</th>
                  <th className="py-2 px-2 text-right">Sessions</th>
                  <th className="py-2 px-2 text-right">PRs merged</th>
                  <th className="py-2 pl-2 text-right">Spend</th>
                </tr>
              </thead>
              <tbody>
                {topDevs.slice(0, 8).map(d => (
                  <tr key={d.login} className="border-b border-(--border)">
                    <td className="py-2 pr-2 text-(--foreground)">
                      <Link
                        href={`${base}/devs/${d.login}`}
                        className="hover:underline"
                      >
                        {d.login}
                      </Link>
                    </td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{d.sessions}</td>
                    <td className="py-2 px-2 text-right text-(--foreground)">{d.prsMerged}</td>
                    <td className="py-2 pl-2 text-right text-(--foreground)">{money(d.spendUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
