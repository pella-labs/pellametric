/*
 * Bematist ingest perf harness.
 *
 * Run with:   k6 run tests/perf/ingest.k6.js
 *             K6_GATE_M2=1 k6 run tests/perf/ingest.k6.js   # strict (default in CI)
 *
 * Scope:      `apps/ingest` Bun server, hot path:
 *               POST /v1/events  (custom JSON, batch-of-10)
 *
 *             Each VU posts a 10-event batch every iteration. Target rate is
 *             1000 events/s sustained for 2 min — 100 VUs × 10 ev / iter,
 *             pacing tuned by `--rps` and per-iter `sleep`.
 *
 * Threshold (CLAUDE.md §Key Constraints): p99 ingest < 100 ms — MERGE BLOCKER.
 *
 * The ingest endpoint enforces auth: `Authorization: Bearer bm_<orgId>_<keyId>_<secret>`
 * (3-segment per contracts/02). The seed script (`bun run seed:perf`) mints
 * a deterministic-secret key and writes the bearer to
 * `tests/perf/.ingest-bearer`; tests/perf/run.sh auto-loads it. To run
 * standalone, pass the bearer via INGEST_BEARER.
 *
 * Env:
 *   INGEST_URL       default http://localhost:8000
 *   INGEST_BEARER    Bearer token from seed output / loaded by run.sh
 *   K6_GATE_M2       '1' (default) → strict abortOnFail; '0' = warn-only
 *   K6_VUS           default 100  (so 1k ev/s with 10 ev/batch and ~1s pacing)
 *   K6_DURATION      default 2m
 *   K6_BATCH_SIZE    default 10 events per request
 */

import { check } from "k6";
import http from "k6/http";
import { Counter } from "k6/metrics";

const INGEST_URL = __ENV.INGEST_URL || "http://localhost:8000";
const BEARER = __ENV.INGEST_BEARER || "";
const VUS = Number(__ENV.K6_VUS || 100);
const DURATION = __ENV.K6_DURATION || "2m";
const BATCH_SIZE = Number(__ENV.K6_BATCH_SIZE || 10);
const GATE_M2 = __ENV.K6_GATE_M2 !== "0";

const eventsAccepted = new Counter("events_accepted");
const eventsDeduped = new Counter("events_deduped");

export const options = {
  scenarios: {
    ingest: {
      executor: "constant-arrival-rate",
      // 100 ev/s × VU × BATCH_SIZE → 1000 ev/s with defaults.
      // We pace 1 iter/VU/sec, each iter sends BATCH_SIZE events.
      rate: VUS,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: VUS,
      maxVUs: VUS * 2,
    },
  },
  thresholds: {
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: GATE_M2 }],
    // Headline gate — CLAUDE.md §Key Constraints "p99 ingest <100ms".
    http_req_duration: [
      {
        threshold: "p(99)<100",
        abortOnFail: GATE_M2,
        delayAbortEval: "30s",
      },
      "p(95)<60",
    ],
    "http_req_duration{endpoint:events}": ["p(99)<100", "p(95)<60"],
    checks: ["rate>0.98"],
  },
};

export function handleSummary(data) {
  return { "tests/perf/ingest-summary.json": JSON.stringify(data, null, 2) };
}

// k6 doesn't ship a UUID generator. Tiny v4-shape RNG — only needs to be
// unique enough to dodge the Redis SETNX dedup gate within one run.
function uuidv4() {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += "-";
    } else if (i === 14) {
      s += "4";
    } else if (i === 19) {
      s += hex[(Math.random() * 4) | (0 + 8)];
    } else {
      s += hex[Math.floor(Math.random() * 16)];
    }
  }
  return s;
}

function makeEvent(seq) {
  const now = new Date().toISOString();
  return {
    client_event_id: uuidv4(),
    schema_version: 1,
    ts: now,
    tenant_id: "perf-tenant",
    engineer_id: "eng_perf_0",
    device_id: "dev-perf",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier: "B",
    session_id: `sess_perf_${__VU}_${__ITER}`,
    event_seq: seq,
    gen_ai: {
      system: "anthropic",
      request: { model: "claude-opus-4-7" },
      response: { model: "claude-opus-4-7" },
      usage: {
        input_tokens: 1000 + Math.floor(Math.random() * 500),
        output_tokens: 200 + Math.floor(Math.random() * 100),
      },
    },
    dev_metrics: {
      event_kind: "llm_request",
      cost_usd: Number((Math.random() * 0.5).toFixed(6)),
      pricing_version: "litellm-2026-04-01",
      duration_ms: 100 + Math.floor(Math.random() * 1000),
    },
  };
}

export default function () {
  const events = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    events.push(makeEvent(i));
  }

  const headers = { "content-type": "application/json" };
  if (BEARER) headers.authorization = `Bearer ${BEARER}`;

  const res = http.post(`${INGEST_URL}/v1/events`, JSON.stringify({ events }), {
    headers,
    tags: { endpoint: "events" },
    timeout: "5s",
  });

  const ok = check(res, {
    "ingest 2xx": (r) => r.status >= 200 && r.status < 300,
  });

  if (ok) {
    try {
      const body = JSON.parse(res.body);
      if (typeof body.accepted === "number") eventsAccepted.add(body.accepted);
      if (typeof body.deduped === "number") eventsDeduped.add(body.deduped);
    } catch {
      // body parse failure surfaces via the duration / failure thresholds.
    }
  }
}
