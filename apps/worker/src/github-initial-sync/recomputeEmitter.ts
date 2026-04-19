// PRD D56 — per-tenant Redis Stream `session_repo_recompute:<tenant_id>`.
// G1-linker consumes. The initial-sync worker (here) produces events when a
// new repo is UPSERTed OR when the tenant's tracking_mode / a repo's
// tracking_state flips (invoked from the admin tracking-mode PATCH in
// G2-admin-apis; the producer lives here so both callers share it).
//
// D57: payload is hashes + counts only — NEVER raw repo full_name, titles,
// commits, messages. Here the `provider_repo_id` is the opaque GitHub
// numeric id, which is NOT identifying content on its own (see §9.2 —
// `title_hash` IS the identifying content; `provider_repo_id` is an
// enumeration value we store in a varchar column already).

export interface RecomputeRedis {
  xadd(stream: string, fields: Record<string, string>): Promise<string>;
}

export interface RecomputeMessage {
  tenantId: string;
  providerRepoId: string;
  reason: "initial_sync_new_repo" | "tracking_mode_flipped" | "tracking_state_flipped";
  at: number;
}

export function createRecomputeEmitter(redis: RecomputeRedis) {
  return async (msg: RecomputeMessage) => {
    const stream = `session_repo_recompute:${msg.tenantId}`;
    await redis.xadd(stream, {
      tenant_id: msg.tenantId,
      provider_repo_id: msg.providerRepoId,
      reason: msg.reason,
      at: String(msg.at),
    });
  };
}

/** No-op emitter — useful for tests + embedded mode where Redis Streams
 *  are absent. Keeps the sync-worker signature honest. */
export function createNoopRecomputeEmitter() {
  return async (_msg: RecomputeMessage) => {};
}
