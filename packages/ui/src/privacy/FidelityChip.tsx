import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";

/**
 * Adapter fidelity levels — see CLAUDE.md Adapter Matrix.
 *
 * - `full`: token counts, prompts/tool calls, outcome events — every adapter
 *   field populated.
 * - `estimated`: some fields interpolated (e.g. Cursor Auto-mode cost).
 * - `aggregate-only`: per-session data not available, only rollups.
 * - `post-migration`: adapter requires a specific app version; pre-migration
 *   data is skipped.
 */
export type Fidelity = "full" | "estimated" | "aggregate-only" | "post-migration";

const LABELS: Record<Fidelity, string> = {
  full: "Full fidelity",
  estimated: "Estimated",
  "aggregate-only": "Aggregate only",
  "post-migration": "Post-migration",
};

const COMPACT_LABELS: Record<Fidelity, string> = {
  full: "Full",
  estimated: "Est.",
  "aggregate-only": "Agg.",
  "post-migration": "Post",
};

const DESCRIPTIONS: Record<Fidelity, string> = {
  full: "Every field populated by the adapter.",
  estimated: "Some values interpolated — treat totals as approximate.",
  "aggregate-only": "Per-session data unavailable. Only rollups shown.",
  "post-migration":
    "Adapter requires a newer version of the source tool; earlier sessions are excluded.",
};

const TONE_CLASSES: Record<Fidelity, string> = {
  full: "border-positive/40 text-positive",
  estimated: "border-warning/40 text-warning",
  "aggregate-only": "border-muted-foreground/30 text-muted-foreground",
  "post-migration": "border-primary/40 text-primary",
};

export interface FidelityChipProps {
  fidelity: Fidelity;
  className?: string;
  /** Short label (4 chars max) for dense surfaces like table cells. */
  compact?: boolean;
}

export function FidelityChip({ fidelity, className, compact = false }: FidelityChipProps) {
  const visible = compact ? COMPACT_LABELS[fidelity] : LABELS[fidelity];
  return (
    <Tooltip content={DESCRIPTIONS[fidelity]}>
      <span
        className={cn(
          "inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border px-1.5 py-0 font-mono text-[0.65rem] uppercase tracking-wide",
          TONE_CLASSES[fidelity],
          className,
        )}
        aria-label={LABELS[fidelity]}
      >
        {visible}
      </span>
    </Tooltip>
  );
}
