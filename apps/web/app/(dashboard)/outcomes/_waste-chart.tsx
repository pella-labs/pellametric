"use client";

import {
  Bar,
  CartesianGrid,
  Legend,
  BarChart as RechartsBarChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export interface WasteChartDatum {
  date: string;
  productive: number;
  retryWaste: number;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
}).format;
const PCT = (v: number) => `${(v * 100).toFixed(0)}%`;

// Absolute-$ bars: useful but the y-axis gets hijacked by one mega-day, so
// every other day becomes sub-pixel. The 100% stack below fills each bar to
// full height and shows waste RATIO per day — directly answers "how much
// was good vs bad today" without visual domination by outliers.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i] ?? 0;
}

export function WasteStackedBarChart({
  data,
  height = 260,
  mode = "abs",
}: {
  data: WasteChartDatum[];
  height?: number;
  mode?: "abs" | "percent";
}) {
  const shaped =
    mode === "percent"
      ? data.map((d) => {
          const total = d.productive + d.retryWaste;
          if (total <= 0) return { date: d.date, productive: 0, retryWaste: 0, _total: 0 };
          return {
            date: d.date,
            productive: d.productive / total,
            retryWaste: d.retryWaste / total,
            _total: total,
          };
        })
      : data.map((d) => ({ ...d, _total: d.productive + d.retryWaste }));

  // Absolute mode: clip the y-axis at the 95th-percentile total so one
  // mega-day doesn't flatten every other day into sub-pixel bars. Outlier
  // days still render but bars hit the axis ceiling; tooltip shows the true
  // value so nothing is hidden from the user.
  const absDomain: [number, number] | undefined = (() => {
    if (mode !== "abs") return undefined;
    const totals = shaped
      .map(
        (d) =>
          (d as { productive: number; retryWaste: number }).productive +
          (d as { retryWaste: number }).retryWaste,
      )
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    if (totals.length === 0) return undefined;
    const p95 = percentile(totals, 0.95);
    const p100 = totals[totals.length - 1] ?? 0;
    // If p95 >= p100 there's no outlier to clip — use full range.
    if (p95 >= p100 * 0.9) return undefined;
    return [0, Math.ceil(p95 * 1.15)];
  })();

  const yFmt = mode === "percent" ? PCT : USD;
  const tooltipFmt = (v: number, _name: unknown, entry: { payload?: { _total?: number } }) => {
    if (mode === "percent") {
      const totalDay = entry?.payload?._total ?? 0;
      return [`${PCT(v)} (${USD(v * totalDay)})`, undefined];
    }
    return [USD(v), undefined];
  };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <RechartsBarChart data={shaped} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickFormatter={yFmt}
            tickLine={false}
            axisLine={false}
            width={48}
            {...(mode === "percent"
              ? { domain: [0, 1] as [number, number] }
              : absDomain
                ? { domain: absDomain, allowDataOverflow: true }
                : {})}
          />
          <RechartsTooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            // biome-ignore lint/suspicious/noExplicitAny: recharts formatter typing is loose.
            formatter={tooltipFmt as any}
            labelStyle={{ color: "var(--muted-foreground)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} iconSize={10} />
          <Bar
            dataKey="productive"
            name="Productive (est.)"
            stackId="cost"
            fill="rgb(16 185 129 / 0.75)"
            stroke="rgb(16 185 129)"
            strokeWidth={0.5}
          />
          <Bar
            dataKey="retryWaste"
            name="Retry waste (est.)"
            stackId="cost"
            fill="rgb(239 68 68 / 0.8)"
            stroke="rgb(239 68 68)"
            strokeWidth={0.5}
          />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
