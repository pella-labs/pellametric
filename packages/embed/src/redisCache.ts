import type { CachedEntry, EmbedCache } from "./cache";

/**
 * L1 Redis cache. Accepts any client matching a minimal interface —
 * ioredis, node-redis, and Bun's built-in Redis client all satisfy.
 * Serializes CachedEntry as JSON. Default TTL = 7 days per contract 05.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** setex(key, ttlSeconds, value) */
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export class RedisEmbedCache implements EmbedCache {
  constructor(
    private readonly client: RedisLike,
    private readonly prefix = "embed:",
    private readonly defaultTtlSeconds = DEFAULT_TTL_SECONDS,
  ) {}

  async get(key: string): Promise<CachedEntry | null> {
    const raw = await this.client.get(this.prefix + key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedEntry;
    } catch {
      return null; // corrupt; treat as miss
    }
  }

  async set(key: string, entry: CachedEntry, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const payload = JSON.stringify(entry);
    await this.client.setex(this.prefix + key, ttl, payload);
  }
}
