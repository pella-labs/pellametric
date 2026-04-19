// PRD §13 Phase G1 Step 2b — initial repo sync worker.
//
// Flow per tenant installation:
//   1. Acquire global semaphore slot (≤5 per worker node, PRD §11.2).
//   2. Write progress row status='running'.
//   3. Paginate `GET /installation/repositories?page=N&per_page=100` until
//      `Link: rel="next"` is absent.
//      a. Before each request, acquire 1 token from the per-installation
//         Redis token bucket (1 req/s floor, burst 10).
//      b. On `X-RateLimit-Remaining < 100`, pause until
//         `X-RateLimit-Reset + 5s jitter` (PRD D59).
//      c. On 429, exponential backoff `min(60s × 2^n, 900s)` ± 20% jitter,
//         max 5 retries, then mark 'failed' (DLQ).
//      d. On 403 secondary, honor `Retry-After` with 30s floor + 30% jitter.
//   4. Per page: UPSERT each repo into `repos` keyed on
//      (provider='github', provider_repo_id). Emit recompute message per
//      newly-tracked repo (only on first insert, never on update).
//   5. After each page: persist `fetched_repos`, `pages_fetched`,
//      `next_page_cursor` (= next page number) so a killed worker resumes.
//   6. On completion: status='completed', completed_at=now().
//   7. Release semaphore slot (always, even on failure).
//
// Resumability: if `github_sync_progress.next_page_cursor` is set on a
// 'queued' or 'running' row, we begin from that page.
//
// Idempotency: every UPSERT keys on (provider, provider_repo_id), so
// re-running the same sync never creates duplicate repos.

import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { LocalSemaphore } from "./semaphore";
import type { TokenBucket } from "./tokenBucket";

// ---------------------------------------------------------------------------
// Inputs

export interface InitialSyncInput {
  sql: Sql;
  tenantId: string;
  installationId: bigint;
  /** Resolver that hands back a fresh installation token. */
  getInstallationToken: (installationId: bigint) => Promise<string>;
  semaphore: LocalSemaphore;
  tokenBucket: TokenBucket;
  /** Per-request fetch — injectable for tests. */
  fetchFn?: typeof fetch;
  /** Clock — injectable for tests. */
  clock?: () => number;
  /** Sleep — injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** GitHub REST base URL; tests override with a mock. */
  apiBase?: string;
  /** Per-page repo page size. GitHub max = 100. */
  perPage?: number;
  /** Test-only: force a brief hold of the semaphore slot AFTER the sync
   *  completes so two tenants whose syncs are short still visibly contend. */
  holdSlotMs?: number;
  /** Admin user who triggered this sync (for the audit row). Null = system. */
  requestedBy?: string | null;
  /**
   * Emit a recompute message to `session_repo_recompute:<tenant_id>` for each
   * newly-tracked repo. G1-linker consumes. For unit tests we inject a no-op.
   * D57: payload is hashes + counts only.
   */
  emitRecompute: (msg: {
    tenantId: string;
    providerRepoId: string;
    reason: "initial_sync_new_repo";
    at: number;
  }) => Promise<void>;
  /**
   * Optional instrumentation sink for tests (concurrency timeline). Not
   * structured logging — that path goes through `pino` in production.
   */
  onInstrumentation?: (evt: {
    stage:
      | "slot_requested"
      | "slot_acquired"
      | "slot_released"
      | "page_fetched"
      | "rate_limit_pause"
      | "retry";
    detail?: Record<string, unknown>;
  }) => void;
}

export interface InitialSyncReport {
  status: "completed" | "failed";
  tenantId: string;
  installationId: bigint;
  reposUpserted: number;
  pagesFetched: number;
  pausedForRateLimitMs: number;
  retries: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Types

interface GhRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  archived?: boolean;
}
interface GhReposListResponse {
  total_count: number;
  repositories: GhRepo[];
}

// ---------------------------------------------------------------------------
// Main

