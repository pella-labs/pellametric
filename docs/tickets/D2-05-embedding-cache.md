# D2-05 Primer: Embedding cache (Redis L1 + Postgres L2)

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** `contracts/05-embed-provider.md` §Cache · **Blocked by:** D2-01 (provider interface), D1-05 (`embedding_cache` PG table)

## Goal

Wrap `packages/embed` resolvers with a 2-layer cache: Redis LRU (hot path, ~100k entries, 7-day TTL) + Postgres `embedding_cache` (persistent, survives Redis flush). Target ~80% hit rate on real coding prompts.

## Deliverables

- [ ] `packages/embed/src/cache.ts` — `EmbedCache` interface per contract 05 §Cache: `get(key) → EmbedResult | null`, `set(key, result, ttlSeconds?)`.
- [ ] `packages/embed/src/cacheKey.ts` — `sha256(text + provider.id + provider.model + provider.dim)`. Prevents stale-dim bugs on provider swap.
- [ ] `packages/embed/src/redisCache.ts` — L1 implementation, uses `ioredis`. Default TTL 7d.
- [ ] `packages/embed/src/pgCache.ts` — L2 implementation, reads/writes `embedding_cache` via Drizzle. UPSERT pattern on `cache_key` PK; bumps `hit_count` + `last_hit_at`.
- [ ] `packages/embed/src/embedCached.ts` — wrapper that wraps a raw `EmbedProvider`: read L1 → L2 → live call → populate both caches.
- [ ] `packages/embed/src/cost.ts` — per-org budget guard: `EMBEDDING_BUDGET_USD_PER_DAY` (default $20 managed cloud). Hard-stop returns cached-only when exceeded.
- [ ] `__tests__/cache.test.ts` — L1 hit, L2 hit, live call, dim guard, budget trigger.

## Invariants

- Cache key includes `provider.id + model + dim` (contract 05 invariant 3).
- L1 hit → no L2 read. L1 miss → L2 read → on hit, populate L1 + bump L2 counters. L2 miss → live call → populate both.
- `cached: boolean` in `EmbedResult` reflects whether any layer hit.
- Weekly vacuum: drop L2 rows with `last_hit_at < now() - 90d`.
- Per-org cost guard: respects `policies.org_id` override.

## Tests

- L1 hit: no postgres connection opened.
- L2 hit repopulates L1.
- Dim mismatch key (provider swap): forces re-embed.
- Budget exceeded: 429 response; no live call attempted.
- Property test: `embedCached(text).vector === embedProvider(text).vector` for identical input.

## Branch / PR

```bash
git switch -c D2-05-embedding-cache-jorge
# depends on D2-01 merged and D1-05 merged
git push -u origin D2-05-embedding-cache-jorge
gh pr create --base main --title "feat(embed): Redis L1 + Postgres L2 cache + cost guard (D2-05)"
```

## Time estimate

~4–5 h.

## After this ticket

- D2-06 nightly cluster uses this wrapper (avoids re-embedding stable prompts).
- D2-07 Twin Finder reads the same cache.
