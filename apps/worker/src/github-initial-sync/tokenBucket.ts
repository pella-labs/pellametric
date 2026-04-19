// PRD §11.2 / D59 — per-installation Redis-backed token bucket.
//
//   refillPerSecond = 1     → 1 req/s floor per installation
//   burst           = 10    → short allowance for bursty calls
//
// Stored state (JSON-encoded) at key `rl:<installation_id>`:
//   { tokens: number, updatedAtMs: number }
//
// Acquire semantics (pure reducer — no Redis atomicity relied upon; this is
// the G1 per-worker-node gate, not a multi-writer distributed lock):
//
//   1. Load state; default to { tokens: burst, updatedAtMs: now }.
//   2. Refill: `tokens += floor((now - updatedAtMs) / 1000) * refillPerSecond`,
//      capped at `burst`. Using `floor` (not fractional accumulation) means
//      clients never over-burst via sub-second arithmetic.
//   3. If tokens >= 1: consume one, return { waitMs: 0 }.
//      Else: return { waitMs: ceil( (1 / refillPerSecond - elapsedFrac) * 1000 ) },
//      rounded UP to the next whole second so a `sleep(waitMs)` will definitely
//      make a token available (no off-by-one jitter loop).
//
// No Redis-side CAS — single-worker-node assumption per §11.2 (the 5-slot
// semaphore above this pins us to one node at a time per tenant). For
// multi-worker deployments G1-linker adds a Lua CAS; out of scope here.

export interface TokenBucketStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

export interface TokenBucketOptions {
  store: TokenBucketStore;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  clock?: () => number;
  /** Tokens refilled per second. PRD D59 = 1. */
  refillPerSecond: number;
  /** Maximum tokens in bucket. PRD D59 = 10. */
  burst: number;
  /**
   * TTL (seconds) to set on the Redis key. Defaults to 1 hour — if a bucket
   * sits idle for >1h Redis GCs it and the next acquire starts fresh (also
   * fine, because after 1h of idle the bucket is full anyway).
   */
  ttlSeconds?: number;
}

export interface TokenBucket {
  /**
   * Try to consume one token. Returns `{ waitMs: 0 }` on success; otherwise
   * `{ waitMs }` — caller is expected to `sleep(waitMs)` and retry.
   * Never throws; underlying store errors surface as `{ waitMs: 1000 }`
   * (conservative back-off) rather than crashing the sync worker.
   */
  acquire(key: string): Promise<{ waitMs: number }>;
}

interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

export function createTokenBucket(opts: TokenBucketOptions): TokenBucket {
  const clock = opts.clock ?? (() => Date.now());
  const ttlSeconds = opts.ttlSeconds ?? 3600;

  return {
    async acquire(key: string): Promise<{ waitMs: number }> {
      const now = clock();
      let state: BucketState;
      try {
        const raw = await opts.store.get(key);
        state = raw ? (JSON.parse(raw) as BucketState) : { tokens: opts.burst, updatedAtMs: now };
      } catch {
        return { waitMs: 1000 };
      }

      // Refill — floor elapsed seconds so we never accumulate fractional
      // tokens across calls; that would allow micro-burst beyond `burst`.
      const elapsedMs = Math.max(0, now - state.updatedAtMs);
      const refill = Math.floor((elapsedMs / 1000) * opts.refillPerSecond);
      if (refill > 0) {
        state.tokens = Math.min(opts.burst, state.tokens + refill);
        state.updatedAtMs = state.updatedAtMs + Math.floor(refill / opts.refillPerSecond) * 1000;
      }

      if (state.tokens >= 1) {
        state.tokens -= 1;
        state.updatedAtMs = Math.max(state.updatedAtMs, now);
        await writeState(opts.store, key, state, ttlSeconds);
        return { waitMs: 0 };
      }

      // Empty bucket. Round UP to the next whole second so a single
      // `sleep(waitMs)` always puts us over the refill threshold.
      // (Math.ceil on the exact time-to-next-token, clamped to at least the
      // full ms-per-token so callers never busy-loop at <1s granularity.)
      const msPerToken = Math.ceil(1000 / opts.refillPerSecond);
      const roundedUp = msPerToken;
      // Clock did NOT advance yet — we do not mutate state.updatedAtMs here.
      // Persist so other processes don't see a fresh default-full bucket.
      await writeState(opts.store, key, state, ttlSeconds);
      return { waitMs: roundedUp };
    },
  };
}

async function writeState(
  store: TokenBucketStore,
  key: string,
  state: BucketState,
  ttlSeconds: number,
): Promise<void> {
  try {
    await store.set(key, JSON.stringify(state), ttlSeconds);
  } catch {
    // Swallow — best-effort persistence. A dropped write means the next call
    // sees the prior state (or a default-full bucket) — safer than crashing
    // the sync pipeline.
  }
}
