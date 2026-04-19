/**
 * One-shot backfill: populate `commit_sha` + `repo_id_hash` on historical
 * ClickHouse `events` rows by joining them against the GitHub App's
 * `git_events.push` rows in Postgres. Complements
 * `backfill-commit-sha.ts`, which reads from local Claude Code JSONL
 * files — that approach only recovers the sessions whose files sit on
 * the machine running the script. This script is purely SQL and covers
 * every engineer on the team, regardless of whose laptop their JSONL
 * originated on.
 *
 * Matching strategy, per (org, engineer_id, session_id, branch) window
 * drawn from CH `events`:
 *   1. Query Postgres for `git_events` rows WHERE event_kind='push' AND
 *      branch = <window.branch> AND received_at BETWEEN
 *      <window.started_at - 2h> AND <window.ended_at + 24h>.
 *   2. Pick the push closest to <window.ended_at>. Inherits both its
 *      `commit_sha` (text) and `repo_id_hash` (hex-encoded bytea).
 *   3. Fallback if zero matches in the tight window: widen to ±7d,
 *      pick nearest by abs(received_at - ended_at).
 *   4. If still no match, skip — session ran but no push landed, so
 *      there's no signal to attribute with.
 *
 * Writes:
 *   ALTER TABLE bematist.events
 *   UPDATE commit_sha = ?, repo_id_hash = ?
 *   WHERE org_id = ? AND engineer_id = ? AND session_id = ?
 *     AND branch = ? AND commit_sha IS NULL
 *
 * Polls `system.mutations` per batch before continuing.
 *
 * After each batch, emits one `session_repo_recompute:<tenant_id>` Redis
 * Stream message per touched session so the linker drains promptly. The
 * hourly `reconcileScaffold` cron is the safety net if Redis is down.
 *
 * Run:
 *   DATABASE_URL=... CLICKHOUSE_URL=... REDIS_URL=... \
 *     bun run apps/worker/scripts/backfill-commit-sha-from-git.ts
 *
 * Env:
 *   DATABASE_URL              — Postgres connection string. Required.
 *   CLICKHOUSE_URL            — defaults to http://localhost:8123
 *   CLICKHOUSE_DATABASE       — defaults to "bematist"
 *   REDIS_URL                 — if unset, skips recompute emission
 *   BEMATIST_ORG_ID           — single-tenant mode. If unset, processes
 *                               every org_id present in events.
 *   BEMATIST_BACKFILL_LIMIT   — max session-windows per run. Default Inf.
 *   BEMATIST_BACKFILL_DRY     — "1" = log planned updates, mutate nothing.
 */

import { createClient as createClickHouseClient } from "@clickhouse/client";
import postgres, { type Sql } from "postgres";

const BATCH_SIZE = 200;
const MUTATION_POLL_MS = 2000;
const MUTATION_MAX_WAIT_MS = 5 * 60 * 1000;
const TIGHT_WINDOW_HOURS_BEFORE = 2;
const TIGHT_WINDOW_HOURS_AFTER = 24;
const WIDE_WINDOW_DAYS = 7;

export interface SessionWindow {
  org_id: string;
  engineer_id: string;
  session_id: string;
  branch: string;
  started_at: string; // ISO
  ended_at: string; // ISO
}

export interface ResolvedWindow extends SessionWindow {
  commit_sha: string;
  repo_id_hash_hex: string;
}

const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? "bematist";
const PG_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL ?? null;
const ORG_FILTER = process.env.BEMATIST_ORG_ID ?? null;
const LIMIT = process.env.BEMATIST_BACKFILL_LIMIT
  ? Number(process.env.BEMATIST_BACKFILL_LIMIT)
  : Number.POSITIVE_INFINITY;
const DRY_RUN = process.env.BEMATIST_BACKFILL_DRY === "1";

