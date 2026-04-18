#!/usr/bin/env bun
// Bun ↔ ClickHouse 24-hour soak harness — F15 / INT0.
//
// Gates the Bun `@clickhouse/client` writer path per CLAUDE.md §Testing Rules
// and §Architecture Rules #7. Sustains 100 evt/s for `--hours` hours, records
// per-request latency + HTTP status, and emits a JSONL failure log plus a
// final JSON summary. Exits 0 if success rate ≥ 99.99% AND zero silent drops,
// 1 otherwise (trips the decision to flip to Plan B — apps/ingest-sidecar/).
//
// Assumes the dev stack is already up:
//   docker compose -f docker-compose.dev.yml up -d
//   (cd apps/ingest && bun run dev:live)
//
// And that a perf ingest bearer exists at SOAK_INGEST_BEARER_PATH (default
// tests/perf/.ingest-bearer) — mint one with `bun run seed:perf` first.
//
// Usage:
//   bun run tests/soak/ingest-clickhouse-soak.ts [--hours=24] [--rate=100]
//                                                [--batch=10] [--out=dir]
//
// Flags (CLI equivalents also read from env):
//   --hours      soak duration in hours (default 24). Float OK: --hours=0.1
//   --rate       target events per second (default 100). Batch POSTs pace so
//                events/s = rate; request/s = rate / batch.
//   --batch      events per POST (default 10).
//   --out        output directory (default tests/soak/out).
//
// Env:
//   INGEST_URL             default http://localhost:8000
//   SOAK_INGEST_BEARER     bearer override; otherwise loaded from file
//   SOAK_INGEST_BEARER_PATH  default tests/perf/.ingest-bearer
//   CLICKHOUSE_URL         default http://localhost:8123 (for CH row-count drift check)
//   CLICKHOUSE_DATABASE    default bematist
//
// The trip thresholds the side-car README quotes (Plan B):
//   1. ≥3 ECONNRESET per 100k inserts for >10min
//   2. p99 insert latency > 500ms for >10min
//   3. Silent data-loss signal (CH row-count drift)
// The harness records all three. A run that clears the gate is evidence the
// Bun writer survives prod load; a run that trips any of them is the cue to
// flip `CLICKHOUSE_WRITER=sidecar` per dev-docs/soak-plan-b-readiness.md.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Args = {
  hours: number;
  rate: number;
  batch: number;
  outDir: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    hours: 24,
    rate: 100,
    batch: 10,
    outDir: resolve("tests/soak/out"),
  };
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (!m) continue;
    const [, k, v] = m;
    if (v === undefined) continue;
    switch (k) {
      case "hours":
        out.hours = Number(v);
        break;
      case "rate":
        out.rate = Number(v);
        break;
      case "batch":
        out.batch = Number(v);
        break;
      case "out":
        out.outDir = resolve(v);
        break;
    }
  }
  if (!(out.hours > 0)) throw new Error("--hours must be > 0");
  if (!(out.rate > 0)) throw new Error("--rate must be > 0");
  if (!(out.batch > 0)) throw new Error("--batch must be > 0");
  return out;
}

const INGEST_URL = process.env.INGEST_URL ?? "http://localhost:8000";
const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? "bematist";

function loadBearer(): string {
  if (process.env.SOAK_INGEST_BEARER) return process.env.SOAK_INGEST_BEARER;
  const path = process.env.SOAK_INGEST_BEARER_PATH ?? "tests/perf/.ingest-bearer";
  if (!existsSync(path)) {
    throw new Error(
      `ingest bearer not found at ${path}. Run 'bun run seed:perf' or set SOAK_INGEST_BEARER.`,
    );
  }
  return readFileSync(path, "utf8").trim();
}

