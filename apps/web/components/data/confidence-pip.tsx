// T4.7 — ConfidencePip: 3-pip indicator (a11y carrier = pip count).
import React from "react";

const SHAPES = {
  high: ["█", "█", "█"],
  medium: ["█", "█", "▒"],
  low: ["█", "▒", "░"],
} as const;

const COLORS = {
  high: "var(--conf-high)",
  medium: "var(--conf-med)",
  low: "var(--conf-low)",
} as const;

export function ConfidencePip({
  confidence,
  reason,
}: {
  confidence: "high" | "medium" | "low";
  reason?: string;
}): React.ReactElement {
  const pips = SHAPES[confidence];
  const color = COLORS[confidence];
  return (
    <span
      className="inline-flex items-center gap-0.5 mk-table-cell"
      style={{ color }}
      role="img"
      aria-label={`confidence: ${confidence}`}
      title={reason ?? `confidence: ${confidence}`}
    >
      <span aria-hidden="true">{pips.join("")}</span>
    </span>
  );
}
