import { expect, test } from "bun:test";
import { DEFAULT_COHORT, detectAnomaliesForSeries } from "./detector";
import type { DailyMetricRow } from "./types";

function makeHistory(days: number, cost: number): DailyMetricRow[] {
  return Array.from({ length: days }, (_, i) => ({
    engineer_id: "eng_1",
    org_id: "org_1",
    source: "claude-code",
    day: `2026-03-${String(20 + i).padStart(2, "0")}`,
    cost_usd: cost,
    input_tokens: 1000,
    tool_error_count: 0,
    session_count: 10,
  }));
}

test("3σ personal path fires on cost spike", () => {
  const history = makeHistory(30, 10);
  // Inject slight variance so stddev > 0 and sigma3 path is reachable.
  for (let i = 0; i < history.length; i++) {
    const r = history[i];
    if (r) r.cost_usd = 10 + (i % 3);
  }
  const alerts = detectAnomaliesForSeries({
    engineer_id: "eng_1",
    org_id: "org_1",
    hour_bucket: "2026-04-17T14:00:00.000Z",
    history,
    spike: { cost_usd: 500, input_tokens: 1000, tool_error_count: 0, session_count: 10 },
    cohort: { ...DEFAULT_COHORT, size: 20 },
  });
  const costAlert = alerts.find((a) => a.signal === "cost_usd");
  expect(costAlert).toBeDefined();
  expect(costAlert?.reason).toBe("sigma3");
  expect(costAlert?.value).toBe(500);
  expect(costAlert?.org_id).toBe("org_1");
  expect(costAlert?.engineer_id).toBe("eng_1");
});

test("cohort fallback fires when personal history is short", () => {
  const history = makeHistory(5, 10); // < MIN_PERSONAL_DAYS
  const alerts = detectAnomaliesForSeries({
    engineer_id: "new_dev",
    org_id: "org_1",
    hour_bucket: "2026-04-17T14:00:00.000Z",
    history,
    spike: { cost_usd: 500, input_tokens: 1000, tool_error_count: 0, session_count: 10 },
    cohort: { cost_usd: 10, input_tokens: 5000, tool_error_rate: 0.1, size: 20 },
  });
  const costAlert = alerts.find((a) => a.signal === "cost_usd");
  expect(costAlert).toBeDefined();
  expect(costAlert?.reason).toBe("cohort_p95");
  expect(costAlert?.threshold).toBe(DEFAULT_COHORT.cost_usd * 5);
});

test("zero-stddev personal history falls back to cohort", () => {
  // 30 days all identical cost — stddev = 0, so sigma3 path skips and
  // we fall into cohort fallback.
  const history = makeHistory(30, 10);
  const alerts = detectAnomaliesForSeries({
    engineer_id: "steady_dev",
    org_id: "org_1",
    hour_bucket: "2026-04-17T14:00:00.000Z",
    history,
    spike: { cost_usd: 500, input_tokens: 1000, tool_error_count: 0, session_count: 10 },
    cohort: { cost_usd: 10, input_tokens: 5000, tool_error_rate: 0.1, size: 20 },
  });
  const costAlert = alerts.find((a) => a.signal === "cost_usd");
  expect(costAlert).toBeDefined();
  expect(costAlert?.reason).toBe("cohort_p95");
  expect(costAlert?.stddev).toBe(0);
});

test("k-anonymity floor: cohort < 5 → no alert emitted", () => {
  const history = makeHistory(3, 10); // too short for sigma3
  const alerts = detectAnomaliesForSeries({
    engineer_id: "tiny_team_dev",
    org_id: "org_1",
    hour_bucket: "2026-04-17T14:00:00.000Z",
    history,
    spike: { cost_usd: 5000, input_tokens: 100000, tool_error_count: 0, session_count: 10 },
    cohort: { cost_usd: 10, input_tokens: 5000, tool_error_rate: 0.1, size: 4 }, // < 5
  });
  expect(alerts).toHaveLength(0);
});

test("zero history + zero cohort → no alert (zero_history_suppressed)", () => {
  const alerts = detectAnomaliesForSeries({
    engineer_id: "ghost_dev",
    org_id: "org_1",
    hour_bucket: "2026-04-17T14:00:00.000Z",
    history: [],
    spike: { cost_usd: 5000, input_tokens: 100000, tool_error_count: 0, session_count: 10 },
    cohort: { cost_usd: 10, input_tokens: 5000, tool_error_rate: 0.1, size: 0 },
  });
  expect(alerts).toHaveLength(0);
});

test("no spike below threshold → no alert", () => {
  const history = makeHistory(30, 10);
  for (let i = 0; i < history.length; i++) {
    const r = history[i];
    if (r) r.cost_usd = 10 + (i % 3);
  }
  const alerts = detectAnomaliesForSeries({
    engineer_id: "eng_1",
    org_id: "org_1",
    hour_bucket: "2026-04-17T14:00:00.000Z",
    history,
    spike: { cost_usd: 12, input_tokens: 1000, tool_error_count: 0, session_count: 10 },
    cohort: { ...DEFAULT_COHORT, size: 20 },
  });
  expect(alerts.find((a) => a.signal === "cost_usd")).toBeUndefined();
});

test("tool_error_rate alert fires on error spike", () => {
  const history: DailyMetricRow[] = Array.from({ length: 30 }, (_, i) => ({
    engineer_id: "eng_1",
    org_id: "org_1",
    source: "claude-code",
    day: `2026-03-${String(1 + i).padStart(2, "0")}`,
    cost_usd: 10,
    input_tokens: 1000,
    tool_error_count: i % 3, // small noise, avg ~1/10 = 10%
    session_count: 10,
  }));
  const alerts = detectAnomaliesForSeries({
    engineer_id: "eng_1",
    org_id: "org_1",
    hour_bucket: "2026-04-17T14:00:00.000Z",
    history,
    spike: { cost_usd: 10, input_tokens: 1000, tool_error_count: 9, session_count: 10 }, // 90% error rate
    cohort: { ...DEFAULT_COHORT, size: 20 },
  });
  const errAlert = alerts.find((a) => a.signal === "tool_error_rate");
  expect(errAlert).toBeDefined();
  expect(errAlert?.value).toBeCloseTo(0.9, 2);
});
