/*
 * Bematist dashboard perf harness.
 *
 * Run with:   k6 run tests/perf/dashboard.k6.js
 *             K6_GATE_M2=1 k6 run tests/perf/dashboard.k6.js   # strict
 *
 * Scope:      the dashboard summary page + its /api/dashboard/summary handler.
 *
 * Thresholds:
 *   - Today (M1):  p(95) < 3s warn-level — non-gating, measures the
 *                  fixture-backed dev server so we have a baseline ready.
 *   - M2 gate:     p(95) < 2s abortOnFail — merge-blocking per CLAUDE.md
 *                  §Testing Rules INT11 + contract 07 §Performance gates.
 *
 * The M2 gate flips on by setting K6_GATE_M2=1 in CI (see the `perf` job in
 * .github/workflows/perf.yml). The gate needs Jorge's 1M-event seed to be
 * meaningful — running it against fixtures gives the right *shape* of signal
 * but the absolute numbers don't count until the seed is real.
 *
 * Env:
 *   BASE_URL        default http://localhost:3000
 *   K6_GATE_M2      '1' to enable the strict 2s p95 abortOnFail threshold
 *   K6_VUS          virtual-user count (default 10)
 *   K6_DURATION     steady-state duration (default 1m)
 */

import { check, sleep } from "k6";
import http from "k6/http";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const VUS = Number(__ENV.K6_VUS || 10);
const DURATION = __ENV.K6_DURATION || "1m";
const GATE_M2 = __ENV.K6_GATE_M2 === "1";

export const options = {
  stages: [
    { duration: "30s", target: VUS },
    { duration: DURATION, target: VUS },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true }],
    http_req_duration: [
      // Warn-level baseline. Always on.
      "p(95)<3000",
      // M2 gate — flips on under K6_GATE_M2=1.
      {
        threshold: "p(95)<2000",
        abortOnFail: GATE_M2,
        delayAbortEval: "30s",
      },
    ],
    "http_req_duration{endpoint:summary}": ["p(95)<1500"],
    "http_req_duration{endpoint:home}": ["p(95)<2500"],
    checks: ["rate>0.99"],
  },
};

export function handleSummary(data) {
  return { "tests/perf/summary.json": JSON.stringify(data, null, 2) };
}

export default function () {
  const summary = http.get(`${BASE_URL}/api/dashboard/summary?window=7d`, {
    tags: { endpoint: "summary" },
  });
  check(summary, {
    "summary 200": (r) => r.status === 200,
    "summary has cost_series": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.cost_series);
      } catch {
        return false;
      }
    },
  });

  const home = http.get(`${BASE_URL}/`, { tags: { endpoint: "home" } });
  check(home, { "home 200": (r) => r.status === 200 });

  sleep(1);
}
