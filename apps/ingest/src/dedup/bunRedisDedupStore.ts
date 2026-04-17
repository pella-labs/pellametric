// Bun-native Redis DedupStore (Sprint-1 follow-up A, PRD §Phase 3, D14).
//
// Real runtime adapter wired on boot when NODE_ENV !== "test". Uses the
// Bun.redis feature shipped in Bun 1.2.9+. We target Bun 1.3.12.
//
// API shape note (verified at runtime on Bun 1.3.12):
//   - `new Bun.RedisClient(url)` constructor is present (function).
//   - `Bun.redis` is a pre-constructed default instance (object) with the
//     same method surface; has `.connect()`, `.send(cmd, argv)`, and a
//     concrete `.set(key, value)` that takes only two args (no third options
//     arg). So for SET with NX PX we MUST use the generic `.send()`.
//
// Chosen path: always construct a dedicated `Bun.RedisClient(url)` per store
// (so we get an isolated connection with our configured URL) and use `.send`
// for any command that takes option flags. We keep a soft feature gate: if
// `typeof Bun.redis === "undefined"` at first use, we throw a structured
// BUN_REDIS_UNAVAILABLE error so ops see "upgrade Bun" not "undefined.send".
//
// The server's 503 ECONNREFUSED wrapping in server.ts keys on the wrapped
// error messages we throw here.

import type { DedupStore } from "./checkDedup";

export interface BunRedisDedupStoreOptions {
  url?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: Bun global typed loosely across versions
type BunGlobal = any;

const BUN_REDIS_UNAVAILABLE = "BUN_REDIS_UNAVAILABLE";

function assertBunRedis(): void {
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (!bun || typeof bun.redis === "undefined") {
    // Structured message — boot logger picks up {code, bun_version}.
    const bunVersion = bun?.version ?? "unknown";
    const err = new Error(
      `${BUN_REDIS_UNAVAILABLE}: Bun.redis not available on this runtime (bun_version=${bunVersion}). Upgrade to Bun >= 1.2.9 (we target >=1.3.4).`,
    );
    (err as Error & { code?: string }).code = BUN_REDIS_UNAVAILABLE;
    throw err;
  }
}

function wrapConnectivity(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  // Preserve well-known connectivity codes so server.ts can map to 503.
  if (/ECONNREFUSED/i.test(msg)) {
    const e = new Error(`redis:ECONNREFUSED ${msg}`);
    (e as Error & { code?: string }).code = "ECONNREFUSED";
    return e;
  }
  if (/ECONNRESET/i.test(msg)) {
    const e = new Error(`redis:ECONNRESET ${msg}`);
    (e as Error & { code?: string }).code = "ECONNRESET";
    return e;
  }
  return err instanceof Error ? err : new Error(msg);
}

/**
 * Build a Bun-native Redis DedupStore. The returned store lazy-connects on
 * first command; all commands are routed through `.send()` so we can pass
 * option flags (SET ... NX PX <ms>) without relying on per-method overloads
 * that vary across Bun patch releases.
 *
 * If Bun.redis is absent at first call, throws BUN_REDIS_UNAVAILABLE.
 */
export function createBunRedisDedupStore(opts: BunRedisDedupStoreOptions = {}): DedupStore {
  const url = opts.url ?? process.env.REDIS_URL ?? "redis://localhost:6379";

  // biome-ignore lint/suspicious/noExplicitAny: Bun.RedisClient type not in @types/bun for all versions
  let client: any | null = null;

  // biome-ignore lint/suspicious/noExplicitAny: Bun.RedisClient type not in @types/bun for all versions
  async function getClient(): Promise<any> {
    if (client) return client;
    assertBunRedis();
    const bun = (globalThis as { Bun?: BunGlobal }).Bun;
    try {
      // Bun 1.3.x: `new Bun.RedisClient(url)` returns an instance whose
      // commands lazily connect. `.connect()` forces the handshake now so
      // configMaxMemoryPolicy() on /readyz fails fast.
      client = new bun.RedisClient(url);
      if (typeof client.connect === "function") {
        await client.connect();
      }
      return client;
    } catch (err) {
      throw wrapConnectivity(err);
    }
  }

  return {
    async setnx(key: string, ttlMs: number): Promise<boolean> {
      const c = await getClient();
      let reply: unknown;
      try {
        // SET key value NX PX <ttlMs>
        // Bun.redis .send() takes (command, args-array). Returns "OK" on set,
        // null on NX-fail (key exists). Value is "1" (dedup marker; presence
        // is what matters — we never GET it).
        reply = await c.send("SET", [key, "1", "NX", "PX", String(ttlMs)]);
      } catch (err) {
        throw wrapConnectivity(err);
      }
      // "OK" → first sight; null/"" → duplicate.
      if (typeof reply === "string" && reply.toUpperCase() === "OK") {
        return true;
      }
      return false;
    },

    async configMaxMemoryPolicy(): Promise<string> {
      const c = await getClient();
      let reply: unknown;
      try {
        // CONFIG GET maxmemory-policy → array reply ["maxmemory-policy", "<value>"]
        // Bun redis returns an array; we pick index 1.
        reply = await c.send("CONFIG", ["GET", "maxmemory-policy"]);
      } catch (err) {
        throw wrapConnectivity(err);
      }
      if (Array.isArray(reply) && reply.length >= 2 && typeof reply[1] === "string") {
        return reply[1] as string;
      }
      // Some Redis modules (e.g. KeyDB) return a map-like object.
      if (reply && typeof reply === "object") {
        const val = (reply as Record<string, unknown>)["maxmemory-policy"];
        if (typeof val === "string") return val;
      }
      // Unknown shape — surface as empty string so /readyz fails closed
      // (InMemoryDedupStore returns "noeviction" on the happy path).
      return "";
    },
  };
}
