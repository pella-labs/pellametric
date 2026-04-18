import { afterAll, beforeEach, expect, test } from "bun:test";
import * as schema from "@bematist/schema/postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ANOMALY_NOTIFY_CHANNEL, PostgresAnomalyNotifier } from "./pg_notifier";
import type { Alert } from "./types";

const PG_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";

// Dedicated PG client for this test file — keeps the singleton in
// `apps/worker/src/db.ts` from being torn down by an `afterAll` hook
// here (other test files share that singleton via direct import).
const localClient = postgres(PG_URL, { max: 5 });
const localDb = drizzle(localClient, { schema });
const { alerts, orgs } = schema;

async function reset() {
  await localDb.execute(drizzleSql`TRUNCATE TABLE alerts, orgs RESTART IDENTITY CASCADE`);
}

function must<T>(v: T | undefined, label = "expected non-empty value"): T {
  if (v === undefined) throw new Error(label);
  return v;
}

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await localClient.end({ timeout: 1 });
});

test("PostgresAnomalyNotifier persists alerts and pg_notifies subscribers within 5s", async () => {
  const org = must(
    (await localDb.insert(orgs).values({ slug: "anom_org", name: "Anomaly Test" }).returning())[0],
  );

  const listener = postgres(PG_URL, { max: 1, idle_timeout: 0 });
  const received: string[] = [];
  // Subscribe FIRST so the NOTIFY raised by publish() is observed.
  const sub = await listener.listen(ANOMALY_NOTIFY_CHANNEL, (payload) => {
    received.push(payload);
  });

  try {
    const notifier = new PostgresAnomalyNotifier({ db: localDb });
    const alert: Alert = {
      engineer_id: "eng_test",
      org_id: org.id,
      signal: "cost_usd",
      hour_bucket: "2026-04-17T14:00:00.000Z",
      value: 500,
      threshold: 100,
      mean: 50,
      stddev: 10,
      reason: "sigma3",
      cohort_k: 1,
    };

    const t0 = Date.now();
    await notifier.publish(alert);

    // Wait up to 5s for the NOTIFY to round-trip (acceptance gate).
    const deadline = Date.now() + 5000;
    while (received.length === 0 && Date.now() < deadline) {
      await Bun.sleep(25);
    }
    const elapsed = Date.now() - t0;
    expect(received.length, `expected NOTIFY within 5s, got ${elapsed}ms`).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000);

    const parsed = JSON.parse(must(received[0])) as Record<string, unknown>;
    expect(parsed.org_id).toBe(org.id);
    expect(parsed.signal).toBe("cost_usd");
    expect(parsed.kind).toBe("cost_spike");
    expect(parsed.value).toBe(500);
    expect(parsed.threshold).toBe(100);
    expect(parsed.dev_id_hash).toBe("eng_test");
    expect(parsed.hour_bucket).toBe("2026-04-17T14:00:00.000Z");
    expect(parsed.reason).toBe("sigma3");
    expect(typeof parsed.id).toBe("string");
    expect(typeof parsed.ts).toBe("string");

    // Row was actually persisted (defense-in-depth: SSE doesn't bypass DB).
    const rows = await localDb.select().from(alerts);
    expect(rows).toHaveLength(1);
    const row = must(rows[0]);
    expect(row.org_id).toBe(org.id);
    expect(row.kind).toBe("cost_spike");
    expect(row.signal).toBe("cost_usd");
    expect(row.value).toBe(500);
    expect(row.threshold).toBe(100);
    expect(row.dev_id_hash).toBe("eng_test");
  } finally {
    await sub.unlisten();
    await listener.end({ timeout: 1 });
  }
});

test("notifier maps each detector signal to the right alerts.kind discriminator", async () => {
  const org = must(
    (await localDb.insert(orgs).values({ slug: "anom_kinds", name: "Kinds" }).returning())[0],
  );
  const notifier = new PostgresAnomalyNotifier({ db: localDb });
  const baseline: Omit<Alert, "signal"> = {
    engineer_id: "eng",
    org_id: org.id,
    hour_bucket: "2026-04-17T14:00:00.000Z",
    value: 1,
    threshold: 0.5,
    mean: 0.1,
    stddev: 0.05,
    reason: "sigma3",
    cohort_k: 1,
  };

  await notifier.publish({ ...baseline, signal: "cost_usd" });
  await notifier.publish({ ...baseline, signal: "input_tokens" });
  await notifier.publish({ ...baseline, signal: "tool_error_rate" });

  const rows = await localDb.select().from(alerts);
  const kinds = rows.map((r) => r.kind).sort();
  expect(kinds).toEqual(["cost_spike", "token_spike", "tool_error_spike"]);
});
