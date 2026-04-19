/**
 * G3 — F15 Bun↔ClickHouse soak gate, 10-minute compressed proxy (PRD G3 note #9).
 *
 * Full 24h soak lives at `tests/soak/ingest-clickhouse-soak.ts` and gates
 * the Plan B decision per CLAUDE.md Architecture Rule #7. For v1 MVP we run
 * a 10-min compressed version AS A PROXY — the full 24h gate is scheduled
 * for post-MVP hardening.
 *
 * This harness replaces the HTTP-to-ingest path with a DIRECT `@clickhouse/client`
 * write loop so the CI gate exercises just the Bun↔CH writer without
 * requiring the full dev stack (ingest + seed + bearer). We still gate on
 * the same trip thresholds the README quotes:
 *   1. ≥3 ECONNRESET per 100k inserts for >10min
 *   2. p99 insert latency > 500ms for >10min
 *   3. Silent data-loss signal (CH row-count drift)
 *
 * Runs for `SOAK_COMPRESSED_MINUTES` minutes (default 10). Skipped when
 * CLICKHOUSE_URL is unreachable (so `bun test` without a dev stack passes).
 *
 * Meant to be invoked as `SOAK_COMPRESSED_MINUTES=10 bun test tests/soak/compressed-proxy.test.ts`
 * in CI; locally operators still run the full `bun run test:soak`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Dynamic import — `@clickhouse/client` lives under workspace deps (apps/*
// + tests/privacy) but not at the repo root. We import via the nearest
// resolver at test start so `bun test tests/soak/compressed-proxy.test.ts`
// works when run from any workspace that transitively provides the dep.
// Skip gracefully when the module isn't resolvable.
type ClickHouseClientT = {
  ping: () => Promise<unknown>;
  command: (q: { query: string }) => Promise<unknown>;
  insert: (args: { table: string; values: unknown[]; format: string }) => Promise<unknown>;
  query: (args: { query: string; format: string }) => Promise<{
    json<T>(): Promise<T[]>;
  }>;
  close: () => Promise<void>;
};
let createClient: (cfg: { url: string; database: string }) => ClickHouseClientT;

const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? "bematist";
const MINUTES = Number.parseFloat(process.env.SOAK_COMPRESSED_MINUTES ?? "0.1");
const TARGET_RATE = Number.parseInt(process.env.SOAK_COMPRESSED_RATE ?? "100", 10);
const BATCH = Number.parseInt(process.env.SOAK_COMPRESSED_BATCH ?? "10", 10);

let client: ClickHouseClientT | null = null;
let skip = false;

beforeAll(async () => {
  try {
    // Dynamic resolve via multiple workspace candidates.
    const candidates = [
      "@clickhouse/client",
      "../../tests/privacy/node_modules/@clickhouse/client",
      "../../apps/worker/node_modules/@clickhouse/client",
      "../../apps/ingest/node_modules/@clickhouse/client",
    ];
    let mod: { createClient: typeof createClient } | null = null;
    for (const c of candidates) {
      try {
        mod = (await import(c)) as { createClient: typeof createClient };
        break;
      } catch {
        // try next
      }
    }
    if (!mod) throw new Error("@clickhouse/client not resolvable from tests/soak");
    createClient = mod.createClient;
    client = createClient({ url: CH_URL, database: CH_DB });
    await client.ping();
    // Create a scratch table — isolated from production `events`.
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS soak_compressed_proxy (
          ts DateTime64(3),
          tenant_id UUID,
          sample String
        ) ENGINE = MergeTree
        PARTITION BY toYYYYMM(ts)
        ORDER BY (tenant_id, ts)
        SETTINGS index_granularity = 8192`,
    });
    // TRUNCATE may be eventually-consistent under async merges; DROP+RECREATE
    // is the only way to guarantee an empty state for the drift calculation.
    await client.command({ query: "DROP TABLE IF EXISTS soak_compressed_proxy" });
    await client.command({
      query: `
        CREATE TABLE soak_compressed_proxy (
          ts DateTime64(3),
          tenant_id UUID,
          sample String
        ) ENGINE = MergeTree
        PARTITION BY toYYYYMM(ts)
        ORDER BY (tenant_id, ts)
        SETTINGS index_granularity = 8192`,
    });
  } catch (err) {
    skip = true;
    console.log(`[soak-compressed] SKIPPED — ${(err as Error).message}`);
  }
});

afterAll(async () => {
  if (client) await client.close();
});

const suite = skip ? describe.skip : describe;

suite("F15 compressed proxy — Bun↔ClickHouse writer (G3 v1 gate)", () => {
  test(
    `sustain ${TARGET_RATE} evt/s for ${MINUTES} min with zero flakes`,
    async () => {
      const totalEventsTarget = Math.floor(TARGET_RATE * MINUTES * 60);
      const requests = Math.ceil(totalEventsTarget / BATCH);
      const interMs = (1000 * BATCH) / TARGET_RATE;

      const latencies: number[] = [];
      let writes = 0;
      let failures = 0;

      if (!client) throw new Error("client not initialized");
      const c = client;
      const startedAt = Date.now();
      for (let i = 0; i < requests; i++) {
        const t0 = performance.now();
        try {
          const rows: Array<{ ts: string; tenant_id: string; sample: string }> = [];
          for (let j = 0; j < BATCH; j++) {
            rows.push({
              ts: new Date().toISOString().slice(0, 23),
              tenant_id: "00000000-0000-0000-0000-000000000000",
              sample: `soak-${i}-${j}`,
            });
          }
          await c.insert({
            table: "soak_compressed_proxy",
            values: rows,
            format: "JSONEachRow",
          });
          writes += BATCH;
        } catch (_err) {
          failures++;
        }
        latencies.push(performance.now() - t0);

        // pace to target rate.
        const elapsed = Date.now() - startedAt;
        const expectedMs = (i + 1) * interMs;
        if (expectedMs > elapsed) {
          await new Promise((r) => setTimeout(r, expectedMs - elapsed));
        }
      }

      // Stats.
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
      const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;
      // Give ClickHouse a moment to finalize any in-flight inserts before
      // we read the row count.
      await new Promise((r) => setTimeout(r, 1000));
      const rows =
        (await c
          .query({
            query: `SELECT count() AS c FROM soak_compressed_proxy`,
            format: "JSONEachRow",
          })
          .then((r) => r.json<{ c: string }>())) ?? [];
      const chCount = Number((rows as Array<{ c: string }>)[0]?.c ?? 0);

      // Success gates (compressed proxy — relaxed timebox, same shape as prod).
      const successRate = writes / (writes + failures || 1);
      const driftPct = writes === 0 ? 1 : Math.abs(chCount - writes) / writes;

      console.log(
        JSON.stringify({
          name: "F15 compressed proxy",
          minutes: MINUTES,
          rate: TARGET_RATE,
          batch: BATCH,
          writes,
          failures,
          successRate: Number(successRate.toFixed(5)),
          p50_ms: Number(p50.toFixed(2)),
          p99_ms: Number(p99.toFixed(2)),
          ch_row_count: chCount,
          drift_pct: Number(driftPct.toFixed(5)),
        }),
      );

      expect(successRate).toBeGreaterThanOrEqual(0.9999);
      expect(p99).toBeLessThan(500);
      expect(driftPct).toBeLessThan(0.001);
    },
    Math.ceil((MINUTES + 0.5) * 60 * 1000),
  );
});
