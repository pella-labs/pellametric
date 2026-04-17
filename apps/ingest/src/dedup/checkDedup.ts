// Redis SETNX dedup (Sprint-1 Phase-3, PRD §Phase 3, D14).
//
// Authoritative idempotency gate. Runs per-event AFTER enforceTier + zod
// validate and BEFORE the event is counted "accepted". Duplicates return
// firstSight=false and are counted into the `deduped` response field
// (contract 02 §Response codes). They are NOT errors — repeated
// `client_event_id` always returns 202 per the spec.
//
// Real Redis wrapper lands when Bun 1.2.9+ exposes `Bun.redis` or when the
// team pulls in `@redis/client`. Until then, tests and dev use
// `InMemoryDedupStore`. The interface below is the ONLY contract the server
// depends on — the real client is a thin lazy-loaded wrapper slotted in at
// boot via `setDeps({ dedupStore: ... })`.
//
// Key shape `dedup:{${tenantId}}:${sessionId}:${eventSeq}` uses Redis Cluster
// hash-tag braces so all dedup keys for a tenant land on the same slot.
// See PRD §Phase 3 "Hash-tag key format asserted".

/**
 * Dedup store contract. `setnx` returns true on FIRST insert, false if the
 * key already existed (duplicate). `configMaxMemoryPolicy` returns the
 * `maxmemory-policy` config string for `/readyz` preflight — must be
 * `"noeviction"` in prod (other policies can evict dedup keys and cause
 * duplicate accepts).
 */
export interface DedupStore {
  setnx(key: string, ttlMs: number): Promise<boolean>;
  configMaxMemoryPolicy(): Promise<string>;
}

export type DedupKeyInput = {
  tenantId: string;
  sessionId: string;
  eventSeq: number | string;
};

// Tenant IDs are server-derived; keep them conservative (alnum + _-).
const SAFE_TENANT = /^[A-Za-z0-9_-]+$/;
// Session IDs come from collectors and routinely contain `.` / `:` / `/`
// (ISO timestamps, hierarchical paths). H3 fix: reject ONLY the characters
// that would break Redis Cluster hash-tag routing (`{`, `}`), whitespace,
// and ASCII control chars. Anything else is a valid sessionId.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejecting control chars in session IDs
const UNSAFE_SESSION = /[\x00-\x1f\s{}]/;

/**
 * Build the dedup key. Format:
 *   dedup:{<tenantId>}:<sessionId>:<eventSeq>
 *
 * The braces are a Redis Cluster hash tag — they pin all keys for a tenant
 * to one slot so SETNX and future pipeline ops stay on the same shard.
 *
 * Inputs validated as follows:
 *   - tenantId: `[A-Za-z0-9_-]+` (server-derived).
 *   - sessionId: any non-empty string without control chars, whitespace, or
 *     `{`/`}` (the hash-tag delimiters). Real-world session IDs contain
 *     dots and colons; those are fine.
 *   - eventSeq: non-negative integer (number or numeric string).
 *
 * Throws `Error("dedup:bad-input")` on violation. The server distinguishes
 * this error from Redis-unreachable and returns HTTP 400 BAD_SESSION_ID
 * instead of 503 (contract 02 semantics — this is a client-visible input
 * defect, not a backend outage).
 */
export function dedupKey(i: DedupKeyInput): string {
  if (typeof i.tenantId !== "string" || i.tenantId.length === 0 || !SAFE_TENANT.test(i.tenantId)) {
    throw new Error("dedup:bad-input");
  }
  if (typeof i.sessionId !== "string" || i.sessionId.length === 0) {
    throw new Error("dedup:bad-input");
  }
  if (UNSAFE_SESSION.test(i.sessionId)) {
    throw new Error("dedup:bad-input");
  }
  const seqNum = typeof i.eventSeq === "string" ? Number(i.eventSeq) : i.eventSeq;
  if (
    typeof seqNum !== "number" ||
    !Number.isFinite(seqNum) ||
    !Number.isInteger(seqNum) ||
    seqNum < 0
  ) {
    throw new Error("dedup:bad-input");
  }
  return `dedup:{${i.tenantId}}:${i.sessionId}:${seqNum}`;
}

/**
 * Check-and-set dedup. Returns firstSight=true on first sighting, false on
 * duplicate. Always returns the computed key (helpful for logging).
 */
export async function checkDedup(
  store: DedupStore,
  input: DedupKeyInput,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<{ firstSight: boolean; key: string }> {
  const key = dedupKey(input);
  const firstSight = await store.setnx(key, ttlMs);
  return { firstSight, key };
}

// -------------------- InMemory impl (dev + test) --------------------

interface MemEntry {
  expiresAt: number;
}

export interface InMemoryDedupStoreOptions {
  /**
   * Monotonic clock (ms). Defaults to `Date.now`. Tests inject an advancing
   * clock to assert TTL semantics.
   */
  clock?: () => number;
  /**
   * Simulated `maxmemory-policy` config value. Defaults to `"noeviction"` so
   * `/readyz` passes. Tests override to `"allkeys-lru"` to assert the
   * preflight fails closed on misconfig.
   */
  policy?: string;
}

/**
 * In-memory DedupStore used by dev + test. Satisfies `/readyz` preflight by
 * returning `"noeviction"` from `configMaxMemoryPolicy` by default. Tests
 * construct with `{ policy: "allkeys-lru" }` to simulate prod misconfig.
 */
export class InMemoryDedupStore implements DedupStore {
  private readonly map = new Map<string, MemEntry>();
  private readonly clock: () => number;
  private readonly policy: string;

  constructor(opts: InMemoryDedupStoreOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.policy = opts.policy ?? "noeviction";
  }

  async setnx(key: string, ttlMs: number): Promise<boolean> {
    const now = this.clock();
    const existing = this.map.get(key);
    if (existing !== undefined && existing.expiresAt > now) {
      return false;
    }
    this.map.set(key, { expiresAt: now + ttlMs });
    return true;
  }

  async configMaxMemoryPolicy(): Promise<string> {
    return this.policy;
  }
}
