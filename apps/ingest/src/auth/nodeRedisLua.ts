// node-redis (@redis/client v4, via the `redis` umbrella package) adapters.
//
// Two exports:
//   - createSharedNodeRedisClient({ url })  — builds + connects one client,
//     which is reused by BOTH nodeRedisLua (for EVALSHA) and redisStreamsWal
//     (for XADD/XREADGROUP). Having a single connection saves sockets and
//     simplifies graceful shutdown.
//   - createNodeRedisLuaClient({ url? } | { client }) — implements LuaRedis
//     (scriptLoad/evalsha/eval) on top of a shared client.
//
// Error shape:
//   - NOSCRIPT errors are surfaced with a message starting "NOSCRIPT " so
//     the existing token-bucket fallback in rateLimit.ts matches.
//   - All other errors pass through (the caller already inspects message).

import type { LuaRedis } from "./rateLimit";

// node-redis v4's type surface is rich and version-dependent; we keep a loose
// alias for the parts we touch so we're not tied to exact generic signatures.
// biome-ignore lint/suspicious/noExplicitAny: see above
export type NodeRedisClient = any;

export interface SharedNodeRedisClientOptions {
  url?: string;
}

/**
 * Build and connect a single node-redis client. Idempotent-per-call
 * (creates a new instance each call); caller is expected to cache at boot
 * and pass the same instance to all consumers.
 */
export async function createSharedNodeRedisClient(
  opts: SharedNodeRedisClientOptions = {},
): Promise<NodeRedisClient & { quit(): Promise<void> }> {
  const url = opts.url ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  // Lazy require so module load never explodes if `redis` isn't installed
  // (it IS a dep here, but this file is imported at boot only).
  const mod = await import("redis");
  const createClient = (mod as unknown as { createClient: (o: { url: string }) => NodeRedisClient })
    .createClient;
  const client = createClient({ url });
  // node-redis emits 'error' events; we log to stderr but don't crash so
  // the background reconnect loop keeps trying. Ops see it in structured logs.
  client.on("error", (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: "error", module: "nodeRedis", msg }));
  });
  await client.connect();
  return client as NodeRedisClient & { quit(): Promise<void> };
}

export interface NodeRedisLuaClientOptions {
  url?: string;
  /**
   * When provided, reuses the given client instead of connecting a new one.
   * Pass the same client returned from `createSharedNodeRedisClient` so the
   * WAL and the rate limiter share a connection.
   */
  client?: NodeRedisClient;
}

/**
 * Wraps a node-redis client to satisfy the `LuaRedis` interface used by the
 * Sprint-1 token-bucket rate limiter. Result includes a `quit()` for
 * graceful shutdown; if the client was passed in, `quit()` is a no-op (the
 * caller owns the lifecycle).
 */
export async function createNodeRedisLuaClient(
  opts: NodeRedisLuaClientOptions = {},
): Promise<LuaRedis & { quit(): Promise<void> }> {
  const ownClient = !opts.client;
  const client: NodeRedisClient =
    opts.client ??
    (await createSharedNodeRedisClient(opts.url !== undefined ? { url: opts.url } : {}));

  function coerce3Tuple(v: unknown): [number, number, number] {
    if (!Array.isArray(v) || v.length < 3) {
      throw new Error(`redis:lua-bad-reply ${JSON.stringify(v)}`);
    }
    return [Number(v[0]), Number(v[1]), Number(v[2])];
  }

  function normalizeError(err: unknown): Error {
    const msg = err instanceof Error ? err.message : String(err);
    // node-redis surfaces NOSCRIPT as a plain Error with "NOSCRIPT No matching script"
    // message — keep the prefix so rateLimit.ts fallback sees it verbatim.
    if (msg.startsWith("NOSCRIPT")) return new Error(msg);
    if (/NOSCRIPT/i.test(msg)) return new Error(`NOSCRIPT ${msg}`);
    return err instanceof Error ? err : new Error(msg);
  }

  return {
    async scriptLoad(src: string): Promise<string> {
      try {
        return (await client.scriptLoad(src)) as string;
      } catch (err) {
        throw normalizeError(err);
      }
    },
    async evalsha(
      sha: string,
      keys: (string | number)[],
      args: (string | number)[],
    ): Promise<[number, number, number]> {
      try {
        const reply = await client.evalSha(sha, {
          keys: keys.map(String),
          arguments: args.map(String),
        });
        return coerce3Tuple(reply);
      } catch (err) {
        throw normalizeError(err);
      }
    },
    async eval(
      src: string,
      keys: (string | number)[],
      args: (string | number)[],
    ): Promise<[number, number, number]> {
      try {
        const reply = await client.eval(src, {
          keys: keys.map(String),
          arguments: args.map(String),
        });
        return coerce3Tuple(reply);
      } catch (err) {
        throw normalizeError(err);
      }
    },
    async quit(): Promise<void> {
      if (!ownClient) return; // caller owns the client lifecycle
      try {
        await client.quit();
      } catch {
        // best-effort
      }
    },
  };
}
