"use client";

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RechartsScatterChart,
  Tooltip as RechartsTooltip,
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

const DEFAULT_COLOR = "var(--color-accent)";

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
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
          />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            domain={[0, 100]}
            stroke="var(--color-foreground-muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -12,
              style: { fill: "var(--color-foreground-muted)", fontSize: 11 },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            domain={[0, 100]}
            stroke="var(--color-foreground-muted)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              style: { fill: "var(--color-foreground-muted)", fontSize: 11 },
            }}
          />
          <ZAxis type="number" dataKey="z" range={[40, 160]} />
          <ReferenceLine
            x={xThreshold}
            stroke="var(--color-border)"
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={yThreshold}
            stroke="var(--color-border)"
            strokeDasharray="4 4"
          />
          <RechartsTooltip
            cursor={{ strokeDasharray: "3 3", stroke: "var(--color-border)" }}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
            }}
            labelStyle={{ color: "var(--color-foreground-muted)" }}
            formatter={(value: number, name: string) => [value.toFixed(0), name]}
          />
          <Scatter
            data={data}
            fill={color}
            fillOpacity={0.75}
            stroke={color}
            strokeWidth={1}
          />
        </RechartsScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