if (!PG_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

export async function fetchCandidateWindows(
  ch: ReturnType<typeof createClickHouseClient>,
): Promise<SessionWindow[]> {
  const orgClause = ORG_FILTER ? `AND org_id = {org_id:String}` : "";
  const limitClause = Number.isFinite(LIMIT) ? `LIMIT {limit:UInt64}` : "";
  const query = `
    SELECT org_id,
           engineer_id,
           session_id,
           branch,
           toString(min(ts)) AS started_at,
           toString(max(ts)) AS ended_at
    FROM ${CH_DB}.events
    WHERE commit_sha IS NULL
      AND branch IS NOT NULL
      AND branch != ''
      ${orgClause}
    GROUP BY org_id, engineer_id, session_id, branch
    ORDER BY max(ts) DESC
    ${limitClause}
  `;
  const params: Record<string, string | number> = {};
  if (ORG_FILTER) params.org_id = ORG_FILTER;
  if (Number.isFinite(LIMIT)) params.limit = LIMIT;
  const res = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  return (await res.json()) as SessionWindow[];
}

export async function resolveWindow(sql: Sql, w: SessionWindow): Promise<ResolvedWindow | null> {
  // Tight window first
  const tight = (await sql.unsafe(
    `SELECT commit_sha, encode(repo_id_hash, 'hex') AS repo_hex,
            abs(EXTRACT(EPOCH FROM (received_at - $3::timestamptz))) AS delta_sec
     FROM git_events
     WHERE event_kind = 'push'
       AND branch = $1
       AND received_at BETWEEN $2::timestamptz - INTERVAL '${TIGHT_WINDOW_HOURS_BEFORE} hours'
                           AND $3::timestamptz + INTERVAL '${TIGHT_WINDOW_HOURS_AFTER} hours'
       AND commit_sha IS NOT NULL
       AND repo_id_hash IS NOT NULL
     ORDER BY delta_sec ASC
     LIMIT 1`,
    [w.branch, w.started_at, w.ended_at],
  )) as unknown as Array<{ commit_sha: string; repo_hex: string }>;

  if (tight[0]) {
    return { ...w, commit_sha: tight[0].commit_sha, repo_id_hash_hex: tight[0].repo_hex };
  }

  // Widened fallback
  const wide = (await sql.unsafe(
    `SELECT commit_sha, encode(repo_id_hash, 'hex') AS repo_hex,
            abs(EXTRACT(EPOCH FROM (received_at - $3::timestamptz))) AS delta_sec
     FROM git_events
     WHERE event_kind = 'push'
       AND branch = $1
       AND received_at BETWEEN $2::timestamptz - INTERVAL '${WIDE_WINDOW_DAYS} days'
                           AND $3::timestamptz + INTERVAL '${WIDE_WINDOW_DAYS} days'
       AND commit_sha IS NOT NULL
       AND repo_id_hash IS NOT NULL
     ORDER BY delta_sec ASC
     LIMIT 1`,
    [w.branch, w.started_at, w.ended_at],
  )) as unknown as Array<{ commit_sha: string; repo_hex: string }>;

  if (wide[0]) {
    return { ...w, commit_sha: wide[0].commit_sha, repo_id_hash_hex: wide[0].repo_hex };
  }

  return null;
}

export async function applyBatch(
  ch: ReturnType<typeof createClickHouseClient>,
  resolved: ResolvedWindow[],
): Promise<void> {
  if (resolved.length === 0) return;
  if (DRY_RUN) {
    for (const _r of resolved) {
    }
    return;
  }
  for (const r of resolved) {
    await ch.command({
      query: `
        ALTER TABLE ${CH_DB}.events
        UPDATE commit_sha = {sha:String},
               repo_id_hash = {rh:String}
        WHERE org_id = {org:String}
          AND engineer_id = {eng:String}
          AND session_id = {sid:String}
          AND branch = {br:String}
          AND commit_sha IS NULL
      `,
      query_params: {
        sha: r.commit_sha,
        rh: r.repo_id_hash_hex,
        org: r.org_id,
        eng: r.engineer_id,
        sid: r.session_id,
        br: r.branch,
      },
    });
  }
  await pollMutationsDrained(ch);
}

export async function pollMutationsDrained(
  ch: ReturnType<typeof createClickHouseClient>,
): Promise<void> {
  const deadline = Date.now() + MUTATION_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const res = await ch.query({
      query: `SELECT count() AS n FROM system.mutations
              WHERE is_done = 0 AND database = {db:String} AND table = 'events'`,
      query_params: { db: CH_DB },
      format: "JSONEachRow",
    });
    const rows = (await res.json()) as Array<{ n: string }>;
    if (!rows[0] || Number(rows[0].n) === 0) return;
    await new Promise((r) => setTimeout(r, MUTATION_POLL_MS));
  }
  throw new Error(`mutations did not drain in ${MUTATION_MAX_WAIT_MS}ms`);
}

export async function emitRecompute(resolved: ResolvedWindow[]): Promise<void> {
  if (!REDIS_URL || resolved.length === 0) return;
  try {
    const mod = await import("redis");
    const client = (
      mod as unknown as {
        createClient: (opts: { url: string }) => {
          connect(): Promise<void>;
          xAdd(stream: string, id: string, fields: Record<string, string>): Promise<string>;
          quit(): Promise<void>;
        };
      }
    ).createClient({ url: REDIS_URL });
    await client.connect();
    // Dedup by session_id within the batch — one message per session even
    // if a session covered multiple branches.
    const seen = new Set<string>();
    for (const r of resolved) {
      const key = `${r.org_id}:${r.session_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await client.xAdd(`session_repo_recompute:${r.org_id}`, "*", {
        session_id: r.session_id,
        reason: "commit_sha_backfill_from_git",
      });
    }
    await client.quit();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "recompute emission failed — hourly reconcile will catch up",
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export async function run(): Promise<void> {
  const ch = createClickHouseClient({ url: CH_URL, database: CH_DB });
  const sql = postgres(PG_URL as string, { max: 4, idle_timeout: 5 });
  const windows = await fetchCandidateWindows(ch);

  let _resolved = 0;
  let _skipped = 0;
  let batch: ResolvedWindow[] = [];

  for (const w of windows) {
    const r = await resolveWindow(sql, w);
    if (!r) {
      _skipped += 1;
      continue;
    }
    batch.push(r);
    _resolved += 1;
    if (batch.length >= BATCH_SIZE) {
      await applyBatch(ch, batch);
      await emitRecompute(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await applyBatch(ch, batch);
    await emitRecompute(batch);
  }
  await ch.close();
  await sql.end({ timeout: 5 });
}

if (import.meta.main) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
