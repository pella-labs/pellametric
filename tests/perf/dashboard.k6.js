/*
 * Bematist dashboard perf harness.
 *
 * Run with:   k6 run tests/perf/dashboard.k6.js
 *             K6_GATE_M2=0 k6 run tests/perf/dashboard.k6.js   # warn-only
 *
 * Scope:      manager-facing dashboard surface — RSC pages + Route Handlers
 *             that share the same query path through `packages/api`.
 *               GET  /                         (home)
 *               GET  /api/dashboard/summary    (Route Handler)
 *               GET  /teams                    (RSC, manager 2×2)
 *               GET  /sessions                 (RSC, virtualized table)
 *
 * Thresholds (CLAUDE.md §Key Constraints + INT11):
 *   - p(95) < 2000ms across all endpoints — MERGE BLOCKER at M2 (gate flag).
 *   - per-endpoint sub-thresholds let regressions surface against one page
 *     without tripping the global gate first.
 *
 * The M2 gate is the active default in CI (perf.yml sets K6_GATE_M2=1). Set
 * K6_GATE_M2=0 locally to run warn-only. The 1M-event seed lives in
 * `packages/fixtures/seed/`; CI runs `bun run seed:perf` before this script,
 * local dev can run it once.
 *
 * Env:
 *   BASE_URL        default http://localhost:3000
 *   K6_GATE_M2      '1' (default in workflow) → strict abortOnFail; '0' = warn
 *   K6_VUS          default 50 (M2 brief)
 *   K6_DURATION     default 2m  (M2 brief)
 */

import { check, sleep } from "k6";
import http from "k6/http";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const VUS = Number(__ENV.K6_VUS || 50);
const DURATION = __ENV.K6_DURATION || "2m";
const GATE_M2 = __ENV.K6_GATE_M2 !== "0";

export const options = {
  scenarios: {
    dashboard: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: VUS },
        { duration: DURATION, target: VUS },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: GATE_M2 }],
    // Headline gate — CLAUDE.md §Key Constraints "p95 dashboard <2s".
    http_req_duration: [
      {
        threshold: "p(95)<2000",
        abortOnFail: GATE_M2,
        delayAbortEval: "30s",
      },
    ],
    // Per-endpoint envelopes. Numbers chosen so any one page burning >2s
    // surfaces here before the global gate trips.
    "http_req_duration{endpoint:summary}": ["p(95)<1500"],
    "http_req_duration{endpoint:teams}": ["p(95)<2000"],
    "http_req_duration{endpoint:sessions}": ["p(95)<2000"],
    "http_req_duration{endpoint:home}": ["p(95)<1500"],
    checks: ["rate>0.98"],
  },
};

export function handleSummary(data) {
  return { "tests/perf/summary.json": JSON.stringify(data, null, 2) };
}

const WINDOWS = ["7d", "14d", "30d"];

export default function () {
  const window = WINDOWS[Math.floor(Math.random() * WINDOWS.length)];

  const summary = http.get(`${BASE_URL}/api/dashboard/summary?window=${window}`, {
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

  const teams = http.get(`${BASE_URL}/teams?window=${window}`, {
    tags: { endpoint: "teams" },
  });
  check(teams, { "teams 200": (r) => r.status === 200 });

  const sessions = http.get(`${BASE_URL}/sessions?window=${window}`, {
    tags: { endpoint: "sessions" },
  });
  check(sessions, { "sessions 200": (r) => r.status === 200 });

  const home = http.get(`${BASE_URL}/`, { tags: { endpoint: "home" } });
  check(home, { "home 200/3xx": (r) => r.status >= 200 && r.status < 400 });

  sleep(1);
}
