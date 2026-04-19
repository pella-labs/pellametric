// Public entrypoint for the github-initial-sync package.
//
// Wiring (production):
//   1. PgBoss cron `github.initial_sync_tick` fires every 30s (crons-only
//      rule; per-tenant work is not the cron — it's the body).
//   2. The handler picks up up-to-5 `'queued'` rows from
//      `github_sync_progress` (ordered by `last_progress_at ASC`), bounded
//      by the local semaphore so we never kick off more than 5 concurrent
//      tenant syncs.
//   3. For each picked row, flip to `'running'` (the `runInitialSync` fn
//      does this idempotently via UPSERT) and invoke the paginator.
//   4. Release the semaphore slot on completion / failure.
//
// The PgBoss scheduler IS used here because the dispatcher is a CRON — not
// per-event work (CLAUDE.md rule #4 compliant). Per-event work happens
// inside the paginator and writes Redis Streams / PG rows directly.

export {
  type InitialSyncInput,
  type InitialSyncReport,
  runInitialSync,
} from "./initialSync";
export {
  createNoopRecomputeEmitter,
  createRecomputeEmitter,
  type RecomputeMessage,
  type RecomputeRedis,
} from "./recomputeEmitter";
export { createLocalSemaphore, type LocalSemaphore } from "./semaphore";
export { createTokenBucket, type TokenBucket, type TokenBucketStore } from "./tokenBucket";
