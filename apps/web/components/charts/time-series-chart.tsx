// F2 — Stacked-bar/time-series chart for the insight builder.
// Pure SVG (no Visx) — keeps the per-route bundle slim.
// Supports stacked-bar (default), line (when breakdown='none'), and table-only
// (caller picks variant). Mobile floor 320px+.

"use client";

import React, { useId, useMemo } from "react";

export type Series = { t: string; series: Record<string, number> };

export type TimeSeriesChartProps = {
  data: Series[];
  /** Stable color per key (e.g. source). Falls back to deterministic hash. */
  colorFor?: (key: string) => string;
  width: number;
  height: number;
  /** "stacked" | "grouped" | "line". */
  variant?: "stacked" | "line";
  yLabel?: string;
  /** Sort keys for stable stack order. */
  keyOrder?: string[];
};

const PALETTE = [
  "var(--source-claude)",
  "var(--source-codex)",
  "var(--source-cursor)",
  "var(--source-human)",
  "var(--accent)",
  "var(--warning)",
  "var(--destructive)",
  "var(--muted-foreground)",
];

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const NAMED: Record<string, string> = {
  claude: "var(--source-claude)",
  codex: "var(--source-codex)",
  cursor: "var(--source-cursor)",
  human: "var(--source-human)",
  bot: "var(--muted-foreground)",
};

const PADDING = { top: 12, right: 12, bottom: 36, left: 56 };

export function TimeSeriesChart({
  data,
  colorFor,
  width,
  height,
  variant = "stacked",
  yLabel,
  keyOrder,
}: TimeSeriesChartProps): React.ReactElement {
  const titleId = useId();

  const { keys, columns, max, color } = useMemo(() => {
    const keyMax = new Map<string, number>();
    const allKeys = new Set<string>();
    for (const row of data) {
      for (const [k, v] of Object.entries(row.series)) {
        allKeys.add(k);
        keyMax.set(k, (keyMax.get(k) ?? 0) + v); // for stable ordering by total
      }
    }
    let keys = Array.from(allKeys);
    if (keyOrder && keyOrder.length > 0) {
      const ord = new Map(keyOrder.map((k, i) => [k, i]));
      keys.sort((a, b) => (ord.get(a) ?? 999) - (ord.get(b) ?? 999));
    } else {
      keys.sort((a, b) => (keyMax.get(b) ?? 0) - (keyMax.get(a) ?? 0));
    }
    const color = (k: string) => colorFor?.(k) ?? NAMED[k] ?? hashColor(k);

    let max = 0;
    const columns = data.map(row => {
      const ordered = keys.map(k => ({ key: k, value: row.series[k] ?? 0 }));
      const total = ordered.reduce((s, x) => s + x.value, 0);
      if (variant === "line") {
        for (const x of ordered) max = Math.max(max, x.value);
      } else {
        max = Math.max(max, total);
      }
      return { t: row.t, total, ordered };
    });
    return { keys, columns, max: max || 1, color };
  }, [data, colorFor, keyOrder, variant]);

  if (columns.length === 0 || width < 100 || height < 80) {
    return (
      <div
        className="mk-table-cell text-(--muted-foreground) flex items-center justify-center"
        style={{ width, height: Math.max(48, height) }}
        role="img"
        aria-label="no time-series data"
      >
        no data in window
      </div>
    );
  }

  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;
  const colW = innerW / columns.length;
  const barW = Math.max(2, colW * 0.62);
  const xCenter = (i: number) => PADDING.left + i * colW + colW / 2;
  const yScale = (v: number) => PADDING.top + innerH - (v / max) * innerH;

  // Y ticks at 0, 25, 50, 75, 100%
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(p => p * max);

  function formatTick(v: number): string {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(v < 1 && v > 0 ? 2 : 0);
  }

  // X labels: every nth tick depending on column count.
  const stride = Math.max(1, Math.floor(columns.length / 8));

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-labelledby={titleId}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        {variant === "line" ? "Line chart" : "Stacked bar chart"} —{" "}
        {columns.length} points across {keys.length} series.
      </title>
      {/* gridlines */}
      {yTicks.map((v, i) => (
        <g key={`g-${i}`}>
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={yScale(v)}
            y2={yScale(v)}
            stroke="var(--chart-grid)"
          />
          <text
            x={PADDING.left - 6}
            y={yScale(v) + 3}
            textAnchor="end"
            fontSize={10}
            fill="var(--muted-foreground)"
          >
            {formatTick(v)}
          </text>
        </g>
      ))}
      {/* y label */}
      {yLabel && (
        <text
          x={16}
          y={PADDING.top + innerH / 2}
          textAnchor="middle"
          className="mk-table-cell"
          fill="var(--muted-foreground)"
          transform={`rotate(-90 16 ${PADDING.top + innerH / 2})`}
        >
          {yLabel}
        </text>
      )}
      {/* bars / lines */}
      {variant === "stacked"
        ? columns.map((col, i) => {
            let acc = 0;
            return (
              <g key={col.t}>
                {col.ordered.map(({ key, value }) => {
                  if (value <= 0) return null;
                  const y = yScale(acc + value);
                  const h = yScale(acc) - y;
                  acc += value;
                  return (
                    <rect
                      key={`${col.t}-${key}`}
                      x={xCenter(i) - barW / 2}
                      y={y}
                      width={barW}
                      height={Math.max(1, h)}
                      fill={color(key)}
                      opacity={0.86}
                    >
                      <title>
                        {col.t} · {key}: {formatTick(value)}
                      </title>
                    </rect>
                  );
                })}
              </g>
            );
          })
        : // line variant: 1 path per key
          keys.map(k => {
            const pts = columns.map((c, i) => {
              const v = c.ordered.find(o => o.key === k)?.value ?? 0;
              return `${i === 0 ? "M" : "L"}${xCenter(i)},${yScale(v)}`;
            });
            return (
              <path
                key={k}
                d={pts.join(" ")}
                fill="none"
                stroke={color(k)}
                strokeWidth={1.5}
              />
            );
          })}
      {/* x labels */}
      {columns.map((c, i) => {
        if (i % stride !== 0 && i !== columns.length - 1) return null;
        return (
          <text
            key={`x-${c.t}`}
            x={xCenter(i)}
            y={height - 10}
            textAnchor="middle"
            fontSize={10}
            fill="var(--muted-foreground)"
          >
            {c.t.slice(5)}
          </text>
        );
      })}
      {/* baseline */}
      <line
        x1={PADDING.left}
        x2={width - PADDING.right}
        y1={PADDING.top + innerH}
        y2={PADDING.top + innerH}
        stroke="var(--chart-axis)"
      />
    </svg>
  );
}