export async function runInitialSync(input: InitialSyncInput): Promise<InitialSyncReport> {
  const clock = input.clock ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const apiBase = input.apiBase ?? "https://api.github.com";
  const perPage = input.perPage ?? 100;
  const fetchFn = input.fetchFn ?? fetch;
  const instrument = input.onInstrumentation ?? (() => {});

  instrument({ stage: "slot_requested" });
  const release = await input.semaphore.acquire();
  instrument({ stage: "slot_acquired" });

  try {
    // Upsert the progress row up front. Resumability: read existing
    // next_page_cursor so we continue from there.
    await input.sql.unsafe(
      `INSERT INTO github_sync_progress
         (tenant_id, installation_id, status, started_at, last_progress_at, updated_at, requested_by)
       VALUES ($1, $2, 'running', now(), now(), now(), $3)
       ON CONFLICT (tenant_id, installation_id) DO UPDATE
         SET status = 'running',
             started_at = COALESCE(github_sync_progress.started_at, now()),
             last_progress_at = now(),
             updated_at = now(),
             last_error = NULL,
             completed_at = NULL,
             requested_by = COALESCE(EXCLUDED.requested_by, github_sync_progress.requested_by)`,
      [input.tenantId, input.installationId.toString(), input.requestedBy ?? null],
    );

    const cursorRow = (await input.sql.unsafe(
      `SELECT next_page_cursor, fetched_repos, pages_fetched
         FROM github_sync_progress
        WHERE tenant_id = $1 AND installation_id = $2`,
      [input.tenantId, input.installationId.toString()],
    )) as unknown as Array<{
      next_page_cursor: string | null;
      fetched_repos: number;
      pages_fetched: number;
    }>;
    let page = parseCursor(cursorRow[0]?.next_page_cursor) ?? 1;
    let reposUpserted = cursorRow[0]?.fetched_repos ?? 0;
    let pagesFetched = cursorRow[0]?.pages_fetched ?? 0;
    let pausedMs = 0;
    let retries = 0;

    const token = await input.getInstallationToken(input.installationId);
    const bucketKey = `rl:${input.installationId.toString()}`;

    // Pagination loop.
    for (;;) {
      // 1 req/s floor.
      {
        const { waitMs } = await input.tokenBucket.acquire(bucketKey);
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }

      const url = `${apiBase}/installation/repositories?page=${page}&per_page=${perPage}`;
      let res: Response;
      let attempt = 0;
      for (;;) {
        res = await fetchFn(url, {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "bematist-initial-sync/1.0",
          },
        });

        if (res.status === 200) break;

        if (res.status === 429) {
          // Secondary rate-limit. Exponential with jitter, max 5 retries.
          if (attempt >= 5) {
            throw new Error(`initial-sync: 429 after 5 retries for tenant=${input.tenantId}`);
          }
          const retryAfter = Number(res.headers.get("retry-after") ?? "0");
          const exp = Math.min(60_000 * 2 ** attempt, 900_000);
          const jitter = exp * (0.8 + Math.random() * 0.4); // ±20%
          const waitMs = Math.max(retryAfter * 1000, jitter);
          instrument({ stage: "retry", detail: { attempt, waitMs, reason: "429" } });
          await sleep(waitMs);
          pausedMs += waitMs;
          retries += 1;
          attempt += 1;
          continue;
        }

        if (res.status === 403) {
          const retryAfter = Number(res.headers.get("retry-after") ?? "30");
          const jitter = retryAfter * 1000 * (1 + Math.random() * 0.3); // +30%
          const waitMs = Math.max(30_000, jitter);
          instrument({ stage: "retry", detail: { attempt, waitMs, reason: "403" } });
          await sleep(waitMs);
          pausedMs += waitMs;
          retries += 1;
          attempt += 1;
          if (attempt >= 5) {
            throw new Error(`initial-sync: 403 after 5 retries for tenant=${input.tenantId}`);
          }
          continue;
        }

        throw new Error(
          `initial-sync: unexpected status ${res.status} for tenant=${input.tenantId} page=${page}`,
        );
      }

      const body = (await res.json()) as GhReposListResponse;
      const totalCount = typeof body.total_count === "number" ? body.total_count : null;

      // UPSERT each repo on (provider, provider_repo_id).
      for (const repo of body.repositories) {
        const providerRepoId = String(repo.id);
        const inserted = await upsertRepo(input.sql, {
          tenantId: input.tenantId,
          providerRepoId,
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          archived: repo.archived === true,
        });
        reposUpserted += 1;
        if (inserted) {
          try {
            await input.emitRecompute({
              tenantId: input.tenantId,
              providerRepoId,
              reason: "initial_sync_new_repo",
              at: clock(),
            });
          } catch {
            // Non-fatal — G1-linker retries via its own cron if missed.
          }
        }
      }

      pagesFetched += 1;

      // Rate-limit check — pause if remaining < 100 until reset + 5s jitter.
      const remaining = Number(
        res.headers.get("x-ratelimit-remaining") ?? Number.POSITIVE_INFINITY,
      );
      const resetEpochSec = Number(res.headers.get("x-ratelimit-reset") ?? 0);

      // Link parsing for pagination decision.
      const hasNext = /rel="next"/.test(res.headers.get("link") ?? "");
      instrument({
        stage: "page_fetched",
        detail: { page, repoCount: body.repositories.length, remaining, hasNext },
      });

      // Persist progress before potentially long rate-limit pause.
      await input.sql.unsafe(
        `UPDATE github_sync_progress
           SET fetched_repos = $1,
               pages_fetched = $2,
               total_repos = COALESCE($3, total_repos),
               next_page_cursor = $4,
               last_progress_at = now(),
               updated_at = now()
         WHERE tenant_id = $5 AND installation_id = $6`,
        [
          reposUpserted,
          pagesFetched,
          totalCount,
          hasNext ? String(page + 1) : null,
          input.tenantId,
          input.installationId.toString(),
        ],
      );

      if (!hasNext) break;

      if (remaining < 100 && resetEpochSec > 0) {
        const nowSec = Math.floor(clock() / 1000);
        const jitterSec = 5 + Math.random() * 5; // 5s base + up to 5s jitter
        const waitMs = Math.max(0, (resetEpochSec + jitterSec - nowSec) * 1000);
        if (waitMs > 0) {
          instrument({
            stage: "rate_limit_pause",
            detail: { waitMs, remaining, resetEpochSec },
          });
          await sleep(waitMs);
          pausedMs += waitMs;
        }
      }

      page += 1;
    }

    await input.sql.unsafe(
      `UPDATE github_sync_progress
         SET status = 'completed',
             completed_at = now(),
             next_page_cursor = NULL,
             last_progress_at = now(),
             updated_at = now()
       WHERE tenant_id = $1 AND installation_id = $2`,
      [input.tenantId, input.installationId.toString()],
    );

    // Test-only hold so concurrency tests see slots overlap in wall-clock time.
    if (input.holdSlotMs && input.holdSlotMs > 0) {
      await sleep(input.holdSlotMs);
    }

    return {
      status: "completed",
      tenantId: input.tenantId,
      installationId: input.installationId,
      reposUpserted,
      pagesFetched,
      pausedForRateLimitMs: pausedMs,
      retries,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await input.sql.unsafe(
        `UPDATE github_sync_progress
           SET status = 'failed',
               last_error = $1,
               last_progress_at = now(),
               updated_at = now()
         WHERE tenant_id = $2 AND installation_id = $3`,
        [message.slice(0, 4096), input.tenantId, input.installationId.toString()],
      );
    } catch {
      // best-effort
    }
    return {
      status: "failed",
      tenantId: input.tenantId,
      installationId: input.installationId,
      reposUpserted: 0,
      pagesFetched: 0,
      pausedForRateLimitMs: 0,
      retries: 0,
      error: message,
    };
  } finally {
    input.onInstrumentation?.({ stage: "slot_released" });
    release();
  }
}

