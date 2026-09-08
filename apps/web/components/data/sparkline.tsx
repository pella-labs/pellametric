// T4.8 — Sparkline: inline SVG path, no axes, no labels (glyph not chart).
import React from "react";

type Tone = "positive" | "warning" | "neutral";
const COLOR: Record<Tone, string> = {
  positive: "var(--positive)",
  warning: "var(--warning)",
  neutral: "var(--muted-foreground)",
};

export function Sparkline({
  values,
  tone = "neutral",
  width = 80,
  height = 16,
}: {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
}): React.ReactElement | null {
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const dx = width / Math.max(1, values.length - 1);
  const path = values
    .map((v, i) => {
      const x = i * dx;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: "inline-block" }}
    >
      <path d={path} fill="none" stroke={COLOR[tone]} strokeWidth={1.25} />
    </svg>
  );
}
