// PRD §11.2 + D59 — per-installation 1 req/s floor + burst 10, Redis-backed
// token bucket keyed `rl:<installation_id>`. Refill 1/s.
//
// This test pins the pure reducer math against a fake clock + fake Redis —
// no real Redis needed for the unit test (Redis integration covered by the
// end-to-end sync worker test).
//
// Invariants under test:
//   1. Fresh bucket starts with `burst` tokens.
//   2. Each acquire consumes one token; returns wait_ms=0 when tokens>0.
//   3. Empty bucket returns wait_ms rounded UP to the next whole second so
//      callers can `sleep(wait_ms)` and retry without an immediate miss.
//   4. After `sleep(1000ms)`, exactly one token has refilled (floor, not
//      fractional — we don't want half-tokens triggering bursts).
//   5. Burst never exceeds `burst` regardless of elapsed time (no buildup).
//   6. Deterministic under a fake clock.

import { beforeEach, describe, expect, test } from "bun:test";
import { createTokenBucket, type TokenBucketStore } from "./tokenBucket";

/**
 * In-memory Redis shim. Exposes just the shape the bucket needs
 * (GET + SET with optional EX). We seed / inspect the underlying map
 * directly in tests.
 */
function makeMemStore(): TokenBucketStore & { _map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    _map: map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value, ttlSeconds) {
      map.set(key, value);
      // TTL is informational in-test; we don't expire for simplicity.
      void ttlSeconds;
    },
  };
}

describe("github-initial-sync/tokenBucket", () => {
  let store: ReturnType<typeof makeMemStore>;
  let nowMs: number;

  beforeEach(() => {
    store = makeMemStore();
    nowMs = 1_700_000_000_000;
  });

  test("fresh bucket starts with burst tokens; first `burst` acquires are free", async () => {
    const bucket = createTokenBucket({
      store,
      clock: () => nowMs,
      refillPerSecond: 1,
      burst: 10,
    });
    for (let i = 0; i < 10; i++) {
      const { waitMs } = await bucket.acquire("rl:42");
      expect(waitMs).toBe(0);
    }
  });

  test("11th acquire on fresh bucket requires a 1s wait (refill at 1/s)", async () => {
    const bucket = createTokenBucket({
      store,
      clock: () => nowMs,
      refillPerSecond: 1,
      burst: 10,
    });
    for (let i = 0; i < 10; i++) await bucket.acquire("rl:42");
    const { waitMs } = await bucket.acquire("rl:42");
    expect(waitMs).toBe(1000);
  });

  test("refills deterministically under elapsed clock (1s → 1 token)", async () => {
    const bucket = createTokenBucket({
      store,
      clock: () => nowMs,
      refillPerSecond: 1,
      burst: 10,
    });
    // Drain
    for (let i = 0; i < 10; i++) await bucket.acquire("rl:42");
    // Advance 3s — exactly 3 tokens refilled.
    nowMs += 3_000;
    for (let i = 0; i < 3; i++) {
      const { waitMs } = await bucket.acquire("rl:42");
      expect(waitMs).toBe(0);
    }
    // 4th acquire should now wait 1s.
    const { waitMs } = await bucket.acquire("rl:42");
    expect(waitMs).toBe(1000);
  });

  test("burst is capped — waiting >10s does not allow >burst consecutive acquires", async () => {
    const bucket = createTokenBucket({
      store,
      clock: () => nowMs,
      refillPerSecond: 1,
      burst: 10,
    });
    // Initial drain.
    for (let i = 0; i < 10; i++) await bucket.acquire("rl:42");
    // Sit idle for 1 hour — refill must NOT exceed burst.
    nowMs += 3_600_000;
    for (let i = 0; i < 10; i++) {
      const { waitMs } = await bucket.acquire("rl:42");
      expect(waitMs).toBe(0);
    }
    // 11th should wait — proves cap held.
    const { waitMs } = await bucket.acquire("rl:42");
    expect(waitMs).toBe(1000);
  });

  test("tenants are isolated by key (rl:<installation_id>)", async () => {
    const bucket = createTokenBucket({
      store,
      clock: () => nowMs,
      refillPerSecond: 1,
      burst: 2,
    });
    await bucket.acquire("rl:1");
    await bucket.acquire("rl:1");
    // rl:1 is now drained.
    // rl:2 still fresh.
    const r2a = await bucket.acquire("rl:2");
    const r2b = await bucket.acquire("rl:2");
    expect(r2a.waitMs).toBe(0);
    expect(r2b.waitMs).toBe(0);
    // rl:1 third acquire must wait.
    const r1c = await bucket.acquire("rl:1");
    expect(r1c.waitMs).toBe(1000);
  });

  test("wait_ms rounds UP to next whole second (no sub-second busy-loop)", async () => {
    const bucket = createTokenBucket({
      store,
      clock: () => nowMs,
      refillPerSecond: 1,
      burst: 1,
    });
    await bucket.acquire("rl:42"); // drain
    // Advance 200ms; 800ms still needed → waitMs must round UP to 1000.
    nowMs += 200;
    const { waitMs } = await bucket.acquire("rl:42");
    expect(waitMs).toBe(1000);
  });
});
