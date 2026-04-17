# D2-06 Primer: Nightly cluster recompute (OpenAI Batch API)

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** `contracts/05-embed-provider.md` §Batch + CLAUDE.md "AI Rules" · **Blocked by:** D2-01, D2-05, D1-02 (cluster_assignment_mv table), D1-05 (prompt_clusters PG table)

## Goal

Nightly cron that re-clusters prompt embeddings via HDBSCAN (or mini-batch k-means as v1). Uses OpenAI Batch API for 50% discount when provider is `openai`. Writes centroids to `prompt_clusters` (PG) and per-session assignments to `cluster_assignment_mv` (CH).

## Deliverables

- [ ] `apps/worker/src/jobs/cluster/embed_batch.ts` — Batch-API job submitter. Collects new `PromptRecord.abstract` strings from last 24h, submits to `/batches`, polls every 10 min for completion (up to 24h window).
- [ ] `apps/worker/src/jobs/cluster/recluster.ts` — runs mini-batch k-means on the fresh embeddings (v1 algorithm; HDBSCAN upgrade in `_v2`). Number of clusters adapts to volume.
- [ ] `apps/worker/src/jobs/cluster/write.ts` — persists `prompt_clusters.centroid` (PG) + per-session rows into `cluster_assignment_mv` (CH).
- [ ] `apps/worker/src/jobs/cluster/label.ts` — delegates 3–5 word labels to the gateway labeler (D2-08). Stores in `prompt_clusters.label`.
- [ ] Cron registered nightly at 02:00 UTC in `apps/worker/src/index.ts`.
- [ ] `__tests__/recluster.test.ts` — fixture: 200 synthetic embeddings → assertable cluster count and centroid positions.

## Invariants

- Batch API for `openai` provider — 50% discount per CLAUDE.md Tech Stack.
- Other providers fall back to `embedBatch()` chunked at `provider.maxBatch`.
- Re-cluster does NOT modify old `cluster_assignment_mv` rows — ReplacingMergeTree(ts) handles versioning (D1-02 §4.5).
- k-anonymity: clusters with fewer than 3 contributing engineers are NOT surfaced at API layer. MV always computes; API gates per CLAUDE.md §6.4.
- Deterministic seed → deterministic output under tests.

## Tests

- Mini-batch k-means convergence on synthetic 4-cluster Gaussian mixture.
- Batch API stub: simulate 24h poll → success with fake output file.
- Empty input: no-op.
- Idempotency: running twice on same input produces identical centroids (same seed).

## Branch / PR

```bash
git switch -c D2-06-nightly-cluster-jorge
# after D2-01, D2-05, D1-02, D1-05 all merged
git push -u origin D2-06-nightly-cluster-jorge
gh pr create --base main --title "feat(worker): nightly cluster recompute via OpenAI Batch API (D2-06)"
```

## Time estimate

~8–10 h including k-means from scratch (or use a tiny dep like `ml-kmeans`).

## After this ticket

- D2-07 Twin Finder uses the centroids for live "similar workflow" lookup.
- D2-08 labels get written to `prompt_clusters.label`.
- `prompt_cluster_stats` MV (D1-02) lights up automatically via the `cluster_assignment_mv` trigger.
