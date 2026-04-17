import type { EmbedResult, ProviderId } from "./types";

/** Shape of what lives in the cache — same as EmbedResult but with the
 *  vector serialized as plain number[] for storage portability. */
export interface CachedEntry {
  vector: number[];
  provider: ProviderId;
  model: string;
  dim: number;
}

export interface EmbedCache {
  /** Returns the cached entry or null on miss. Must be fast (<5ms for L1). */
  get(key: string): Promise<CachedEntry | null>;
  /** Writes the entry. TTL optional (seconds); absent = no expiry. */
  set(key: string, entry: CachedEntry, ttlSeconds?: number): Promise<void>;
}

/** In-memory cache — default for tests and Xenova single-process usage. */
export class InMemoryEmbedCache implements EmbedCache {
  private readonly store = new Map<string, { entry: CachedEntry; expiresAt: number | null }>();

  async get(key: string): Promise<CachedEntry | null> {
    const rec = this.store.get(key);
    if (!rec) return null;
    if (rec.expiresAt !== null && rec.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return rec.entry;
  }

  async set(key: string, entry: CachedEntry, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000;
    this.store.set(key, { entry, expiresAt });
  }

  /** Debug helper — not part of the EmbedCache interface. */
  size(): number {
    return this.store.size;
  }
}

/** Turn an EmbedResult into a CachedEntry (strip vector to plain array). */
export function toCached(result: EmbedResult): CachedEntry {
  return {
    vector: Array.from(result.vector),
    provider: result.provider,
    model: result.model,
    dim: result.dim,
  };
}

/** Hydrate a CachedEntry back into an EmbedResult marking cached:true. */
export function fromCached(entry: CachedEntry): EmbedResult {
  return {
    vector: Float32Array.from(entry.vector),
    provider: entry.provider,
    model: entry.model,
    dim: entry.dim,
    cached: true,
    latency_ms: 0,
  };
}
