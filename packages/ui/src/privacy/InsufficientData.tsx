import type { ReactNode } from "react";
import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";

/**
 * Rendered in place of a number when the server-side display gate
 * (04-scoring-io.md §Display gates) said the tile should not show one.
 *
 * `failedGate` is the specific gate that tripped (sessions / active_days /
 * outcome_events / cohort / k_anonymity). We name it in the tooltip so users
 * know what would change the outcome.
 */
export type GateReason =
  | "insufficient_sessions"
  | "insufficient_active_days"
  | "insufficient_outcome_events"
  | "insufficient_cohort"
  | "k_anonymity_floor"
  | "consent_required";

const EXPLAIN: Record<GateReason, string> = {
  insufficient_sessions: "Fewer than 10 sessions in window. Wait for more usage before comparing.",
  insufficient_active_days: "Fewer than 5 active days in window. The signal is not yet stable.",
  insufficient_outcome_events:
    "Fewer than 3 outcome events (merged PRs, green tests). Score confidence is too low to ship.",
  insufficient_cohort:
    "Fewer than 8 peers in the comparison cohort. Percentile normalization would be noisy.",
  k_anonymity_floor:
    "Team has fewer than 5 contributors with signal. We suppress the number to protect individuals.",
  consent_required:
    "Prompt text requires an explicit reveal gesture. Click Reveal on the session detail to request.",
};

const LABEL: Record<GateReason, string> = {
  insufficient_sessions: "Insufficient data — sessions",
  insufficient_active_days: "Insufficient data — active days",
  insufficient_outcome_events: "Insufficient data — outcomes",
  insufficient_cohort: "Insufficient data — cohort",
  k_anonymity_floor: "Insufficient cohort",
  consent_required: "Consent required",
};

export function InsufficientData({
  reason,
  children,
  className,
}: {
  reason: GateReason;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip content={EXPLAIN[reason]}>
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground",
          className,
        )}
        role="status"
        aria-label={LABEL[reason]}
      >
        {children ?? <span>{LABEL[reason]}</span>}
      </div>
    </Tooltip>
  );
}
