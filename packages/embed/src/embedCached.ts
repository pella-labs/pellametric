import { type EmbedCache, fromCached, toCached } from "./cache";
import { cacheKey } from "./cacheKey";
import { BudgetExceededError, type CostGuard } from "./cost";
import type { EmbedProvider, EmbedRequest, EmbedResult } from "./types";

/**
 * Wrap an EmbedProvider with 2-layer caching (contract 05 §Cache).
 *   L1 hit → return immediately, no L2 touch.
 *   L1 miss → L2 read → on hit, populate L1 + return (cached=true).
 *   L1+L2 miss → live call → populate BOTH layers (live).
 */
export interface EmbedCachedOpts {
  provider: EmbedProvider;
  l1: EmbedCache;
  l2?: EmbedCache;
  /** Soft/hard budget guard. If set, every live call's estimated cost is
   *  registered here BEFORE the call — throws BudgetExceededError on overflow
   *  so the caller can fall back to cached-only mode. */
  costGuard?: CostGuard;
  /** Org id for cost accounting. Required when `costGuard` is set. */
  orgId?: string;
}

function estimateCostUsd(req: EmbedRequest, provider: EmbedProvider): number {
  if (!provider.costPerMillionTokens) return 0;
  // Rough estimate: 1 token ≈ 4 chars. Good enough for budget guard.
  const tokens = Math.max(1, Math.ceil(req.text.length / 4));
  return (tokens * provider.costPerMillionTokens) / 1_000_000;
}

export async function embedCached(req: EmbedRequest, opts: EmbedCachedOpts): Promise<EmbedResult> {
  const key = cacheKey(req.text, opts.provider);

  // L1
  const l1hit = await opts.l1.get(key);
  if (l1hit) return fromCached(l1hit);

  // L2
  if (opts.l2) {
    const l2hit = await opts.l2.get(key);
    if (l2hit) {
      await opts.l1.set(key, l2hit);
      return fromCached(l2hit);
    }
  }

  // Budget guard before live call
  if (opts.costGuard) {
    if (!opts.orgId) {
      throw new Error("embedCached: costGuard requires orgId");
    }
    const estimated = estimateCostUsd(req, opts.provider);
    opts.costGuard.register(opts.orgId, estimated);
  }

  // Live
  const live = await opts.provider.embed(req);
  const payload = toCached(live);
  await opts.l1.set(key, payload);
  if (opts.l2) await opts.l2.set(key, payload);
  return live;
}

export { BudgetExceededError };
