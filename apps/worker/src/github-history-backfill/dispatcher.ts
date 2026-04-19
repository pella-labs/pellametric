// Dispatcher — picks up installations with queued 90-day history backfills
// and drives them through runHistoryBackfill under the shared semaphore.
//
// Two entry points:
//   1. Cron tick (dispatcherTick). Called from apps/worker/src/index.ts via
//      PgBoss cron. Scans for:
//        a. Tenants with completed initial sync but NO history progress rows
//           → auto-enqueues the window (seeds pulls+commits rows).
//        b. Tenants with queued/running history rows → runs the backfill.
//   2. Manual trigger (triggerHistoryBackfill). Called from the admin
//      Server Action when an admin clicks "Backfill last 90 days". Seeds
//      rows synchronously so the action's response reflects real state,
//      then returns. The subsequent cron tick actually drains them — same
//      pattern as the initial-sync dispatcher.

import type { Sql } from "postgres";
import type { WebhookBusProducer } from "../../../ingest/src/github-app/webhookBus";
import type { LocalSemaphore } from "../github-initial-sync/semaphore";
import type { TokenBucket } from "../github-initial-sync/tokenBucket";
import { enqueueHistoryBackfill, runHistoryBackfill } from "./backfill";

export interface HistoryDispatcherDeps {
  sql: Sql;
  semaphore: LocalSemaphore;
  tokenBucket: TokenBucket;
  getInstallationToken: (installationId: bigint) => Promise<string>;
  publish: WebhookBusProducer["publish"];
  /** Max installations to pick up in a single tick. */
  maxPerTick?: number;
  /** Window length in days. Default 90. */
  windowDays?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

export interface HistoryDispatcherTickReport {
  autoEnqueued: number;
  picked: number;
  completed: number;
  failed: number;
}

/** PgBoss cron body. One tick: auto-enqueue + drain. */
export async function dispatcherTick(
  deps: HistoryDispatcherDeps,
): Promise<HistoryDispatcherTickReport> {
  const maxPerTick = deps.maxPerTick ?? 5;
  const windowDays = deps.windowDays ?? 90;
  const log = deps.log ?? ((_entry) => {});

  // ---- Step 1. Auto-enqueue installations that finished initial sync but
  // have never had a history backfill started. We only seed rows here; the
  // drain step below actually runs them.
  const autoCandidates = (await deps.sql.unsafe(
    `SELECT gsp.tenant_id::text AS tenant_id,
            gsp.installation_id::text AS installation_id
       FROM github_sync_progress gsp
      WHERE gsp.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM github_history_sync_progress hsp
           WHERE hsp.tenant_id = gsp.tenant_id
             AND hsp.installation_id = gsp.installation_id
        )
      ORDER BY gsp.completed_at ASC
      LIMIT $1`,
    [maxPerTick],
  )) as unknown as Array<{ tenant_id: string; installation_id: string }>;

  let autoEnqueued = 0;
  for (const c of autoCandidates) {
    try {
      const r = await enqueueHistoryBackfill({
        sql: deps.sql,
        tenantId: c.tenant_id,
        installationId: BigInt(c.installation_id),
        windowDays,
        ...(deps.now ? { now: deps.now } : {}),
      });
      if (r.rowsQueued > 0) autoEnqueued += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log({
        level: "warn",
        module: "github-history-backfill.dispatcher",
        msg: "auto-enqueue failed",
        tenant_id: c.tenant_id,
        installation_id: c.installation_id,
        err: msg,
      });
    }
  }

  // ---- Step 2. Drain installations with queued/running rows. We group by
  // installation so we do ONE runHistoryBackfill call per installation (which
  // acquires one semaphore slot).
  const drainCandidates = (await deps.sql.unsafe(
    `SELECT DISTINCT tenant_id::text AS tenant_id,
            installation_id::text AS installation_id
       FROM github_history_sync_progress
      WHERE status IN ('queued','running')
      ORDER BY tenant_id, installation_id
      LIMIT $1`,
    [maxPerTick],
  )) as unknown as Array<{ tenant_id: string; installation_id: string }>;

  if (drainCandidates.length === 0) {
    return { autoEnqueued, picked: 0, completed: 0, failed: 0 };
  }

  log({
    level: "info",
    module: "github-history-backfill.dispatcher",
    msg: "draining history backfills",
    count: drainCandidates.length,
  });

  const results = await Promise.all(
    drainCandidates.map((row) =>
      runHistoryBackfill({
        sql: deps.sql,
        tenantId: row.tenant_id,
        installationId: BigInt(row.installation_id),
        getInstallationToken: deps.getInstallationToken,
        semaphore: deps.semaphore,
        tokenBucket: deps.tokenBucket,
        publish: deps.publish,
        windowDays,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log({
          level: "error",
          module: "github-history-backfill.dispatcher",
          msg: "runHistoryBackfill threw",
          err: msg,
          tenant_id: row.tenant_id,
          installation_id: row.installation_id,
        });
        return {
          status: "failed" as const,
          tenantId: row.tenant_id,
          installationId: BigInt(row.installation_id),
          reposProcessed: 0,
          prsPublished: 0,
          commitsPublished: 0,
          pagesFetched: 0,
          pausedForRateLimitMs: 0,
          retries: 0,
          error: msg,
        };
      }),
    ),
  );

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return { autoEnqueued, picked: drainCandidates.length, completed, failed };
}

/**
 * Manual trigger — admin UI calls this (via a Server Action) to seed history
 * backfill rows for the caller's installation. The dispatcher drains them.
 *
 * Idempotent: if rows already exist, ON CONFLICT resets them to `queued` and
 * clears the cursor (so the admin's click forces a fresh walk).
 */
export async function triggerHistoryBackfill(args: {
  sql: Sql;
  tenantId: string;
  installationId: bigint;
  requestedBy: string | null;
  windowDays?: number;
  now?: () => number;
}): Promise<{ reposQueued: number; rowsQueued: number; sinceTs: string }> {
  return await enqueueHistoryBackfill({
    sql: args.sql,
    tenantId: args.tenantId,
    installationId: args.installationId,
    requestedBy: args.requestedBy,
    ...(args.windowDays !== undefined ? { windowDays: args.windowDays } : {}),
    ...(args.now ? { now: args.now } : {}),
  });
}