function parseCursor(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/**
 * UPSERT a single repo. Keyed on (provider='github', provider_repo_id) via
 * the partial-unique index `repos_provider_unique`. Returns `true` when a
 * new row was inserted, `false` on update (so the caller can emit a
 * recompute signal only for genuinely new repos).
 *
 * Note: the primary-key on `repos.id` is a UUID. We need a stable
 * (provider, provider_repo_id) UPSERT path; since the partial unique index
 * can't be the ON CONFLICT target directly in all PG versions, we do a
 * read-then-insert-or-update in one SQL roundtrip using a CTE.
 */
async function upsertRepo(
  sql: Sql,
  r: {
    tenantId: string;
    providerRepoId: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    archived: boolean;
  },
): Promise<boolean> {
  // We rely on the partial unique index `repos_provider_unique`
  // (provider, provider_repo_id) WHERE provider_repo_id IS NOT NULL.
  // ON CONFLICT matches it when the INSERT's row satisfies the predicate.
  const rows = (await sql.unsafe(
    `INSERT INTO repos
       (id, org_id, repo_id_hash, provider, provider_repo_id,
        full_name, default_branch, first_seen_at, archived_at, tracking_state)
     VALUES
       ($1, $2, $3, 'github', $4, $5, $6, now(), $7, 'inherit')
     ON CONFLICT (provider, provider_repo_id)
       WHERE provider_repo_id IS NOT NULL
       DO UPDATE SET
         full_name = EXCLUDED.full_name,
         default_branch = EXCLUDED.default_branch,
         archived_at = EXCLUDED.archived_at
     RETURNING (xmax = 0) AS inserted`,
    [
      randomUUID(),
      r.tenantId,
      // repo_id_hash is NOT NULL + globally UNIQUE in the schema. The
      // authoritative value is the HMAC written by G1-linker once we have
      // the tenant salt (D33). Until then we use a stable placeholder
      // derived from (tenant, provider_repo_id) so the global UNIQUE
      // constraint on repo_id_hash holds and G1-linker can rewrite
      // in-place.
      `gh:pending:${r.tenantId}:${r.providerRepoId}`,
      r.providerRepoId,
      r.fullName,
      r.defaultBranch,
      r.archived ? new Date() : null,
    ],
  )) as unknown as Array<{ inserted: boolean }>;
  return rows[0]?.inserted === true;
}
