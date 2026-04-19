import "server-only";
import type { Ctx, RecomputeEmitter, RecomputeScopedEmitter } from "@bematist/api";
import type { RedisClientType } from "redis";
import { createClient as createRedisClient } from "redis";

/**
 * Production wiring for the `session_repo_recompute:{tenant_id}` emitter
 * consumed by the G1-linker (PRD D56). Reuses node-redis directly — the
 * `Ctx.db.redis` surface is an idempotency primitive and does not expose
 * XADD.
 *
 * Deliberately not globalThis-cached: a stale client on Fast Refresh in dev
 * just opens a new TCP connection — cheaper than hand-rolling reconnect
 * semantics inside this module. The ingest server's shared node-redis
 * handle is the place to optimize if this ever hotspots.
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
let shared: RedisClientType | null = null;

async function getRedis(): Promise<RedisClientType> {
  if (!shared) {
    const client = createRedisClient({ url: REDIS_URL }) as RedisClientType;
    client.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ level: "error", module: "web/github/recompute", msg }));
    });
    shared = client;
  }
  if (!shared.isOpen) {
    await shared.connect();
  }
  return shared;
}

/**
 * Tracking-mode flipped → one recompute event per live session in the tenant.
 * For the G1 wire-up we emit a SINGLE broadcast message with
 * `reason=tracking_mode_flipped` + NO specific session_id — the linker's
 * coalescer inspects the tenant's session-index and does the fan-out. This
 * matches what G1-initial-sync already does for new-repo events.
 *
 * Returns the number of XADD calls made (1 per broadcast). The "sessions
 * queued" count the mutation returns is what the linker's coalescer will
 * eventually process — we report 1 here as the queued-message count.
 */
export async function getGithubRecomputeEmitter(_ctx: Ctx): Promise<RecomputeEmitter> {
  return {
    async emitTrackingModeFlipped(args) {
      const redis = await getRedis();
      const stream = `session_repo_recompute:${args.tenant_id}`;
      // biome-ignore lint/suspicious/noExplicitAny: node-redis types are tight here
      await (redis as any).xAdd(stream, "*", {
        tenant_id: args.tenant_id,
        reason: "tracking_mode_flipped",
        new_mode: args.newMode,
        at: String(Date.now()),
      });
      return 1;
    },
  };
}

/**
 * Per-repo tracking flipped → scoped recompute. In G1/G2 we emit a single
 * per-repo broadcast; the linker's coalescer walks its session-index for
 * the tenant and recomputes only sessions whose link-set intersects the
 * given `provider_repo_id`. This is an explicit TODO(g3) shape: the v1
 * message contains provider_repo_id + reason; the linker's `provider_repo_id
 * → sessions` projection runs inside the consumer (already wired in PR #88
 * for new-repo events — same code path).
 */
export async function getGithubRepoRecomputeEmitter(_ctx: Ctx): Promise<RecomputeScopedEmitter> {
  return {
    async emitRepoTrackingFlipped(args) {
      const redis = await getRedis();
      const stream = `session_repo_recompute:${args.tenant_id}`;
      // biome-ignore lint/suspicious/noExplicitAny: node-redis types are tight here
      await (redis as any).xAdd(stream, "*", {
        tenant_id: args.tenant_id,
        provider_repo_id: args.provider_repo_id,
        reason: "tracking_state_flipped",
        new_state: args.nextState,
        at: String(Date.now()),
      });
      return 1;
    },
  };
}
