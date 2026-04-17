// Live-only tests for the Bun-native Redis DedupStore.
// Gated by TEST_LIVE_REDIS=1 so CI (no Redis) skips them entirely.
//
// Run locally with:
//   docker compose -f docker-compose.dev.yml up -d redis
//   TEST_LIVE_REDIS=1 bun test apps/ingest/src/dedup/bunRedisDedupStore.test.ts

import { describe, expect, test } from "bun:test";
import { createBunRedisDedupStore } from "./bunRedisDedupStore";

const live = process.env.TEST_LIVE_REDIS === "1";
const url = process.env.REDIS_URL ?? "redis://localhost:6379";

// biome-ignore lint/suspicious/noExplicitAny: test.skipIf is available on bun:test
const runIfLive = (test as any).skipIf ? (test as any).skipIf(!live) : live ? test : test.skip;

describe("bunRedisDedupStore (live)", () => {
  runIfLive("setnx: first sight returns true, duplicate returns false", async () => {
    const store = createBunRedisDedupStore({ url });
    const key = `dedup:test:${Date.now()}:${Math.random()}`;
    const first = await store.setnx(key, 2000);
    const second = await store.setnx(key, 2000);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  runIfLive("configMaxMemoryPolicy returns a non-empty string", async () => {
    const store = createBunRedisDedupStore({ url });
    const policy = await store.configMaxMemoryPolicy();
    expect(typeof policy).toBe("string");
    expect(policy.length).toBeGreaterThan(0);
  });

  runIfLive("ECONNREFUSED on bogus URL wraps error", async () => {
    const store = createBunRedisDedupStore({ url: "redis://127.0.0.1:1" });
    await expect(store.setnx("x", 1000)).rejects.toThrow(/ECONNREFUSED|connection|refused/i);
  });
});
