import { detectAnomaliesForSeries } from "./anomaly/detector";
import { LoggingAnomalyNotifier } from "./anomaly/notifier";
import type { AnomalyNotifier, CohortP95, DailyMetricRow } from "./anomaly/types";

/**
 * Hourly anomaly-detection job. Wrapper that accepts pre-loaded inputs
 * (from ClickHouse) and fans out to `detectAnomaliesForSeries` per engineer.
 *
 * The caller — `apps/worker/src/jobs/cron.ts` (future) — supplies the
 * data-loader. That separation lets tests exercise the algorithm without
 * a live CH connection.
 */
export interface DetectAllInput {
  hour_bucket: string;
  perEngineer: Array<{
    engineer_id: string;
    org_id: string;
    history: DailyMetricRow[];
    spike: Pick<DailyMetricRow, "cost_usd" | "input_tokens" | "tool_error_count" | "session_count">;
    cohort: CohortP95;
  }>;
  notifier?: AnomalyNotifier;
}

export async function runAnomalyDetection(input: DetectAllInput): Promise<number> {
  const notifier = input.notifier ?? new LoggingAnomalyNotifier();
  let emitted = 0;
  for (const row of input.perEngineer) {
    const alerts = detectAnomaliesForSeries({
      engineer_id: row.engineer_id,
      org_id: row.org_id,
      hour_bucket: input.hour_bucket,
      history: row.history,
      spike: row.spike,
      cohort: row.cohort,
    });
    for (const a of alerts) {
      await notifier.publish(a);
      emitted++;
    }
  }
  return emitted;
}
