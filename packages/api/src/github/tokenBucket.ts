// PRD §11.2 / D59 — per-installation token bucket, shared across
// ingest/worker/api callers.
//
// Used today by:
//   - `apps/worker/src/github-initial-sync/dispatcher.ts` (initial-sync
//     pagination against `/installation/repositories`).
//   - `packages/api/src/mutations/github/redeliver.ts` (admin-initiated
//     webhook redelivery against `/app/hook/deliveries`).
//
// Stored state (JSON-encoded) at key `rl:<installation_id>`:
//   { tokens: number, updatedAtMs: number }
//
// Acquire semantics (pure reducer — no Redis atomicity relied upon; the
// per-worker-node 5-slot semaphore above this pins us to one node at a
// time per tenant for sync, and redelivery is admin-triggered so
// concurrent callers are bounded):
//
//   1. Load state; default to { tokens: burst, updatedAtMs: now }.
//   2. Refill: `tokens += floor((now - updatedAtMs) / 1000) * refillPerSecond`,
//      capped at `burst`. `floor` (not fractional accumulation) means
//      clients never over-burst via sub-second arithmetic.
//   3. If tokens >= 1: consume one, return { waitMs: 0 }.
//      Else: return { waitMs: msPerToken }, rounded UP so `sleep(waitMs)`
//      always crosses the refill threshold.
//
// No Redis CAS on purpose — when the caller races itself inside a single
// node, in-memory atomicity of JS.parse → refill → consume is sufficient;
// across nodes the worst case is one extra token (documented).

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
   * TTL (seconds) on the Redis key. Defaults to 1 hour — an idle bucket
   * GC'd after 1h is fine (it would be full anyway).
   */
  ttlSeconds?: number;
}

export interface TokenBucket {
  /**
   * Try to consume one token. Returns `{ waitMs: 0 }` on success; otherwise
   * `{ waitMs }` — caller is expected to `sleep(waitMs)` and retry.
   * Never throws; underlying store errors surface as `{ waitMs: 1000 }`
   * (conservative back-off).
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

      const msPerToken = Math.ceil(1000 / opts.refillPerSecond);
      await writeState(opts.store, key, state, ttlSeconds);
      return { waitMs: msPerToken };
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
    // Swallow — best-effort persistence. A dropped write means the next
    // call sees the prior state (or a default-full bucket) — safer than
    // crashing the sync pipeline.
  }
}

/**
 * Convenience: build a `TokenBucketStore` from a node-redis v4 client.
 * Keys are the bucket key verbatim (callers are expected to pass
 * `rl:<installation_id>`).
 */
// biome-ignore lint/suspicious/noExplicitAny: node-redis types vary by version
export function redisTokenBucketStore(redis: any): TokenBucketStore {
  return {
    async get(key: string): Promise<string | null> {
      return (await redis.get(key)) ?? null;
    },
    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      if (ttlSeconds && ttlSeconds > 0) {
        await redis.set(key, value, { EX: ttlSeconds });
      } else {
        await redis.set(key, value);
      }
    },
  };
}

/**
 * The PRD §11.2 / D59 canonical key: one token bucket per GitHub
 * installation, regardless of caller (sync, redeliver, reconcile).
 */
export function installationBucketKey(installationId: string | bigint): string {
  return `rl:${String(installationId)}`;
}
