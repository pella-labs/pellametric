"use client";

import {
  Area,
  CartesianGrid,
  AreaChart as RechartsAreaChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export interface AreaChartDatum {
  /** X-axis label (usually an ISO date or bucket id). */
  x: string;
  /** Primary series value. */
  y: number;
}

/**
 * Format presets for the Y-axis + tooltip. RSC callers can't pass a formatter
 * function across the server → client boundary, so we accept a named preset
 * and resolve the Intl formatter inside the client component.
 */
export type AreaChartFormat = "number" | "currency" | "tokens" | "percent";

export interface AreaChartProps {
  data: AreaChartDatum[];
  /** Value format preset. Default `number`. */
  format?: AreaChartFormat;
  /** Currency code when `format === "currency"`. Default USD. */
  currency?: string;
  color?: string;
  height?: number;
  ariaLabel: string;
}

const DEFAULT_COLOR = "var(--primary)";

function makeFormatter(format: AreaChartFormat, currency: string) {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format;
    case "tokens": {
      const f = new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      });
      return (n: number) => `${f.format(n)} tok`;
    }
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format;
    case "number":
    default:
      return new Intl.NumberFormat("en-US").format;
  }
}

export function AreaChart({
  data,
  format = "number",
  currency = "USD",
  color = DEFAULT_COLOR,
  height = 220,
  ariaLabel,
}: AreaChartProps) {
  const fmt = makeFormatter(format, currency);
  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="x"
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmt}
            width={60}
          />
          <RechartsTooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
            }}
            labelStyle={{ color: "var(--muted-foreground)" }}
            formatter={(v: number) => fmt(v)}
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2}
            fill="url(#area-gradient)"
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
