// Sprint 1 ingest-key verifier. Replaces the prefix-only Sprint-0 stub.
//
// Bearer format (new): bm_<orgId>_<keyId>_<secret>   (3 segments after bm_)
// Bearer format (legacy, 2-segment): bm_<orgId>_<secret>   (kept for compat; store
// must implement a catch-all lookup — used by dev-mode only).
//
// Verification:
//   1. Parse bearer; extract orgId, keyId, secret.
//   2. Look up ingest_keys row by (orgId, keyId). Miss → null.
//   3. If row.revoked_at set → null.
//   4. createHash("sha256").update(secret) → 32-byte buffer.
//   5. Length-guard, then timingSafeEqual against stored key_sha256 (hex).
//   6. Cache (rawBearer → row) in LRU for 60s (default).
//
// D-S1-1: ingest-key auth is NOT Better Auth; raw sha256 + PG + 60s LRU.

import { createHash, timingSafeEqual } from "node:crypto";

export type Tier = "A" | "B" | "C";

export interface IngestKeyRow {
  id: string;
  org_id: string;
  engineer_id: string | null;
  key_sha256: string; // hex-encoded
  tier_default: Tier;
  revoked_at?: Date | string | null;
}

export interface IngestKeyStore {
  get(orgId: string, keyId: string): Promise<IngestKeyRow | null>;
}

export interface AuthContext {
  tenantId: string;
  engineerId: string;
  tier: Tier;
  keyId: string;
}

// ------------------------------------------------------------ LRU

interface LRUOpts {
  max?: number;
  ttlMs?: number;
  clock?: () => number;
}

interface LRUEntry<V> {
  value: V;
  expiresAt: number;
}

// Minimal LRU + TTL cache. No external dep (lru-cache not installed on Bun 1.0.7).
// Eviction: on set over capacity, drop the least-recently-used (first in Map).
// TTL: enforced on read — expired entries return null and are deleted.
export class LRUCache<K = string, V = unknown> {
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly store: Map<K, LRUEntry<V>>;

  constructor(opts: LRUOpts = {}) {
    this.max = opts.max ?? 1000;
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.clock = opts.clock ?? (() => Date.now());
    this.store = new Map();
  }

  get(key: K): V | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.clock() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    // refresh recency — delete + reinsert moves to tail
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.max) {
      // evict LRU (oldest = first key in insertion order)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, {
      value,
      expiresAt: this.clock() + this.ttlMs,
    });
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ------------------------------------------------------------ parse

interface ParsedBearer {
  raw: string;
  orgId: string;
  keyId: string;
  secret: string;
  legacy: boolean;
}

// Accept either 3-segment (new) or 2-segment (legacy) form.
// Regex — 3-segment first; fall back to 2-segment.
const BEARER_3SEG = /^bm_([A-Za-z0-9]+)_([A-Za-z0-9]+)_([A-Za-z0-9_-]+)$/;
const BEARER_2SEG = /^bm_([A-Za-z0-9]+)_([A-Za-z0-9_-]+)$/;

export function parseBearer(header: string | null): ParsedBearer | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m?.[1]) return null;
  const raw = m[1];
  const three = raw.match(BEARER_3SEG);
  if (three?.[1] && three[2] && three[3]) {
    return {
      raw,
      orgId: three[1],
      keyId: three[2],
      secret: three[3],
      legacy: false,
    };
  }
  const two = raw.match(BEARER_2SEG);
  if (two?.[1] && two[2]) {
    return {
      raw,
      orgId: two[1],
      keyId: "*", // sentinel for catch-all lookup
      secret: two[2],
      legacy: true,
    };
  }
  return null;
}

// ------------------------------------------------------------ verify

export async function verifyBearer(
  header: string | null,
  store?: IngestKeyStore,
  cache?: LRUCache<string, IngestKeyRow> | LRUCache,
): Promise<AuthContext | null> {
  const parsed = parseBearer(header);
  if (!parsed) return null;
  // Safe default: no store configured = hard fail.
  if (!store) return null;

  // L4 fix: never key the cache on the raw bearer secret. If any future
  // debug surface dumped the cache, the raw secrets would leak. Key on
  // sha256(raw) hex — same lookup-cost O(1), zero secret exposure if the
  // map is ever introspected. `parsed.raw` is ONLY used for hashing here.
  const cacheKey = createHash("sha256").update(parsed.raw).digest("hex");
  const cached = (cache?.get(cacheKey) as IngestKeyRow | null | undefined) ?? null;
  const row = cached ?? (await store.get(parsed.orgId, parsed.keyId));
  if (!row) return null;
  if (row.revoked_at) return null;

  // Hash presented secret.
  const presentedHash = createHash("sha256").update(parsed.secret).digest();
  let stored: Buffer;
  try {
    stored = Buffer.from(row.key_sha256, "hex");
  } catch {
    return null;
  }
  if (presentedHash.length !== stored.length) return null;
  if (!timingSafeEqual(presentedHash, stored)) return null;

  if (!cached && cache) cache.set(cacheKey, row);

  return {
    tenantId: row.org_id,
    engineerId: row.engineer_id ?? row.org_id,
    tier: row.tier_default,
    keyId: row.id,
  };
}
