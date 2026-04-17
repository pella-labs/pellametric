/**
 * Types for the hourly anomaly detector.
 *
 * PRD §8.4: hourly, NOT weekly. Per-dev rolling 30-day baseline + 3σ;
 * cohort P95×5 fallback for engineers with < 14 active days.
 */

export interface DailyMetricRow {
  engineer_id: string;
  org_id: string;
  source: string; // e.g. "claude-code"
  day: string; // ISO date
  cost_usd: number;
  input_tokens: number;
  tool_error_count: number;
  session_count: number;
}

export type AnomalyReason =
  | "sigma3"
  | "cohort_p95"
  | "zero_history_suppressed"
  | "k_floor_suppressed";

export type AnomalySignal = "cost_usd" | "input_tokens" | "tool_error_rate";

export interface Alert {
  engineer_id: string;
  org_id: string;
  signal: AnomalySignal;
  hour_bucket: string; // ISO hour string, e.g. "2026-04-17T14:00:00.000Z"
  value: number;
  threshold: number;
  mean: number;
  stddev: number;
  reason: AnomalyReason;
  /** Size of the cohort used for the detection (1 for personal history). */
  cohort_k: number;
}

/**
 * Cohort P95 lookup table — org × source → P95 value per signal.
 * Used for cold-start engineers. Pre-computed nightly by a separate job;
 * this module accepts it as input for testability.
 */
export interface CohortP95 {
  cost_usd: number;
  input_tokens: number;
  tool_error_rate: number;
  /** Cohort size — used for k-anonymity gate (alerts suppressed if < 5). */
  size: number;
}

export interface AnomalyNotifier {
  publish(alert: Alert): Promise<void>;
}
