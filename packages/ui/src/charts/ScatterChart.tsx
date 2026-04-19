"use client";

import {
  CartesianGrid,
  ScatterChart as RechartsScatterChart,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

export interface ScatterDatum {
  /** Stable dot key; never an engineer name. */
  id: string;
  x: number;
  y: number;
  /** Optional bubble size driver. */
  z?: number;
}

export interface ScatterChartProps {
  data: ScatterDatum[];
  xLabel: string;
  yLabel: string;
  /** Draw the cross-hair at these values (default 50 / 50 for percentile rank). */
  threshold?: { x?: number; y?: number };
  color?: string;
  height?: number;
  ariaLabel: string;
}

const DEFAULT_COLOR = "var(--primary)";

export function ScatterChart({
  data,
  xLabel,
  yLabel,
  threshold,
  color = DEFAULT_COLOR,
  height = 320,
  ariaLabel,
}: ScatterChartProps) {
  const xThreshold = threshold?.x ?? 50;
  const yThreshold = threshold?.y ?? 50;

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsScatterChart margin={{ top: 8, right: 12, bottom: 24, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            domain={[0, 100]}
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -12,
              style: { fill: "var(--muted-foreground)", fontSize: 11 },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            domain={[0, 100]}
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              style: { fill: "var(--muted-foreground)", fontSize: 11 },
            }}
          />
          <ZAxis type="number" dataKey="z" range={[40, 160]} />
          <ReferenceLine x={xThreshold} stroke="var(--border)" strokeDasharray="4 4" />
          <ReferenceLine y={yThreshold} stroke="var(--border)" strokeDasharray="4 4" />
          <RechartsTooltip
            cursor={{ strokeDasharray: "3 3", stroke: "var(--border)" }}
            wrapperStyle={{ outline: "none" }}
            contentStyle={{
              background: "rgba(5, 5, 6, 0.95)",
              border: "1px solid rgba(237, 232, 222, 0.2)",
              borderRadius: "6px",
              fontSize: "12px",
              color: "var(--foreground)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
            }}
            labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
            itemStyle={{ color: "var(--foreground)" }}
            formatter={(value: number, name: string) => [value.toFixed(0), name]}
          />
          <Scatter data={data} fill={color} fillOpacity={0.75} stroke={color} strokeWidth={1} />
        </RechartsScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
