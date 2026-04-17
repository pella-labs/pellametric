import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";

/**
 * Insight-Engine confidence (CLAUDE.md AI Rules):
 *   high    — shown verbatim.
 *   medium  — labeled "investigate"; user should verify.
 *   low     — server never ships these; this label exists for completeness.
 */
export type Confidence = "high" | "medium" | "low";

const LABELS: Record<Confidence, string> = {
  high: "High",
  medium: "Investigate",
  low: "Low",
};

const TONES: Record<Confidence, string> = {
  high: "bg-[var(--color-positive)]/15 text-[var(--color-positive)]",
  medium: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  low: "bg-[var(--color-negative)]/15 text-[var(--color-negative)]",
};

const EXPLAIN: Record<Confidence, string> = {
  high: "Signals cleared the server-side confidence gate. Numbers referenced in the insight are grounded.",
  medium:
    "Signals were suggestive but not decisive. Labeled 'investigate' so managers do not act on a thin reading.",
  low: "Server suppressed this tier — you should not see this in production.",
};

export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: Confidence;
  className?: string;
}) {
  return (
    <Tooltip content={EXPLAIN[confidence]}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
          TONES[confidence],
          className,
        )}
        aria-label={`Confidence: ${LABELS[confidence]}`}
      >
        {LABELS[confidence]}
      </span>
    </Tooltip>
  );
}
