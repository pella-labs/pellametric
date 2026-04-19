/**
 * One-shot backfill: populate `commit_sha` on historical ClickHouse `events`
 * rows so the GitHub-App linker can join sessions to PRs. As of 2026-04-19,
 * collectors never emitted commit_sha, so every one of the 263k pre-fix
 * events in dev has `commit_sha IS NULL`. With Phase 1 in place, new events
 * carry it — this script repairs the history.
 *
 * Flow per session:
 *   1. Look up the source JSONL at ~/.claude/projects/<project>/<sessionId>.jsonl
 *      by scanning the projects tree once and indexing sessionId -> path.
 *   2. Read the first line that carries a `cwd` field. Spawn
 *      `git -C <cwd> rev-parse HEAD` to resolve the SHA that was HEAD at the
 *      time of capture. (Best-effort — if the worktree has since moved or
 *      been deleted, skip.)
 *   3. Batch 200 sessions per mutation and issue
 *      `ALTER TABLE events UPDATE commit_sha = ? WHERE session_id = ? AND engineer_id = ?`.
 *      Poll `system.mutations` until `is_done = 1` before the next batch.
 *   4. After each batch, emit a `session_repo_recompute:<tenant_id>` Redis
 *      Stream message per touched session so the linker picks it up and
 *      writes session_repo_links rows. The hourly reconcile cron is the
 *      safety net if the stream misses a session.
 *
 * Run:
 *   CLICKHOUSE_URL=... BEMATIST_ORG_ID=... bun run apps/worker/scripts/backfill-commit-sha.ts
 *
 * Env:
 *   CLICKHOUSE_URL          — defaults to http://localhost:8123
 *   CLICKHOUSE_DATABASE     — defaults to "bematist"
 *   BEMATIST_ORG_ID         — tenant to repair. Required.
 *   BEMATIST_CLAUDE_DIR     — defaults to $HOME/.claude/projects
 *   BEMATIST_REDIS_URL      — defaults to redis://localhost:6379; absent =>
 *                             backfill runs but skips recompute emission
 *                             (hourly reconcile will catch up).
 *   BEMATIST_BACKFILL_LIMIT — max sessions to process in one run. Defaults
 *                             to Infinity.
 *   BEMATIST_BACKFILL_DRY   — "1" = log what would be updated, do nothing.
 */

import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient as createClickHouseClient } from "@clickhouse/client";

const BATCH_SIZE = 200;
const MUTATION_POLL_MS = 2000;
const MUTATION_MAX_WAIT_MS = 5 * 60 * 1000;

export interface SessionKey {
  session_id: string;
  engineer_id: string;
}

export interface ResolvedSession extends SessionKey {
  commit_sha: string;
}

export interface JsonlIndex {
  /** Map from session_id -> absolute path of the JSONL file that holds it. */
  byId: Map<string, string>;
}

/**
 * Walk `~/.claude/projects` and build an index of session_id -> jsonl path.
 * Claude Code writes one file per session keyed by the ULID-ish sessionId —
 * matching the filename to the session_id works for the overwhelming
 * majority of rows.
 */
export async function buildJsonlIndex(root: string): Promise<JsonlIndex> {
  const byId = new Map<string, string>();
  async function walk(dir: string) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const sid = e.name.replace(/\.jsonl$/, "");
        if (!byId.has(sid)) byId.set(sid, p);
      }
    }
  }
  await walk(root);
  return { byId };
}

/**
 * Read up to N lines from `path` and return the first non-empty `cwd` field.
 * We don't need the full file — `cwd` is on every line from ~Claude Code
 * v1.0.30+ and on the `session_meta` line of older files.
 */
export async function readCwdFromJsonl(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path, "utf8");
    const lines = buf.split("\n");
    for (let i = 0; i < Math.min(lines.length, 200); i++) {
      const raw = lines[i];
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw) as { cwd?: unknown };
        if (typeof obj.cwd === "string" && obj.cwd.length > 0) return obj.cwd;
      } catch {
        // malformed line — keep going
      }
    }
  } catch {
    // File missing / unreadable — give up.
  }
  return null;
}

export async function resolveHeadSha(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("git", ["-C", cwd, "rev-parse", "HEAD"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return resolve(null);
    }
    let out = "";
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (d: string) => {
      out += d;
    });
    proc.on("error", () => done(null));
    proc.on("close", (code) => {
      if (code !== 0) return done(null);
      const v = out.trim();
      done(/^[0-9a-f]{40}$/i.test(v) ? v : null);
    });
    setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {}
      done(null);
    }, 3000);
  });
}

