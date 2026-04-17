import { z } from "zod";
import { Window } from "./common";

/**
 * Anomaly alerts — hourly cadence, not weekly (per CLAUDE.md §AI Rules). The
 * per-dev rolling baseline + 3σ detector + cohort fallback for new devs runs
 * in Workstream H; this schema is the read-side shape the dashboard + CLI
 * consume.
 */
export const AlertKind = z.enum([
  /** Rolling cost baseline exceeded 3σ in the current bucket. */
  "cost_spike",
  /** Session tool-call loop detected (same tool, >N calls, rising cost). */
  "infinite_loop",
  /** Collector device went silent; fidelity downgrade alert. */
  "collector_offline",
  /** Sustained revert ratio above baseline for a single IC or cluster. */
  "repeated_reverts",
  /** Model swap / pricing shift that materially changed unit cost. */
  "model_anomaly",
]);
export type AlertKind = z.infer<typeof AlertKind>;

export const AlertSeverity = z.enum(["info", "warn", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const Alert = z.object({
  id: z.string(),
  kind: AlertKind,
  severity: AlertSeverity,
  /**
   * Stable 8-char hash of the engineer identity this alert is scoped to, or
   * `null` for team/org-level alerts (collector_offline at org scope, etc.).
   * Real engineer IDs are never rendered — IC opt-in unlocks a name only in
   * `/me` + reveal flows.
   */
  engineer_id_hash: z.string().length(8).nullable(),
  team_id: z.string().nullable(),
  triggered_at: z.string().datetime(),
  /** Observed value that triggered the alert. */
  value: z.number(),
  /** Threshold the detector compared against. */
  threshold: z.number(),
  /** Baseline the threshold was derived from (rolling mean, cohort median, etc.). */
  baseline: z.number(),
  /** One-line human-readable summary. Generated upstream; never free-form user input. */
  description: z.string(),
  /** Link target for a dashboard drill-in; deliberately opaque (not a URL). */
  scope_ref: z.string().nullable(),
});
export type Alert = z.infer<typeof Alert>;

export const ListAlertsInput = z.object({
  window: Window.default("7d"),
  team_id: z.string().optional(),
  kind: AlertKind.optional(),
  min_severity: AlertSeverity.default("info"),
  limit: z.number().int().positive().max(500).default(100),
});
export type ListAlertsInput = z.infer<typeof ListAlertsInput>;

export const ListAlertsOutput = z.object({
  window: Window,
  team_id: z.string().nullable(),
  alerts: z.array(Alert),
  counts_by_severity: z.object({
    info: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }),
});
export type ListAlertsOutput = z.infer<typeof ListAlertsOutput>;
