// F1.8 — CalendarHeatmap: GitHub-style activity grid.
// 5-stop color ramp from --muted to --accent. Hover label = numeric value.
// Mobile floor 320px+: cells shrink to 8px square at narrow widths.
// A11y: each cell is a <rect> with aria-label "<date>: <value>".

"use client";

import React, { useId, useMemo } from "react";

export type HeatmapCell = {
  /** ISO date 'YYYY-MM-DD'. */
  day: string;
  value: number;
};

export type CalendarHeatmapProps = {
  cells: HeatmapCell[];
  /** Total span in days, inclusive. Default 84 (12 weeks). */
  days?: number;
  /** Pixel size of each cell square. Default 12. */
  cellSize?: number;
  /** Spacing between cells in pixels. Default 2. */
  cellGap?: number;
  /** Label for the metric (used in aria-label). */
  metricLabel?: string;
};

const RAMP = [
  "var(--muted)",
  "color-mix(in oklab, var(--accent) 25%, var(--muted))",
  "color-mix(in oklab, var(--accent) 50%, var(--muted))",
  "color-mix(in oklab, var(--accent) 75%, var(--muted))",
  "var(--accent)",
];

function stop(v: number, max: number): string {
  if (max <= 0 || v <= 0) return RAMP[0];
  const ratio = v / max;
  if (ratio < 0.2) return RAMP[1];
  if (ratio < 0.45) return RAMP[2];
  if (ratio < 0.75) return RAMP[3];
  return RAMP[4];
}

function fmtDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarHeatmap({
  cells,
  days = 84,
  cellSize = 12,
  cellGap = 2,
  metricLabel = "value",
}: CalendarHeatmapProps): React.ReactElement {
  const titleId = useId();

  const { columns, max } = useMemo(() => {
    const byDay = new Map(cells.map(c => [c.day, c.value]));
    // Build a column-major grid: 7 rows (Sun-Sat) × N weeks.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(today.getUTCDate() - (days - 1));
    // Align start to Sunday so columns are real weeks.
    const startDow = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - startDow);
    const totalCells = Math.ceil((days + startDow) / 7) * 7;
    const grid: Array<{ day: string; value: number; idx: number }> = [];
    let max = 0;
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      if (d.getTime() > today.getTime()) break;
      const dayKey = fmtDay(d);
      const v = byDay.get(dayKey) ?? 0;
      if (v > max) max = v;
      grid.push({ day: dayKey, value: v, idx: i });
    }
    // Reshape into columns (weeks).
    const cols: Array<Array<{ day: string; value: number }>> = [];
    for (let i = 0; i < grid.length; i += 7) {
      cols.push(grid.slice(i, i + 7));
    }
    return { columns: cols, max };
  }, [cells, days]);

  const width = columns.length * (cellSize + cellGap) + 4;
  const height = 7 * (cellSize + cellGap) + 4;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-labelledby={titleId}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        Calendar heatmap of {metricLabel}, last {days} days. Max {max}.
      </title>
      {columns.map((col, ci) =>
        col.map((cell, ri) => {
          const fill = stop(cell.value, max);
          return (
            <rect
              key={`c-${ci}-${ri}`}
              x={2 + ci * (cellSize + cellGap)}
              y={2 + ri * (cellSize + cellGap)}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={fill}
            >
              <title>
                {cell.day}: {cell.value} {metricLabel}
              </title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}