export interface ClickHouseLike {
  query(opts: {
    query: string;
    query_params?: Record<string, unknown>;
    format?: string;
  }): Promise<{ json(): Promise<unknown> }>;
  command(opts: { query: string; query_params?: Record<string, unknown> }): Promise<unknown>;
}

/**
 * Fetch distinct (session_id, engineer_id) pairs that still need commit_sha.
 * Ordered by last event ts desc — repairs recent activity first so the
 * dashboard picks up signal immediately.
 */
export async function listSessionsMissingCommitSha(
  ch: ClickHouseLike,
  org_id: string,
  limit: number,
): Promise<SessionKey[]> {
  const res = await ch.query({
    query: `
      SELECT session_id, engineer_id
        FROM events
       WHERE org_id = {org:String}
         AND session_id != ''
         AND commit_sha IS NULL
       GROUP BY session_id, engineer_id
       ORDER BY max(ts) DESC
       LIMIT {limit:UInt64}
    `,
    query_params: { org: org_id, limit },
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as Array<{ session_id: string; engineer_id: string }>;
  return rows;
}

/**
 * Issue one ALTER TABLE ... UPDATE per (session_id, engineer_id) in the
 * batch. ClickHouse serialises mutations per table, so we await each before
 * queuing the next; this keeps the merge tree from accumulating overlapping
 * UPDATEs and lets us poll one step at a time.
 */
export async function applyBatch(
  ch: ClickHouseLike,
  org_id: string,
  batch: ResolvedSession[],
  sink: MutationIdSink,
): Promise<void> {
  for (const s of batch) {
    await ch.command({
      query: `
        ALTER TABLE events
           UPDATE commit_sha = {sha:String}
         WHERE org_id = {org:String}
           AND session_id = {sid:String}
           AND engineer_id = {eng:String}
           AND commit_sha IS NULL
      `,
      query_params: { sha: s.commit_sha, org: org_id, sid: s.session_id, eng: s.engineer_id },
    });
  }
  await sink.waitAllDone(ch);
}

/**
 * Proxy over `SELECT ... FROM system.mutations` that waits until every
 * outstanding mutation for the `events` table has `is_done = 1`. Returns
 * early if nothing is pending. Throws if the wall-clock budget elapses —
 * preserves the invariant "don't queue a new batch on top of a stuck one."
 */
export interface MutationIdSink {
  waitAllDone(ch: ClickHouseLike): Promise<void>;
}

export function makePollingSink(opts: {
  intervalMs?: number;
  maxWaitMs?: number;
  logger?: (msg: string) => void;
}): MutationIdSink {
  const intervalMs = opts.intervalMs ?? MUTATION_POLL_MS;
  const maxWaitMs = opts.maxWaitMs ?? MUTATION_MAX_WAIT_MS;
  const log = opts.logger ?? (() => {});
  return {
    async waitAllDone(ch) {
      const start = Date.now();
      for (;;) {
        const res = await ch.query({
          query: `SELECT count() AS n
                    FROM system.mutations
                   WHERE database = currentDatabase()
                     AND table = 'events'
                     AND is_done = 0`,
          format: "JSONEachRow",
        });
        const rows = (await res.json()) as Array<{ n: number | string }>;
        const pending = Number(rows[0]?.n ?? 0);
        if (pending === 0) return;
        if (Date.now() - start > maxWaitMs) {
          throw new Error(`backfill:mutation-wait-timeout pending=${pending}`);
        }
        log(`mutation pending=${pending}`);
        await sleep(intervalMs);
      }
    },
  };
}

/**
 * Redis Stream emitter — one message per session the backfill repaired.
 * Stream name matches apps/worker/src/github-linker/consumer.ts subscription:
 *   session_repo_recompute:<tenant_id>
 */
export interface RecomputeEmitter {
  emit(tenantId: string, sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export function noopEmitter(): RecomputeEmitter {
  return {
    async emit() {},
    async close() {},
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- Main orchestration --------------------------------------------------

export interface BackfillDeps {
  ch: ClickHouseLike;
  org_id: string;
  claudeDir: string;
  sink: MutationIdSink;
  emitter: RecomputeEmitter;
  limit: number;
  dryRun: boolean;
  log: (msg: string) => void;
}

export interface BackfillSummary {
  scanned: number;
  resolved: number;
  skippedNoJsonl: number;
  skippedNoCwd: number;
  skippedNoGit: number;
  batchesApplied: number;
  recomputeEmits: number;
}

export async function runBackfill(deps: BackfillDeps): Promise<BackfillSummary> {
  const { ch, org_id, claudeDir, sink, emitter, limit, dryRun, log } = deps;
  const summary: BackfillSummary = {
    scanned: 0,
    resolved: 0,
    skippedNoJsonl: 0,
    skippedNoCwd: 0,
    skippedNoGit: 0,
    batchesApplied: 0,
    recomputeEmits: 0,
  };

  log(`backfill: indexing ${claudeDir}`);
  const index = await buildJsonlIndex(claudeDir);
  log(`backfill: jsonl index size=${index.byId.size}`);

  log(`backfill: listing sessions missing commit_sha for org=${org_id} limit=${limit}`);
  const pending = await listSessionsMissingCommitSha(ch, org_id, limit);
  log(`backfill: sessions pending=${pending.length}`);

  let buffer: ResolvedSession[] = [];
  for (const row of pending) {
    summary.scanned += 1;
    const path = index.byId.get(row.session_id);
    if (!path) {
      summary.skippedNoJsonl += 1;
      continue;
    }
    const cwd = await readCwdFromJsonl(path);
    if (!cwd) {
      summary.skippedNoCwd += 1;
      continue;
    }
    const sha = await resolveHeadSha(cwd);
    if (!sha) {
      summary.skippedNoGit += 1;
      continue;
    }
    summary.resolved += 1;
    buffer.push({ session_id: row.session_id, engineer_id: row.engineer_id, commit_sha: sha });
    if (buffer.length >= BATCH_SIZE) {
      await flush(buffer);
      buffer = [];
    }
  }
  if (buffer.length > 0) await flush(buffer);

  log(`backfill: complete ${JSON.stringify(summary)}`);
  return summary;

  async function flush(batch: ResolvedSession[]) {
    if (dryRun) {
      log(`backfill(dry): would apply batch of ${batch.length} and emit recompute`);
      summary.batchesApplied += 1;
      summary.recomputeEmits += batch.length;
      return;
    }
    log(`backfill: applying batch size=${batch.length}`);
    await applyBatch(ch, org_id, batch, sink);
    summary.batchesApplied += 1;
    for (const s of batch) {
      try {
        await emitter.emit(org_id, s.session_id);
        summary.recomputeEmits += 1;
      } catch (err) {
        log(`backfill: recompute emit failed for session=${s.session_id} err=${String(err)}`);
      }
    }
  }
}

// ---- Binary entrypoint ---------------------------------------------------

async function main() {
  const org_id = process.env.BEMATIST_ORG_ID;
  if (!org_id) {
    console.error("BEMATIST_ORG_ID is required");
    process.exit(1);
  }
  const claudeDir = process.env.BEMATIST_CLAUDE_DIR ?? join(homedir(), ".claude", "projects");
  const limit = Number(process.env.BEMATIST_BACKFILL_LIMIT ?? Number.MAX_SAFE_INTEGER);
  const dryRun = process.env.BEMATIST_BACKFILL_DRY === "1";

  try {
    await stat(claudeDir);
  } catch {
    console.error(`claude projects dir not found: ${claudeDir}`);
    process.exit(1);
  }

  const ch = createClickHouseClient({
    url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    database: process.env.CLICKHOUSE_DATABASE ?? "bematist",
  });

  const emitter = await buildRedisEmitter();
  const sink = makePollingSink({ logger: (_m) => {} });

  try {
    const _summary = await runBackfill({
      ch: ch as unknown as ClickHouseLike,
      org_id,
      claudeDir,
      sink,
      emitter,
      limit,
      dryRun,
      log: (_m) => {},
    });
  } finally {
    await ch.close().catch(() => undefined);
    await emitter.close().catch(() => undefined);
  }
}

async function buildRedisEmitter(): Promise<RecomputeEmitter> {
  const url = process.env.BEMATIST_REDIS_URL ?? process.env.REDIS_URL;
  if (!url) {
    console.warn("no REDIS_URL set — skipping recompute emission (reconcile cron will catch up)");
    return noopEmitter();
  }
  try {
    const mod = (await import("redis")) as unknown as {
      createClient: (opts: { url: string }) => {
        connect: () => Promise<void>;
        xAdd: (stream: string, id: string, fields: Record<string, string>) => Promise<string>;
        quit: () => Promise<void>;
      };
    };
    const client = mod.createClient({ url });
    await client.connect();
    return {
      async emit(tenantId, sessionId) {
        await client.xAdd(`session_repo_recompute:${tenantId}`, "*", {
          tenant_id: tenantId,
          session_id: sessionId,
          reason: "backfill_commit_sha",
          at: new Date().toISOString(),
        });
      },
      async close() {
        await client.quit();
      },
    };
  } catch (err) {
    console.warn("redis init failed — skipping recompute emission:", String(err));
    return noopEmitter();
  }
}

// Only run main() when executed directly (not when imported from tests).
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
