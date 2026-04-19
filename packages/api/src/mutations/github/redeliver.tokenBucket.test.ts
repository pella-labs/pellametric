// B9 — per-installation token bucket replaces per-call sleep(1000).
//
// The bucket lives at packages/api/src/github/tokenBucket.ts and is
// keyed `rl:<installation_id>` per PRD D59. When two admins (or one
// admin + the reconciler + a retry) call `redeliverWebhooks` for the
// same installation concurrently, they share the bucket through Redis,
// so the COMBINED rate is rate-limited — not the per-call rate.
//
// This test asserts the bucket is consulted (and that a `sleep(waitMs)`
// path fires when the bucket is empty) — it does NOT require a live
// Redis. The shared `TokenBucketStore` is an in-memory map.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../auth";
import {
  createTokenBucket,
  installationBucketKey,
  type TokenBucketStore,
} from "../../github/tokenBucket";
import { redeliverWebhooks } from "./redeliver";

const TENANT = "11111111-2222-3333-4444-555555555555";
const INSTALLATION_ID = 42424242;

interface DeliverySeed {
  id: number;
  delivered_at: string;
  event: string;
  installation_id: number;
}

function fakeGithub(deliveries: DeliverySeed[]) {
  const getCalls: string[] = [];
  const postCalls: string[] = [];
  let page = 0;
  return {
    getCalls,
    postCalls,
    http: {
      async get(url: string) {
        getCalls.push(url);
        page++;
        return page === 1
          ? { status: 200, body: deliveries, headers: {} }
          : { status: 200, body: [], headers: {} };
      },
      async post(url: string) {
        postCalls.push(url);
        return { status: 202, body: {}, headers: {} };
      },
    },
  };
}

function makeCtx(): Ctx {
  return {
    tenant_id: TENANT,
    actor_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    role: "admin",
    db: {
      pg: {
        async query<T = unknown>(sql: string): Promise<T[]> {
          if (/FROM github_installations/i.test(sql)) {
            return [{ installation_id: String(INSTALLATION_ID) }] as unknown as T[];
          }
          return [] as T[];
        },
      },
      ch: {
        async query() {
          return [];
        },
      },
      redis: {
        async get() {
          return null;
        },
        async set() {},
        async setNx() {
          return true;
        },
      },
    },
  };
}

function memStore(): TokenBucketStore & { _map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    _map: map,
    async get(k) {
      return map.get(k) ?? null;
    },
    async set(k, v) {
      map.set(k, v);
    },
  };
}

describe("B9 — redeliverWebhooks per-installation token bucket", () => {
  test("bucket acquire is called per HTTP call and sleep fires on waitMs>0", async () => {
    const seeds: DeliverySeed[] = [
      {
        id: 1,
        delivered_at: "2026-04-10T10:00:00Z",
        event: "push",
        installation_id: INSTALLATION_ID,
      },
      {
        id: 2,
        delivered_at: "2026-04-10T11:00:00Z",
        event: "push",
        installation_id: INSTALLATION_ID,
      },
    ];
    const fake = fakeGithub(seeds);
    const sleeps: number[] = [];
    const store = memStore();

    // burst=1, refill=1/s — the first acquire returns waitMs=0; every
    // subsequent one until the clock advances returns waitMs=1000.
    let clock = 0;
    const bucket = createTokenBucket({
      store,
      clock: () => clock,
      refillPerSecond: 1,
      burst: 1,
    });

    const out = await redeliverWebhooks(
      makeCtx(),
      {
        from: "2026-04-10T00:00:00.000Z",
        to: "2026-04-10T23:59:59.000Z",
      },
      {
        http: fake.http,
        appJwtProvider: async () => "jwt-test",
        tokenBucket: bucket,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms; // advance the bucket's clock by the sleep
        },
        now: () => clock,
      },
    );

    expect(out.deliveries_requested).toBe(2);
    expect(out.queued_attempts).toBe(2);
    // burst=1 means the 1st acquire in the run passes; every subsequent
    // acquire must wait 1000ms. Two POSTs + two list pages = 4 acquires
    // → 3 waits of 1000ms.
    expect(sleeps.filter((n) => n === 1000).length).toBeGreaterThanOrEqual(3);
    // Bucket state was written to the shared store — key must match
    // installationBucketKey for the tenant's single installation.
    expect(store._map.has(installationBucketKey(INSTALLATION_ID))).toBe(true);
  });

  test("two concurrent redelivery calls share a bucket through a shared store", async () => {
    const seeds: DeliverySeed[] = [
      {
        id: 7,
        delivered_at: "2026-04-10T10:00:00Z",
        event: "push",
        installation_id: INSTALLATION_ID,
      },
      {
        id: 8,
        delivered_at: "2026-04-10T11:00:00Z",
        event: "push",
        installation_id: INSTALLATION_ID,
      },
    ];

    const store = memStore();
    // Build a single shared bucket; the clock only advances via sleeps.
    let clock = 0;
    const bucket = createTokenBucket({
      store,
      clock: () => clock,
      refillPerSecond: 1,
      burst: 2,
    });

    async function runOne(): Promise<number[]> {
      const sleeps: number[] = [];
      const fake = fakeGithub([...seeds]);
      await redeliverWebhooks(
        makeCtx(),
        {
          from: "2026-04-10T00:00:00.000Z",
          to: "2026-04-10T23:59:59.000Z",
        },
        {
          http: fake.http,
          appJwtProvider: async () => "jwt-test",
          tokenBucket: bucket,
          sleep: async (ms) => {
            sleeps.push(ms);
            clock += ms;
          },
          now: () => clock,
        },
      );
      return sleeps;
    }

    // Run both serially here (the assertion is about the SHARED bucket
    // draining across invocations — parallel scheduling is an orthogonal
    // concern). Run A drains burst=2; Run B starts with tokens<1 →
    // every acquire waits 1000ms.
    const sleepsA = await runOne();
    const sleepsB = await runOne();

    // Sanity: Run A is cheap (bucket starts full with 2 tokens and clock
    // advances per HTTP call by 1000ms → several 1000ms waits remain
    // expected because the run needs >2 acquires).
    expect(sleepsA.length).toBeGreaterThan(0);
    // Run B pays the full per-acquire 1000ms cost because it inherits a
    // drained bucket from Run A.
    expect(sleepsB.filter((n) => n === 1000).length).toBeGreaterThanOrEqual(3);
  });
});
