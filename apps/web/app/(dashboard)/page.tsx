import { AreaChart, Card, CardHeader, CardTitle, CardValue } from "@bematist/ui";
import type { Metadata } from "next";
import { SourceBadge } from "@/components/SourceBadge";
import { type FilterKey, SourceFilterBar } from "@/components/SourceFilterBar";
import { getLocalDataFor } from "@/lib/local-sources";

export const metadata: Metadata = {
  title: "Summary",
};

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// ISO-week key (YYYY-Www) for bucketing daily rows into weekly rollups.
// Week starts Monday per ISO-8601 — matches ccusage default.
function isoWeekKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7; // Sun=0 → 7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const VALID_FILTERS: readonly FilterKey[] = ["claude-code", "codex", "cursor"] as const;

function parseFilter(v: string | undefined): FilterKey | null {
  return v && (VALID_FILTERS as readonly string[]).includes(v) ? (v as FilterKey) : null;
}

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp.source);
  const data = await getLocalDataFor(filter);
  const { sources, analytics } = data;
  const isCursorFiltered = filter === "cursor" && data.cursor;
  const daily = analytics.dailyCosts.map((d) => ({ x: d.date, y: d.cost }));
  const weekly = new Map<string, { cost: number; tokens: number; sessions: number }>();
  for (const d of analytics.dailyCosts) {
    const k = isoWeekKey(d.date);
    const cur = weekly.get(k) ?? { cost: 0, tokens: 0, sessions: 0 };
    cur.cost += d.cost;
    cur.tokens += d.tokens;
    cur.sessions += d.sessions;
    weekly.set(k, cur);
  }
  const weeklyRows = [...weekly.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12)
    .map(([week, v]) => ({ week, ...v }));
  const topModels = [...analytics.modelBreakdowns].sort((a, b) => b.cost - a.cost).slice(0, 10);
  const topProjects = [...analytics.projectBreakdowns].sort((a, b) => b.cost - a.cost).slice(0, 8);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Summary</h1>
        <p className="text-sm text-muted-foreground">
          Read directly from this machine&apos;s coding-agent session files. Live numbers — no
          backend writes.
        </p>
        <SourceFilterBar basePath="/" current={filter} />
      </header>

      {isCursorFiltered && data.cursor ? (
        <>
          <Card className="border-amber-500/30 bg-amber-500/5">
            <p className="text-xs text-amber-400/90 leading-relaxed">
              <strong>Why no cost or tokens here?</strong> Cursor is a subscription product —
              per-request cost isn&apos;t billed. Token counts do exist in Cursor&apos;s SQLite
              schema (<code className="font-mono">tokenCount.inputTokens</code> on each bubble) but
              your DB stores zeros for every row, so we can&apos;t recover them. Same story for
              every third-party Cursor tracker. Instead, this view surfaces the signals Cursor{" "}
              <em>does</em> expose — messages, lines changed, tab/composer accept rates, files
              created, thinking time.
            </p>
          </Card>

          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Sessions</CardTitle>
              </CardHeader>
              <CardValue>{INT.format(data.cursor.sessions.length)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                {INT.format(data.cursor.totalMessages)} messages
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Lines changed</CardTitle>
              </CardHeader>
              <CardValue className="text-emerald-400">
                +{INT.format(data.cursor.totalLinesAdded)}
              </CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="text-red-400/80">
                  −{INT.format(data.cursor.totalLinesRemoved)}
                </span>{" "}
                removed · {INT.format(data.cursor.totalFilesCreated)} files created
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Tab accept rate</CardTitle>
              </CardHeader>
              <CardValue>
                {data.cursor.totalTabSuggestedLines > 0
                  ? `${((data.cursor.totalTabAcceptedLines / data.cursor.totalTabSuggestedLines) * 100).toFixed(1)}%`
                  : "—"}
              </CardValue>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {INT.format(data.cursor.totalTabAcceptedLines)} /{" "}
                {INT.format(data.cursor.totalTabSuggestedLines)} lines
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Composer accept rate</CardTitle>
              </CardHeader>
              <CardValue>
                {data.cursor.totalComposerSuggestedLines > 0
                  ? `${((data.cursor.totalComposerAcceptedLines / data.cursor.totalComposerSuggestedLines) * 100).toFixed(1)}%`
                  : "—"}
              </CardValue>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {INT.format(data.cursor.totalComposerAcceptedLines)} /{" "}
                {INT.format(data.cursor.totalComposerSuggestedLines)} lines
              </p>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Messages per day</CardTitle>
            </CardHeader>
            <AreaChart
              data={data.cursor.dailyActivity.map((d) => ({
                x: d.date,
                y: d.messages,
              }))}
              format="number"
              ariaLabel="Messages per day"
              height={220}
            />
          </Card>
        </>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Total cost</CardTitle>
              </CardHeader>
              <CardValue>{USD.format(analytics.totalCost)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                {analytics.costTrend.changePercent >= 0 ? "+" : ""}
                {analytics.costTrend.changePercent.toFixed(1)}% vs previous week
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sessions</CardTitle>
              </CardHeader>
              <CardValue>{INT.format(analytics.totalSessions)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                avg {USD.format(analytics.totalCost / Math.max(1, analytics.totalSessions))} /
                session
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Input tokens</CardTitle>
              </CardHeader>
              <CardValue>{TOK.format(analytics.totalInputTokens)}</CardValue>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Output tokens</CardTitle>
              </CardHeader>
              <CardValue>{TOK.format(analytics.totalOutputTokens)}</CardValue>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Cost by day</CardTitle>
            </CardHeader>
            <AreaChart data={daily} format="currency" ariaLabel="Cost per day" height={220} />
          </Card>
        </>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By source</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">Source</th>
                <th className="pb-2 text-right">Sessions</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) =>
                s.sessions === 0 ? null : (
                  <tr key={s.key} className="border-t border-border/40">
                    <td className="py-2">
                      <SourceBadge source={s.key} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{INT.format(s.sessions)}</td>
                    <td className="py-2 text-right tabular-nums">{TOK.format(s.tokens)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {s.costLabel ?? USD.format(s.cost)}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top models by cost</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">Model</th>
                <th className="pb-2 text-right">Sessions</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {topModels.map((m) => (
                <tr key={`${m.provider}:${m.model}`} className="border-t border-border/40">
                  <td className="py-2">
                    <div>{m.model}</div>
                    <div className="text-xs text-muted-foreground">{m.provider}</div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{INT.format(m.sessionCount)}</td>
                  <td className="py-2 text-right tabular-nums">{USD.format(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Weekly rollup</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Week (ISO)</th>
              <th className="pb-2 text-right">Sessions</th>
              <th className="pb-2 text-right">Tokens</th>
              <th className="pb-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {weeklyRows.map((w) => (
              <tr key={w.week} className="border-t border-border/40">
                <td className="py-2 font-mono text-xs">{w.week}</td>
                <td className="py-2 text-right tabular-nums">{INT.format(w.sessions)}</td>
                <td className="py-2 text-right tabular-nums">{TOK.format(w.tokens)}</td>
                <td className="py-2 text-right tabular-nums">{USD.format(w.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top projects by cost</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Project</th>
              <th className="pb-2">Sources</th>
              <th className="pb-2 text-right">Sessions</th>
              <th className="pb-2 text-right">Tokens</th>
              <th className="pb-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {topProjects.map((p) => (
              <tr key={p.project} className="border-t border-border/40">
                <td className="py-2">{p.displayName}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {p.sources.map((src) => (
                      <SourceBadge key={src} source={src} size="xs" />
                    ))}
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">{INT.format(p.sessions)}</td>
                <td className="py-2 text-right tabular-nums">{TOK.format(p.tokens)}</td>
                <td className="py-2 text-right tabular-nums">{USD.format(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
