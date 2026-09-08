// T4.5 — SourceBar: stacked attribution bar. Plain SVG, 4-5 segments.
// Accessibility: width AND text label encode the data — never color alone.
import React from "react";

export type SourceBarProps = {
  pctClaude: number;
  pctCodex: number;
  pctCursor: number;
  pctHuman: number;
  pctBot?: number;
  height?: number;
  showLabel?: boolean;
};

export function SourceBar({
  pctClaude,
  pctCodex,
  pctCursor,
  pctHuman,
  pctBot = 0,
  height = 8,
  showLabel = true,
}: SourceBarProps): React.ReactElement {
  const segments: Array<{ key: string; pct: number; color: string; label: string }> = [
    { key: "claude", pct: pctClaude, color: "var(--source-claude)", label: "Claude" },
    { key: "codex", pct: pctCodex, color: "var(--source-codex)", label: "Codex" },
    { key: "cursor", pct: pctCursor, color: "var(--source-cursor)", label: "Cursor" },
    { key: "human", pct: pctHuman, color: "var(--source-human)", label: "Human" },
    { key: "bot", pct: pctBot, color: "var(--muted-foreground)", label: "Bot" },
  ].filter(s => s.pct > 0);

  const total = segments.reduce((s, x) => s + x.pct, 0);
  if (total <= 0) {
    return (
      <div className="text-xs text-(--muted-foreground)" role="img" aria-label="no source mix data">
        no data
      </div>
    );
  }

  let cursor = 0;
  const ariaLabel = segments.map(s => `${s.label} ${Math.round(s.pct)}%`).join(", ");
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        role="img"
        aria-label={`source mix: ${ariaLabel}`}
        style={{ display: "block" }}
      >
        {segments.map(s => {
          const width = (s.pct / total) * 100;
          const x = cursor;
          cursor += width;
          return <rect key={s.key} x={x} y={0} width={width} height={height} fill={s.color} />;
        })}
      </svg>
      {showLabel && (
        <div className="mk-table-cell mt-1 text-(--muted-foreground)">
          {segments.map(s => `${s.label} ${Math.round(s.pct)}%`).join(" · ")}
        </div>
      )}
    </div>
  );
}
