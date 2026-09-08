// F1.8 — ScatterChart: spend × throughput (or any X/Y) with sqrt-sized dots.
// Median dashed line. Outlier labels (|z|>1.5). Color-blind safe by source.
// Mobile floor 320px: gridlines + axis stay; outlier labels truncate.
// Pure SVG — no Visx scales here keeps the chunk tiny.

"use client";

import React, { useId, useMemo } from "react";
import type { SourceKind } from "@/components/data/source-chip";

export type ScatterPoint = {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Used for sqrt-sizing the dot. */
  sessions: number;
  source?: SourceKind;
};

export type ScatterChartProps = {
  points: ScatterPoint[];
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
  /** "x", "y" or "both". Median lines render in dashed --chart-axis. */
  median?: "x" | "y" | "both" | "none";
  onPointClick?: (id: string) => void;
};

const SOURCE_COLOR: Record<SourceKind, string> = {
  claude: "var(--source-claude)",
  codex: "var(--source-codex)",
  cursor: "var(--source-cursor)",
  human: "var(--source-human)",
  bot: "var(--muted-foreground)",
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function zScore(values: number[]): (v: number) => number {
  const mu = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
  const variance =
    values.reduce((s, v) => s + (v - mu) * (v - mu), 0) / Math.max(1, values.length);
  const sigma = Math.sqrt(variance) || 1;
  return v => (v - mu) / sigma;
}

const PADDING = { top: 10, right: 12, bottom: 32, left: 44 };

export function ScatterChart({
  points,
  width,
  height,
  xLabel,
  yLabel,
  median: medianMode = "both",
  onPointClick,
}: ScatterChartProps): React.ReactElement {
  const titleId = useId();

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const xMin = Math.min(0, ...xs);
    const xMax = Math.max(1, ...xs);
    const yMin = Math.min(0, ...ys);
    const yMax = Math.max(1, ...ys);
    return {
      xMin,
      xMax,
      yMin,
      yMax,
      xMed: median(xs),
      yMed: median(ys),
      zx: zScore(xs),
      zy: zScore(ys),
    };
  }, [points]);

  if (!stats || width <= 80 || height <= 80) {
    return (
      <div
        className="mk-table-cell text-(--muted-foreground) flex items-center justify-center"
        style={{ width, height: Math.max(48, height) }}
        role="img"
        aria-label="scatter: no data"
      >
        no scatter data
      </div>
    );
  }

  const innerW = Math.max(40, width - PADDING.left - PADDING.right);
  const innerH = Math.max(40, height - PADDING.top - PADDING.bottom);
  const xScale = (v: number) =>
    PADDING.left + ((v - stats.xMin) / (stats.xMax - stats.xMin || 1)) * innerW;
  const yScale = (v: number) =>
    PADDING.top + innerH - ((v - stats.yMin) / (stats.yMax - stats.yMin || 1)) * innerH;

  const xTicks = 4;
  const yTicks = 4;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-labelledby={titleId}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        {yLabel} vs {xLabel}: {points.length} points.
      </title>
      {/* gridlines */}
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const y = PADDING.top + (innerH * i) / yTicks;
        return (
          <line
            key={`gy-${i}`}
            x1={PADDING.left}
            x2={PADDING.left + innerW}
            y1={y}
            y2={y}
            stroke="var(--chart-grid)"
          />
        );
      })}
      {Array.from({ length: xTicks + 1 }).map((_, i) => {
        const x = PADDING.left + (innerW * i) / xTicks;
        return (
          <line
            key={`gx-${i}`}
            x1={x}
            x2={x}
            y1={PADDING.top}
            y2={PADDING.top + innerH}
            stroke="var(--chart-grid)"
          />
        );
      })}
      {/* median lines */}
      {(medianMode === "x" || medianMode === "both") && (
        <line
          x1={xScale(stats.xMed)}
          x2={xScale(stats.xMed)}
          y1={PADDING.top}
          y2={PADDING.top + innerH}
          stroke="var(--chart-axis)"
          strokeDasharray="3 4"
        />
      )}
      {(medianMode === "y" || medianMode === "both") && (
        <line
          x1={PADDING.left}
          x2={PADDING.left + innerW}
          y1={yScale(stats.yMed)}
          y2={yScale(stats.yMed)}
          stroke="var(--chart-axis)"
          strokeDasharray="3 4"
        />
      )}
      {/* axes */}
      <line
        x1={PADDING.left}
        x2={PADDING.left + innerW}
        y1={PADDING.top + innerH}
        y2={PADDING.top + innerH}
        stroke="var(--chart-axis)"
      />
      <line
        x1={PADDING.left}
        x2={PADDING.left}
        y1={PADDING.top}
        y2={PADDING.top + innerH}
        stroke="var(--chart-axis)"
      />
      {/* axis labels */}
      <text
        x={PADDING.left + innerW / 2}
        y={height - 8}
        textAnchor="middle"
        className="mk-table-cell"
        fill="var(--muted-foreground)"
      >
        {xLabel}
      </text>
      <text
        x={12}
        y={PADDING.top + innerH / 2}
        textAnchor="middle"
        className="mk-table-cell"
        fill="var(--muted-foreground)"
        transform={`rotate(-90 12 ${PADDING.top + innerH / 2})`}
      >
        {yLabel}
      </text>
      {/* points */}
      {points.map(p => {
        const r = Math.max(2.5, Math.sqrt(Math.max(0, p.sessions)) * 1.2);
        const cx = xScale(p.x);
        const cy = yScale(p.y);
        const color = p.source ? SOURCE_COLOR[p.source] : "var(--accent)";
        const z = Math.max(Math.abs(stats.zx(p.x)), Math.abs(stats.zy(p.y)));
        const isOutlier = z > 1.5;
        return (
          <g key={p.id}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={color}
              fillOpacity={0.5}
              stroke={color}
              strokeOpacity={0.85}
              strokeWidth={1}
              onClick={() => onPointClick?.(p.id)}
              style={{ cursor: onPointClick ? "pointer" : "default" }}
            >
              <title>
                {p.label} — {xLabel}: {p.x.toFixed(1)}, {yLabel}: {p.y.toFixed(1)}, sessions: {p.sessions}
              </title>
            </circle>
            {isOutlier && (
              <text
                x={cx + r + 4}
                y={cy + 3}
                fontSize={10}
                fill="var(--muted-foreground)"
                pointerEvents="none"
              >
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
