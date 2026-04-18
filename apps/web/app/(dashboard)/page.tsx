import { getSummary } from "@bematist/api";
import {
  AreaChart,
  Card,
  CardHeader,
  CardTitle,
  CardValue,
  ChartTableToggle,
  CostEstimatedChip,
  InsufficientData,
} from "@bematist/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCtx } from "@/lib/session";

export const metadata: Metadata = {
  title: "Summary",
};

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function DashboardHome() {
  const ctx = await getSessionCtx();
  // Engineers/ICs don't get the team-level summary — redirect them to their
  // own digest page. Admins/managers/viewers continue to the team view below.
  if (ctx.role === "engineer") {
    redirect("/me/digest");
  }
  const summary = await getSummary(ctx, { window: "7d" });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Summary</h1>
        <p className="text-sm text-muted-foreground">
          Last 7 days · fixture-backed until Sprint 1 MVs land.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Total cost</CardTitle>
          </CardHeader>
          <CardValue className="flex items-baseline gap-2">
            {USD.format(summary.total_cost_usd)}
            {summary.any_cost_estimated ? <CostEstimatedChip /> : null}
          </CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accepted edits</CardTitle>
          </CardHeader>
          <CardValue>{summary.accepted_edits.toLocaleString()}</CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>AI Leverage Score</CardTitle>
          </CardHeader>
          <CardValue>
            {summary.ai_leverage_score.show ? (
              summary.ai_leverage_score.value.toFixed(0)
            ) : (
              <InsufficientData
                reason={
                  summary.ai_leverage_score.suppression_reason as
                    | "insufficient_sessions"
                    | "insufficient_active_days"
                    | "insufficient_outcome_events"
                    | "insufficient_cohort"
                    | "k_anonymity_floor"
                }
              />
            )}
          </CardValue>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cost per day</CardTitle>
        </CardHeader>
        <ChartTableToggle
          chart={
            <AreaChart
              data={summary.cost_series}
              format="currency"
              currency="USD"
              ariaLabel="Daily cost over the last 7 days"
            />
          }
          table={<CostSeriesTable series={summary.cost_series} />}
        />
      </Card>
    </div>
  );
}

function CostSeriesTable({ series }: { series: { x: string; y: number }[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr className="border-b border-border">
          <th className="py-2 font-medium">Date</th>
          <th className="py-2 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {series.map((p) => (
          <tr key={p.x} className="border-b border-border/50">
            <td className="py-2 font-mono text-xs">{p.x}</td>
            <td className="py-2 text-right">{USD.format(p.y)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
