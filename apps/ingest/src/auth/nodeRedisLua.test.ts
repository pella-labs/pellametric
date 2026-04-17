// Live-only tests for the node-redis Lua client.
// Gated by TEST_LIVE_REDIS=1.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createNodeRedisLuaClient, createSharedNodeRedisClient } from "./nodeRedisLua";
import { createLuaRateLimiter, type LuaRedis } from "./rateLimit";

const live = process.env.TEST_LIVE_REDIS === "1";
const url = process.env.REDIS_URL ?? "redis://localhost:6379";

// biome-ignore lint/suspicious/noExplicitAny: test.skipIf is available on bun:test
const runIfLive = (test as any).skipIf ? (test as any).skipIf(!live) : live ? test : test.skip;

describe("nodeRedisLua (live)", () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic client
  let sharedClient: any;
  let lua: (LuaRedis & { quit(): Promise<void> }) | null = null;

  beforeAll(async () => {
    if (!live) return;
    sharedClient = await createSharedNodeRedisClient({ url });
    lua = await createNodeRedisLuaClient({ client: sharedClient });
  });

  afterAll(async () => {
    if (!live) return;
    try {
      await lua?.quit();
    } catch {}
    try {
      await sharedClient?.quit();
    } catch {}
  });

  runIfLive("scriptLoad returns a sha1 hex string", async () => {
    if (!lua) throw new Error("lua not initialized");
    const sha = await lua.scriptLoad("return {1, 2, 3}");
    expect(typeof sha).toBe("string");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  runIfLive("evalsha of token-bucket returns [1, n, 0] for allowed", async () => {
    if (!lua) throw new Error("lua not initialized");
    const limiter = createLuaRateLimiter(lua, 1000, 1000);
    const result = await limiter.consume(`org-${Date.now()}`, "dev-1", 1);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  runIfLive("NOSCRIPT on unknown SHA triggers fallback eval", async () => {
    if (!lua) throw new Error("lua not initialized");
    await expect(lua.evalsha("0".repeat(40), [`rl:{org-fb}:dev-1`], ["1"])).rejects.toThrow(
      /NOSCRIPT/,
    );
    // Now exercise the rate limiter's built-in fallback path.
    const limiter = createLuaRateLimiter(lua, 1000, 1000);
    const result = await limiter.consume(`org-fb-${Date.now()}`, "dev-1", 1);
    expect(result.allowed).toBe(true);
  });
});
