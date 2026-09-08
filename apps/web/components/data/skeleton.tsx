// F1.9 — Skeleton primitives. Geometry-matched: the skeleton MUST reserve the
// same pixel box as the loaded content to avoid layout shift. No fade
// transition — the design council §6.4 explicitly rules that out.
//
// Composition: <SkeletonBox/> for arbitrary boxes, <SkeletonText/> for one or
// more lines (with width variance to look natural), <SkeletonTable/> for
// row-grid placeholders matching .mk-table-cell row geometry (h-9 / 36px).

import React from "react";

function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function SkeletonBox({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      className={clsx(
        "bg-(--muted) animate-pulse rounded-[var(--radius)]",
        className,
      )}
      style={style}
      aria-hidden="true"
    />
  );
}

/**
 * Variable-width text lines. The first N-1 lines render full width; the last
 * is 70% so it reads as "in-progress prose" rather than a perfect block.
 */
export function SkeletonText({
  lines = 1,
  width = "100%",
}: {
  lines?: number;
  width?: string;
}): React.ReactElement {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 bg-(--muted) animate-pulse rounded-[var(--radius)]"
          style={{
            width: i === lines - 1 && lines > 1 ? "70%" : width,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Row-grid placeholder. Rows render at h-9 (36px) to match .mk-table-cell row
 * geometry exactly. Column widths come from caller so the skeleton lines up
 * perfectly with the post-load table grid.
 */
export function SkeletonTable({
  rows = 6,
  columns,
}: {
  rows?: number;
  /** CSS grid-template-columns string, e.g. "auto 1fr 96px". */
  columns: string;
}): React.ReactElement {
  return (
    <div aria-hidden="true" className="divide-y divide-(--border)">
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid items-center h-9 px-3 gap-3"
          style={{ gridTemplateColumns: columns }}
        >
          {columns
            .split(/\s+/)
            .filter(Boolean)
            .map((_, c) => (
              <div
                key={c}
                className="h-3 bg-(--muted) animate-pulse rounded-[var(--radius)]"
              />
            ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Sized to match a KpiTile post-load: 1 small eyebrow + 1 big numeric +
 * a sparkline strip. Same pixel envelope as the real tile.
 */
export function SkeletonKpiTile(): React.ReactElement {
  return (
    <div className="mk-panel space-y-3" aria-hidden="true">
      <div className="h-3 w-20 bg-(--muted) animate-pulse rounded-[var(--radius)]" />
      <div className="h-10 w-32 bg-(--muted) animate-pulse rounded-[var(--radius)]" />
      <div className="h-4 w-24 bg-(--muted) animate-pulse rounded-[var(--radius)]" />
    </div>
  );
}

/**
 * Reserves the same canvas box used by chart primitives.
 */
export function SkeletonChart({
  width,
  height,
}: {
  width: number | string;
  height: number;
}): React.ReactElement {
  return (
    <div
      className="bg-(--muted) animate-pulse rounded-[var(--radius)]"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
