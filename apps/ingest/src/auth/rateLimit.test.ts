import { describe, expect, test } from "bun:test";
import { createLuaRateLimiter, type LuaRedis } from "./rateLimit";

// --- Fake Redis ---------------------------------------------------------

interface FakeBucket {
  tokens: number;
  ts: number;
}

function makeFakeRedis(
  opts: { capacity?: number; refillPerSec?: number; nowMs?: () => number } = {},
): LuaRedis & {
  scriptLoadCalls: number;
  evalshaCalls: number;
  evalCalls: number;
  throwNoScript: boolean;
  buckets: Map<string, FakeBucket>;
} {
  const nowMs = opts.nowMs ?? (() => Date.now());
  let scriptLoadCalls = 0;
  let evalshaCalls = 0;
  let evalCalls = 0;
  const buckets = new Map<string, FakeBucket>();

  function runBucket(
    keys: (string | number)[],
    args: (string | number)[],
  ): [number, number, number] {
    const key = String(keys[0]);
    const cap = Number(args[0]);
    const rate = Number(args[1]); // per second
    const cost = Number(args[2]);
    const now = nowMs();
    const existing = buckets.get(key);
    let tok = existing?.tokens ?? cap;
    const ts = existing?.ts ?? now;
    tok = Math.min(cap, tok + ((now - ts) * rate) / 1000);
    if (tok < cost) {
      buckets.set(key, { tokens: tok, ts: now });
      return [0, Math.floor(tok), Math.ceil(((cost - tok) * 1000) / rate)];
    }
    tok = tok - cost;
    buckets.set(key, { tokens: tok, ts: now });
    return [1, Math.floor(tok), 0];
  }

  const self = {
    scriptLoadCalls: 0,
    evalshaCalls: 0,
    evalCalls: 0,
    throwNoScript: false,
    buckets,
    async scriptLoad(_src: string) {
      scriptLoadCalls++;
      self.scriptLoadCalls = scriptLoadCalls;
      return "sha-1234";
    },
    async evalsha(
      _sha: string,
      keys: (string | number)[],
      args: (string | number)[],
    ): Promise<[number, number, number]> {
      evalshaCalls++;
      self.evalshaCalls = evalshaCalls;
      if (self.throwNoScript) {
        self.throwNoScript = false;
        const err = new Error("NOSCRIPT No matching script. Please use EVAL.");
        throw err;
      }
      return runBucket(keys, args);
    },
    async eval(
      _src: string,
      keys: (string | number)[],
      args: (string | number)[],
    ): Promise<[number, number, number]> {
      evalCalls++;
      self.evalCalls = evalCalls;
      return runBucket(keys, args);
    },
  } as unknown as LuaRedis & {
    scriptLoadCalls: number;
    evalshaCalls: number;
    evalCalls: number;
    throwNoScript: boolean;
    buckets: Map<string, FakeBucket>;
  };
  return self;
}

describe("createLuaRateLimiter", () => {
  test("first consume() loads script, then evalsha; returns {allowed:true, remaining:999}", async () => {
    const redis = makeFakeRedis();
    const rl = createLuaRateLimiter(redis, 1000, 1000);
    const r = await rl.consume("orgA", "devA", 1);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(999);
    expect(r.retryAfterMs).toBe(0);
    expect(redis.scriptLoadCalls).toBe(1);
    expect(redis.evalshaCalls).toBe(1);
  });

  test("100 consume() calls at cost=1 all allowed", async () => {
    const redis = makeFakeRedis();
    const rl = createLuaRateLimiter(redis, 1000, 1000);
    for (let i = 0; i < 100; i++) {
      const r = await rl.consume("orgA", "devA", 1);
      expect(r.allowed).toBe(true);
    }
  });

  test("1001st call denied with retryAfterMs > 0", async () => {
    // Freeze time so refill doesn't help
    const t = 1_000_000;
    const redis = makeFakeRedis({ nowMs: () => t });
    const rl = createLuaRateLimiter(redis, 1000, 1000);
    for (let i = 0; i < 1000; i++) {
      const r = await rl.consume("orgA", "devA", 1);
      expect(r.allowed).toBe(true);
    }
    const denied = await rl.consume("orgA", "devA", 1);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  test("NOSCRIPT thrown by evalsha → fallback to eval; subsequent call re-loads script", async () => {
    const redis = makeFakeRedis();
    const rl = createLuaRateLimiter(redis, 1000, 1000);
    // First call: loads + evalshas fine
    await rl.consume("orgA", "devA", 1);
    expect(redis.scriptLoadCalls).toBe(1);
    expect(redis.evalshaCalls).toBe(1);
    expect(redis.evalCalls).toBe(0);
    // Flush server: next evalsha throws NOSCRIPT → fallback to eval
    redis.throwNoScript = true;
    const r2 = await rl.consume("orgA", "devA", 1);
    expect(r2.allowed).toBe(true);
    expect(redis.evalCalls).toBe(1);
    // Next consume: re-loads script and uses evalsha
    const r3 = await rl.consume("orgA", "devA", 1);
    expect(r3.allowed).toBe(true);
    expect(redis.scriptLoadCalls).toBe(2);
  });

  test("second consume() does not re-scriptLoad", async () => {
    const redis = makeFakeRedis();
    const rl = createLuaRateLimiter(redis, 1000, 1000);
    await rl.consume("orgA", "devA", 1);
    await rl.consume("orgA", "devA", 1);
    expect(redis.scriptLoadCalls).toBe(1);
    expect(redis.evalshaCalls).toBe(2);
  });
});
