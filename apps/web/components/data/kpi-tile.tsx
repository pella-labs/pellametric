// F1.9 — KpiTile: eyebrow + hero numeric + delta + optional sparkline.
// Used in the design-council §2.1 KPI strip on every overview surface.
// Tabular-nums via .mk-stat-numeric. Delta carries direction + sign.

import React from "react";
import { Sparkline } from "@/components/data/sparkline";

export type KpiTrend = "up" | "down" | "flat";

export type KpiTileProps = {
  label: string;
  /** Big numeric, pre-formatted. e.g. "$2,431", "184", "63%" */
  value: string;
  /** Small line under the value (e.g. "last 30 days"). */
  caption?: string;
  /**
   * Signed delta vs previous window. Positive renders as "+", "down" renders
   * with the "warning" tone when higher-is-worse (cost) — pass `goodDirection`
   * explicitly.
   */
  delta?: { pct: number };
  /** Which delta direction is good. Default "up" (more PRs / sessions). */
  goodDirection?: "up" | "down";
  sparkline?: number[];
  /** Tone for the sparkline, defaults to "neutral". */
  sparklineTone?: "positive" | "warning" | "neutral";
};

function deltaTone(pct: number, goodDirection: "up" | "down"): KpiTrend {
  if (Math.abs(pct) < 0.5) return "flat";
  const isUp = pct > 0;
  if (goodDirection === "up") return isUp ? "up" : "down";
  return isUp ? "down" : "up";
}

const TREND_COLOR: Record<KpiTrend, string> = {
  up: "var(--positive)",
  down: "var(--destructive)",
  flat: "var(--muted-foreground)",
};

const TREND_GLYPH: Record<KpiTrend, string> = {
  up: "▲",
  down: "▼",
  flat: "—",
};

export function KpiTile({
  label,
  value,
  caption,
  delta,
  goodDirection = "up",
  sparkline,
  sparklineTone = "neutral",
}: KpiTileProps): React.ReactElement {
  const tone = delta ? deltaTone(delta.pct, goodDirection) : null;
  return (
    <div className="mk-panel">
      <div className="mk-label">{label}</div>
      <div className="mk-stat-numeric mt-1 text-(--foreground)">{value}</div>
      <div className="flex items-center gap-3 mt-2 mk-table-cell">
        {tone && delta && (
          <span
            style={{ color: TREND_COLOR[tone] }}
            aria-label={`changed by ${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(1)} percent (${tone === "up" ? "better" : tone === "down" ? "worse" : "flat"})`}
          >
            <span aria-hidden="true">{TREND_GLYPH[tone]}</span>{" "}
            {tone === "flat" ? "0.0%" : `${delta.pct > 0 ? "+" : ""}${delta.pct.toFixed(1)}%`}
          </span>
        )}
        {caption && <span className="text-(--muted-foreground)">{caption}</span>}
        {sparkline && sparkline.length > 1 && (
          <span className="ml-auto">
            <Sparkline values={sparkline} tone={sparklineTone} width={80} height={16} />
          </span>
        )}
      </div>
    </div>
  );
}
