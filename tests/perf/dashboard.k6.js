/*
 * Bematist dashboard perf harness.
 *
 * Run with:   k6 run tests/perf/dashboard.k6.js
 *
 * Scope:      the dashboard summary page + its /api/dashboard/summary handler.
 * Non-gating until M2, at which point p95 < 2s becomes merge-blocking per
 * CLAUDE.md Testing Rules (INT11) and contract 07 §Performance gates.
 *
 * The seeded-data target (1M events) comes from Jorge's `db:seed` script once
 * the rollups are live; for now this file exercises the stubbed fixture
 * backend so we have the harness ready when the real data arrives.
 */

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 10 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    // M2 gate target — tighten to 2000 once MVs are in and seeded data is real.
    http_req_duration: ["p(95)<3000"],
  },
};

export default function () {
  const summary = http.get(`${BASE_URL}/api/dashboard/summary?window=7d`);
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

  const home = http.get(`${BASE_URL}/`);
  check(home, { "home 200": (r) => r.status === 200 });

  sleep(1);
}
