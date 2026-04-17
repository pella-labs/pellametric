import type { CachedEntry, EmbedCache } from "./cache";

/**
 * L2 Postgres cache. Uses raw SQL against the `embedding_cache` table
 * from contract 05 §Postgres. Caller injects a minimal client so this
 * module stays independent of the Drizzle schema (which lives in D1-05).
 *
 * UPSERT on `cache_key` PK; bumps `hit_count` and `last_hit_at` on hit.
 */
export interface PgLike {
  query<T = unknown>(sql: string, params: unknown[]): Promise<{ rows: T[] }>;
}

interface Row {
  provider: string;
  model: string;
  dim: number;
  vector: number[];
}

export class PgEmbedCache implements EmbedCache {
  constructor(private readonly pg: PgLike) {}

  async get(key: string): Promise<CachedEntry | null> {
    const res = await this.pg.query<Row>(
      `UPDATE embedding_cache
          SET hit_count = hit_count + 1, last_hit_at = now()
        WHERE cache_key = $1
        RETURNING provider, model, dim, vector`,
      [key],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      vector: row.vector,
      provider: row.provider as CachedEntry["provider"],
      model: row.model,
      dim: row.dim,
    };
  }

  async set(key: string, entry: CachedEntry, _ttlSeconds?: number): Promise<void> {
    // L2 has no TTL — vacuum worker drops entries with last_hit_at < now()-90d.
    await this.pg.query(
      `INSERT INTO embedding_cache (cache_key, provider, model, dim, vector, last_hit_at, hit_count)
       VALUES ($1, $2, $3, $4, $5::real[], now(), 0)
       ON CONFLICT (cache_key) DO UPDATE
         SET last_hit_at = now()`,
      [key, entry.provider, entry.model, entry.dim, entry.vector],
    );
  }
}
