// Sprint 1 Redis token-bucket rate limiter.
//
// Abstraction choices (forced by Bun 1.0.7 — Bun.redis does not exist yet):
//   - LuaRedis is an interface with scriptLoad/evalsha/eval; real impl is a
//     thin wrapper over node-redis (@redis/client v4) that we lazy-require only
//     at runtime. Tests inject a fake — no network dep.
//
// Lua script lives at packages/redact/scripts/token_bucket.lua (co-owned C/G).
// We inline it as a string for the evalsha/eval path to keep the library
// self-contained in Sprint 1. A Phase-4 build step may load it from disk.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(orgId: string, deviceId: string, cost?: number): Promise<RateLimitResult>;
}

export interface LuaRedis {
  scriptLoad(src: string): Promise<string>;
  evalsha(
    sha: string,
    keys: (string | number)[],
    args: (string | number)[],
  ): Promise<[number, number, number]>;
  eval(
    src: string,
    keys: (string | number)[],
    args: (string | number)[],
  ): Promise<[number, number, number]>;
}

// --- Lua source --------------------------------------------------------------

function loadLuaSource(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // apps/ingest/src/auth -> ../../../../packages/redact/scripts/token_bucket.lua
    const p = resolve(here, "../../../../packages/redact/scripts/token_bucket.lua");
    return readFileSync(p, "utf8");
  } catch {
    // Inline fallback — keep in sync with packages/redact/scripts/token_bucket.lua.
    return `local t    = redis.call('TIME')
local now  = t[1]*1000 + math.floor(t[2]/1000)
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local h    = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tok  = tonumber(h[1]) or cap
local ts   = tonumber(h[2]) or now
tok = math.min(cap, tok + (now - ts) * rate / 1000)
if tok < cost then
  redis.call('HMSET', KEYS[1], 'tokens', tok, 'ts', now)
  redis.call('PEXPIRE', KEYS[1], 60000)
  return {0, tok, math.ceil((cost - tok) * 1000 / rate)}
end
tok = tok - cost
redis.call('HMSET', KEYS[1], 'tokens', tok, 'ts', now)
redis.call('PEXPIRE', KEYS[1], 60000)
return {1, tok, 0}`;
  }
}

// --- Factory -----------------------------------------------------------------

export function createLuaRateLimiter(
  redis: LuaRedis,
  capacity = 1000,
  refillPerSec = 1000,
): RateLimiter {
  const src = loadLuaSource();
  let shaPromise: Promise<string> | null = null;

  async function ensureSha(): Promise<string> {
    if (!shaPromise) shaPromise = redis.scriptLoad(src);
    return shaPromise;
  }

  function resetSha() {
    shaPromise = null;
  }

  return {
    async consume(orgId, deviceId, cost = 1) {
      // Hash-tag the org for Redis Cluster affinity: {orgId}
      const key = `rl:{${orgId}}:${deviceId}`;
      const args = [String(capacity), String(refillPerSec), String(cost)];
      const sha = await ensureSha();
      let result: [number, number, number];
      try {
        result = await redis.evalsha(sha, [key], args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NOSCRIPT")) {
          // Flush on server — fallback to inline eval. Reset cached sha so
          // the NEXT consume() re-uploads the script.
          resetSha();
          result = await redis.eval(src, [key], args);
        } else {
          throw err;
        }
      }
      const [allowed, remaining, retryAfterMs] = result;
      return {
        allowed: allowed === 1,
        remaining: Number(remaining),
        retryAfterMs: Number(retryAfterMs),
      };
    },
  };
}

// --- Permissive limiter for tests / dev stub -------------------------------

export function permissiveRateLimiter(): RateLimiter {
  return {
    async consume() {
      return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0 };
    },
  };
}
