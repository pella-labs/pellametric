import { AreaChart, Card, CardHeader, CardTitle, CardValue } from "@bematist/ui";
import type { Metadata } from "next";
import { getLocalData } from "@/lib/local-sources";

export const metadata: Metadata = {
  title: "Insights",
};

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const PCT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export default async function InsightsPage() {
  const { analytics } = await getLocalData();
  const velocity = analytics.costVelocity.map((p) => ({ x: p.date, y: p.costPerHour }));
  const retry = analytics.retryStats;
  const cache = analytics.cacheStats;
  const trend = analytics.costTrend;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Derived metrics over the same local session data — cost trend, retry patterns, cache
          efficiency. Aggregated on read; no Insight-Engine LLM calls in this view.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Weekly cost</CardTitle>
          </CardHeader>
          <CardValue>{USD.format(trend.currentWeekCost)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {trend.changePercent >= 0 ? "+" : ""}
            {trend.changePercent.toFixed(1)}% vs prior week · last week{" "}
            {USD.format(trend.previousWeekCost)}
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First-try rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(retry.firstTryRate)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {INT.format(retry.retriedTurns)} retried turns · {USD.format(retry.retryCostUsd)} spent
            on retries
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cache hit rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(cache.hitRate)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            saved {USD.format(cache.savingsUsd)} · {TOK.format(cache.totalCacheRead)} cache reads
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Peak hour</CardTitle>
          </CardHeader>
          <CardValue>{analytics.peakHour}:00</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            favorite model: {analytics.favoriteModel || "—"}
          </p>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Cost velocity ($/hour of active session)</CardTitle>
        </CardHeader>
        <AreaChart
          data={velocity}
          format="currency"
          ariaLabel="Cost per active hour"
          height={220}
        />
      </Card>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Retry patterns by tool</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">Tool</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2 text-right">First-try</th>
                <th className="pb-2 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {[...retry.perTool]
                .sort((a, b) => b.total - a.total)
                .slice(0, 10)
                .map((t) => (
                  <tr key={t.tool} className="border-t border-border/40">
                    <td className="py-2">{t.tool}</td>
                    <td className="py-2 text-right tabular-nums">{INT.format(t.total)}</td>
                    <td className="py-2 text-right tabular-nums">{INT.format(t.firstTry)}</td>
                    <td className="py-2 text-right tabular-nums">{PCT.format(t.rate)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {retry.mostRetriedTool ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Most retried tool: <span className="font-mono">{retry.mostRetriedTool}</span>
              {retry.mostRetriedFile ? (
                <>
                  {" · "}most retried file:{" "}
                  <span className="font-mono">{retry.mostRetriedFile}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Highest-cost sessions</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">When</th>
                <th className="pb-2">Project</th>
                <th className="pb-2">Model</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {[...analytics.sessionRows]
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 10)
                .map((s) => (
                  <tr key={`${s.source}:${s.id}`} className="border-t border-border/40">
                    <td className="py-2 text-xs">{s.date || "—"}</td>
                    <td className="py-2 text-xs">{s.project || "—"}</td>
                    <td className="py-2 text-xs font-mono">{s.model || "—"}</td>
                    <td className="py-2 text-right tabular-nums">{USD.format(s.cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {retry.worstSession ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Worst-retries session: <span className="font-mono">{retry.worstSession.name}</span> on{" "}
              {retry.worstSession.date} · burned {USD.format(retry.worstSession.retryCostUsd)} on
              retries
            </p>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
