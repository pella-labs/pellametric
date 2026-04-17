import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";

/**
 * Badge rendered next to any cost number where `cost_estimated=true`.
 * Typical source: Cursor Auto-mode (CLAUDE.md Adapter Matrix). We never ship
 * a dollar number that pretends to be exact when the adapter told us it is not.
 */
export function CostEstimatedChip({ className }: { className?: string }) {
  return (
    <Tooltip content="Cost is an adapter-supplied estimate — the underlying tool did not report exact usage.">
      <span
        className={cn(
          "inline-flex items-center rounded-sm border border-warning/40 px-1 py-0 font-mono text-[0.6rem] uppercase tracking-wide text-warning",
          className,
        )}
        aria-label="Cost estimated"
      >
        est.
      </span>
    </Tooltip>
  );
}
