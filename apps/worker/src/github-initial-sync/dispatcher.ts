// Cron-driven dispatcher: scan `github_sync_progress` for queued rows,
// hand each to `runInitialSync` under the shared 5-slot semaphore.
//
// Called from `apps/worker/src/index.ts` via PgBoss cron. Per-event work
// happens inside `runInitialSync`, not here — this file is the scheduler.

import type { Sql } from "postgres";
import { runInitialSync } from "./initialSync";
import type { LocalSemaphore } from "./semaphore";
import type { TokenBucket } from "./tokenBucket";

export interface DispatcherDeps {
  sql: Sql;
  semaphore: LocalSemaphore;
  tokenBucket: TokenBucket;
  getInstallationToken: (installationId: bigint) => Promise<string>;
  emitRecompute: Parameters<typeof runInitialSync>[0]["emitRecompute"];
  /** Max syncs to pick up in a single dispatcher tick. Bounded by the
   *  semaphore anyway; this is a secondary cap to avoid dog-piling DB. */
  maxPerTick?: number;
  /** Optional structured logger. */
  log?: (entry: Record<string, unknown>) => void;
}

export interface DispatcherTickReport {
  picked: number;
  completed: number;
  failed: number;
}

/** Pick queued sync rows and run them. Returns a summary for observability. */
export async function dispatcherTick(deps: DispatcherDeps): Promise<DispatcherTickReport> {
  const maxPerTick = deps.maxPerTick ?? 5;
  const log = deps.log ?? ((_entry) => {});

  const candidates = (await deps.sql.unsafe(
    `SELECT tenant_id::text AS tenant_id, installation_id::text AS installation_id
       FROM github_sync_progress
      WHERE status = 'queued'
      ORDER BY last_progress_at ASC
      LIMIT $1`,
    [maxPerTick],
  )) as unknown as Array<{ tenant_id: string; installation_id: string }>;

  if (candidates.length === 0) return { picked: 0, completed: 0, failed: 0 };

  log({
    level: "info",
    module: "github-initial-sync.dispatcher",
    msg: "dispatching queued syncs",
    count: candidates.length,
  });

  const results = await Promise.all(
    candidates.map((row) =>
      runInitialSync({
        sql: deps.sql,
        tenantId: row.tenant_id,
        installationId: BigInt(row.installation_id),
        getInstallationToken: deps.getInstallationToken,
        semaphore: deps.semaphore,
        tokenBucket: deps.tokenBucket,
        emitRecompute: deps.emitRecompute,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log({
          level: "error",
          module: "github-initial-sync.dispatcher",
          msg: "runInitialSync threw",
          err: msg,
          tenant_id: row.tenant_id,
          installation_id: row.installation_id,
        });
        return {
          status: "failed" as const,
          tenantId: row.tenant_id,
          installationId: BigInt(row.installation_id),
          reposUpserted: 0,
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
  return { picked: candidates.length, completed, failed };
}
