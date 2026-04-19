import type { Alert, AnomalyReason, AnomalySignal, CohortP95, DailyMetricRow } from "./types";

/** Minimum personal-history active days before we trust the personal baseline. */
const MIN_PERSONAL_DAYS = 14;
/** Minimum cohort size for k-anonymity — alerts below this are suppressed. */
export const K_ANONYMITY_FLOOR = 5;
/** Multiplier for cohort P95 fallback threshold. */
const COHORT_MULTIPLIER = 5;

const SIGMA_THRESHOLD = 3;

export const DEFAULT_COHORT: CohortP95 = {
  cost_usd: 10,
  input_tokens: 5000,
  tool_error_rate: 0.1,
  size: 0,
};

interface Stats {
  mean: number;
  stddev: number;
  count: number;
}

function stats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, stddev: 0, count: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return { mean, stddev: Math.sqrt(variance), count: values.length };
}

/**
 * Compute the anomaly decision for ONE signal on ONE engineer.
 * Returns an Alert when the spike breaches threshold; returns null otherwise.
 */
function checkSignal(
  signal: AnomalySignal,
  spikeValue: number,
  history: number[],
  cohortValue: number,
  cohortSize: number,
  opts: { engineer_id: string; org_id: string; hour_bucket: string },
): Alert | null {
  // k-anonymity: cohort too small → never emit for this engineer.
  // Bypassed when BEMATIST_SINGLE_TRUST_DOMAIN=1 (small-team / test instance).
  if (
    process.env.BEMATIST_SINGLE_TRUST_DOMAIN !== "1" &&
    cohortSize > 0 &&
    cohortSize < K_ANONYMITY_FLOOR
  ) {
    return null;
  }
  const s = stats(history);
  let reason: AnomalyReason;
  let threshold: number;
  let breach = false;

  if (s.count >= MIN_PERSONAL_DAYS && s.stddev > 0) {
    // Personal 3σ path
    threshold = s.mean + SIGMA_THRESHOLD * s.stddev;
    reason = "sigma3";
    breach = spikeValue > threshold;
  } else if (cohortSize >= K_ANONYMITY_FLOOR || process.env.BEMATIST_SINGLE_TRUST_DOMAIN === "1") {
    threshold = cohortValue * COHORT_MULTIPLIER;
    reason = "cohort_p95";
    breach = spikeValue > threshold;
  } else {
    return null; // zero history, cohort also unusable
  }
  if (!breach) return null;
  return {
    engineer_id: opts.engineer_id,
    org_id: opts.org_id,
    signal,
    hour_bucket: opts.hour_bucket,
    value: spikeValue,
    threshold,
    mean: s.mean,
    stddev: s.stddev,
    reason,
    cohort_k: s.count >= MIN_PERSONAL_DAYS ? 1 : cohortSize,
  };
}

export interface DetectAnomaliesInput {
  engineer_id: string;
  org_id: string;
  hour_bucket: string;
  /** Last ~30 days of personal daily aggregates. */
  history: DailyMetricRow[];
  /** Current-hour spike. */
  spike: Pick<DailyMetricRow, "cost_usd" | "input_tokens" | "tool_error_count" | "session_count">;
  cohort: CohortP95;
}

export function detectAnomaliesForSeries(input: DetectAnomaliesInput): Alert[] {
  const alerts: Alert[] = [];
  const mk = {
    engineer_id: input.engineer_id,
    org_id: input.org_id,
    hour_bucket: input.hour_bucket,
  };

  const cost = checkSignal(
    "cost_usd",
    input.spike.cost_usd,
    input.history.map((r) => r.cost_usd),
    input.cohort.cost_usd,
    input.cohort.size,
    mk,
  );
  if (cost) alerts.push(cost);

  const tok = checkSignal(
    "input_tokens",
    input.spike.input_tokens,
    input.history.map((r) => r.input_tokens),
    input.cohort.input_tokens,
    input.cohort.size,
    mk,
  );
  if (tok) alerts.push(tok);

  const errRate =
    input.spike.session_count > 0 ? input.spike.tool_error_count / input.spike.session_count : 0;
  const errHistory = input.history
    .filter((r) => r.session_count > 0)
    .map((r) => r.tool_error_count / r.session_count);
  const errAlert = checkSignal(
    "tool_error_rate",
    errRate,
    errHistory,
    input.cohort.tool_error_rate,
    input.cohort.size,
    mk,
  );
  if (errAlert) alerts.push(errAlert);

  return alerts;
}