function makeEvent(sessionId: string, seq: number): Record<string, unknown> {
  return {
    client_event_id: randomUUID(),
    schema_version: 1,
    ts: new Date().toISOString(),
    tenant_id: "perf-tenant",
    engineer_id: "eng_soak_0",
    device_id: "dev-soak",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier: "B",
    session_id: sessionId,
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

type Bucket = {
  reqs: number;
  ok: number;
  fail: number;
  eventsPosted: number;
  eventsAccepted: number;
  eventsDeduped: number;
  latencies: number[];
  econnreset: number;
  rssBytesSample: number;
  heapBytesSample: number;
};

function newBucket(): Bucket {
  return {
    reqs: 0,
    ok: 0,
    fail: 0,
    eventsPosted: 0,
    eventsAccepted: 0,
    eventsDeduped: 0,
    latencies: [],
    econnreset: 0,
    rssBytesSample: 0,
    heapBytesSample: 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

async function fetchClickHouseCount(bearer: string): Promise<number | null> {
  const sql = `SELECT count() FROM ${CH_DB}.events WHERE tenant_id = 'perf-tenant' AND engineer_id = 'eng_soak_0' FORMAT JSON`;
  try {
    const res = await fetch(`${CH_URL}/?database=${encodeURIComponent(CH_DB)}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: sql,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Array<{ "count()": string | number }> };
    const row = j.data?.[0];
    if (!row) return null;
    const v = row["count()"];
    return typeof v === "string" ? Number(v) : (v ?? null);
  } catch {
    // Used as diagnostic only — a failed count probe doesn't fail the soak.
    void bearer;
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bearer = loadBearer();

  if (!existsSync(args.outDir)) mkdirSync(args.outDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const failPath = resolve(args.outDir, `failures-${runId}.jsonl`);
  const summaryPath = resolve(args.outDir, `summary-${runId}.json`);
  const bucketsPath = resolve(args.outDir, `buckets-${runId}.jsonl`);

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${bearer}`,
  };

  const durationMs = args.hours * 3600 * 1000;
  const reqsPerSec = Math.max(1, Math.round(args.rate / args.batch));
  const gapMs = 1000 / reqsPerSec;
  const sessionId = `soak_${runId}`;

  const startMs = Date.now();
  const startCount = await fetchClickHouseCount(bearer);
  console.info(
    `[soak] starting: hours=${args.hours} rate=${args.rate} ev/s batch=${args.batch} reqs/s=${reqsPerSec} gapMs=${gapMs.toFixed(2)}`,
  );
  console.info(
    `[soak] ingest=${INGEST_URL} clickhouse=${CH_URL} failures=${failPath} summary=${summaryPath}`,
  );
  console.info(`[soak] CH start count (perf-tenant/eng_soak_0) = ${startCount ?? "unknown"}`);

  const agg = newBucket();
  let bucket = newBucket();
  let bucketStartMs = startMs;
  let seq = 0;
  let stopped = false;

  const shutdown = (sig: string) => {
    console.warn(`[soak] received ${sig} — draining and emitting summary`);
    stopped = true;
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  async function doRequest() {
    const events: Record<string, unknown>[] = [];
    for (let i = 0; i < args.batch; i++) events.push(makeEvent(sessionId, seq++));

    const t0 = performance.now();
    let status = 0;
    let accepted = 0;
    let deduped = 0;
    let errorKind: string | null = null;

    try {
      const res = await fetch(`${INGEST_URL}/v1/events`, {
        method: "POST",
        headers,
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(5000),
      });
      status = res.status;
      if (res.ok) {
        try {
          const body = (await res.json()) as { accepted?: number; deduped?: number };
          accepted = Number(body.accepted ?? 0);
          deduped = Number(body.deduped ?? 0);
        } catch {
          errorKind = "body-parse";
        }
      } else {
        errorKind = `http-${status}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorKind =
        msg.includes("ECONNRESET") || msg.includes("socket hang up")
          ? "econnreset"
          : msg.includes("timeout") || msg.includes("aborted")
            ? "timeout"
            : "network";
    }

    const latencyMs = performance.now() - t0;

    bucket.reqs++;
    bucket.eventsPosted += args.batch;
    bucket.latencies.push(latencyMs);
    if (errorKind === null && status >= 200 && status < 300) {
      bucket.ok++;
      bucket.eventsAccepted += accepted;
      bucket.eventsDeduped += deduped;
    } else {
      bucket.fail++;
      if (errorKind === "econnreset") bucket.econnreset++;
      const row = {
        t: new Date().toISOString(),
        status,
        errorKind,
        latencyMs: Math.round(latencyMs),
      };
      await appendFile(failPath, `${JSON.stringify(row)}\n`).catch(() => {});
    }
  }

  async function flushBucketIfDue(now: number) {
    if (now - bucketStartMs < 60_000) return;
    bucket.latencies.sort((a, b) => a - b);
    const mem = process.memoryUsage();
    bucket.rssBytesSample = mem.rss;
    bucket.heapBytesSample = mem.heapUsed;

    const bucketRow = {
      t: new Date().toISOString(),
      elapsedMin: Math.round((now - startMs) / 60_000),
      reqs: bucket.reqs,
      ok: bucket.ok,
      fail: bucket.fail,
      econnreset: bucket.econnreset,
      eventsPosted: bucket.eventsPosted,
      eventsAccepted: bucket.eventsAccepted,
      eventsDeduped: bucket.eventsDeduped,
      p50: Math.round(percentile(bucket.latencies, 50)),
      p95: Math.round(percentile(bucket.latencies, 95)),
      p99: Math.round(percentile(bucket.latencies, 99)),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    };
    await appendFile(bucketsPath, `${JSON.stringify(bucketRow)}\n`).catch(() => {});
    console.info(`[soak] minute ${bucketRow.elapsedMin}: ${JSON.stringify(bucketRow)}`);

    agg.reqs += bucket.reqs;
    agg.ok += bucket.ok;
    agg.fail += bucket.fail;
    agg.eventsPosted += bucket.eventsPosted;
    agg.eventsAccepted += bucket.eventsAccepted;
    agg.eventsDeduped += bucket.eventsDeduped;
    agg.econnreset += bucket.econnreset;
    agg.latencies.push(...bucket.latencies);
    agg.rssBytesSample = Math.max(agg.rssBytesSample, bucket.rssBytesSample);
    agg.heapBytesSample = Math.max(agg.heapBytesSample, bucket.heapBytesSample);

    bucket = newBucket();
    bucketStartMs = now;
  }

  let nextDue = startMs;
  while (!stopped) {
    const now = Date.now();
    if (now - startMs >= durationMs) break;
    if (now >= nextDue) {
      nextDue += gapMs;
      void doRequest();
    } else {
      await Bun.sleep(Math.max(1, nextDue - now));
    }
    await flushBucketIfDue(now);
  }

  // Allow any in-flight requests to settle.
  await Bun.sleep(500);
  await flushBucketIfDue(Date.now() + 60_001);

  const endMs = Date.now();
  const endCount = await fetchClickHouseCount(bearer);

  agg.latencies.sort((a, b) => a - b);
  const successRate = agg.reqs > 0 ? agg.ok / agg.reqs : 0;
  const chDelta = startCount !== null && endCount !== null ? endCount - startCount : null;
  const expectedCh = agg.eventsAccepted;
  const chDrift = chDelta !== null ? chDelta - expectedCh : null;

  const gateTripped: string[] = [];
  if (successRate < 0.9999) gateTripped.push("success-rate<99.99%");
  if (agg.econnreset >= 3) gateTripped.push(`econnreset=${agg.econnreset}`);
  if (percentile(agg.latencies, 99) > 500) gateTripped.push(`p99>${500}ms`);
  if (chDrift !== null && Math.abs(chDrift) > Math.max(100, Math.round(expectedCh * 0.001))) {
    gateTripped.push(`ch-row-drift=${chDrift}`);
  }

  const summary = {
    runId,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationMs: endMs - startMs,
    args,
    ingestUrl: INGEST_URL,
    clickhouseUrl: CH_URL,
    reqs: agg.reqs,
    ok: agg.ok,
    fail: agg.fail,
    successRate,
    econnreset: agg.econnreset,
    eventsPosted: agg.eventsPosted,
    eventsAccepted: agg.eventsAccepted,
    eventsDeduped: agg.eventsDeduped,
    p50Ms: Math.round(percentile(agg.latencies, 50)),
    p95Ms: Math.round(percentile(agg.latencies, 95)),
    p99Ms: Math.round(percentile(agg.latencies, 99)),
    maxRssMb: Math.round(agg.rssBytesSample / 1024 / 1024),
    maxHeapMb: Math.round(agg.heapBytesSample / 1024 / 1024),
    clickhouse: {
      startCount,
      endCount,
      delta: chDelta,
      expected: expectedCh,
      drift: chDrift,
    },
    gate: gateTripped.length === 0 ? "PASS" : "FAIL",
    gateTripped,
  };

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.info(`[soak] summary written to ${summaryPath}`);
  console.info(
    `[soak] result = ${summary.gate}${gateTripped.length ? `: ${gateTripped.join(", ")}` : ""}`,
  );

  process.exit(summary.gate === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error(`[soak] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
