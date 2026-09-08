// F1.9 — ConfidencePipLarge: page-level affordance for PR detail (vs the inline
// pip used in tables). Renders the pip pattern at 4× scale plus a label,
// numeric score, and an optional one-line reason. Design council §6 calls
// this out for PR detail when overall confidence <70%.

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

const LABELS = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
} as const;

export type Confidence = "high" | "medium" | "low";

export function ConfidencePipLarge({
  confidence,
  scorePct,
  reason,
}: {
  confidence: Confidence;
  /** 0..100 rounded score. */
  scorePct?: number;
  /** Plain-English explainer. */
  reason?: string;
}): React.ReactElement {
  const pips = SHAPES[confidence];
  const color = COLORS[confidence];
  const label = LABELS[confidence];
  return (
    <div
      className="mk-panel flex items-center gap-4"
      role="status"
      aria-label={`${label}${scorePct !== undefined ? ` ${scorePct} percent` : ""}`}
    >
      <span
        className="text-3xl tracking-tight"
        style={{ color, fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)" }}
        aria-hidden="true"
      >
        {pips.join("")}
      </span>
      <div className="flex flex-col">
        <span className="mk-label">{label}</span>
        {scorePct !== undefined && (
          <span className="mk-stat-numeric text-(--foreground)" style={{ fontSize: 22 }}>
            {scorePct}%
          </span>
        )}
        {reason && (
          <span className="mk-table-cell text-(--muted-foreground) mt-1 max-w-md">{reason}</span>
        )}
      </div>
    </div>
  );
}
