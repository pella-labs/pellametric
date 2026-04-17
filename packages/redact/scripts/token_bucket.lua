-- packages/redact/scripts/token_bucket.lua
-- Token-bucket rate-limit script for Redis EVALSHA. Co-owned C/G.
-- KEYS[1] = bucket key (e.g. "rl:{orgId}:deviceId")
-- ARGV[1] = capacity (tokens)
-- ARGV[2] = refill rate (tokens per second)
-- ARGV[3] = cost (tokens to consume)
-- Returns: {allowed(0|1), remaining_tokens, retry_after_ms}
local t    = redis.call('TIME')
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
return {1, tok, 0}
