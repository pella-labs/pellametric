/**
 * One-shot / safe-to-rerun: write `session_repo_links` rows by matching
 * ClickHouse session windows against Postgres PRs on (branch, time-overlap).
 *
 * Why: the pure-function linker in apps/worker/src/github-linker/state.ts
 * matches sessions to PRs via SHA intersection. A session's commit_sha
 * (populated by either the in-process collector fix or backfill-commit-sha
 * scripts) only matches a PR when the session happened to end on the exact
 * commit that became the PR's head or merge — rare in practice. The bulk
 * of real work produces many commits per PR; the session's single captured
 * SHA is one of them at best.
 *
 * Branch + time-window match covers the common case: the session happened
 * on the same branch the PR was open on, and within the PR's open-to-merged
 * window. This produces a link with match_reason='pr_link' and
 * confidence=60 — lower than SHA/PR intersection links because branch+time
 * is circumstantial, but good enough to unblock cost-per-merged-PR numbers
 * that otherwise stay null.
 *
 * Inputs:
 *   CH sessions: (org_id, engineer_id, session_id, branch,
 *                 started_at=min(ts), ended_at=max(ts))
 *   PG pull_requests: (tenant_id, provider_repo_id, pr_number, head_ref,
 *                      opened_at, merged_at, closed_at, state,
 *                      repo_id_hash via git_events.push match)
 *
 * Match:
 *   session.branch = pr.head_ref
 *   AND [session.started_at, session.ended_at] overlaps
 *       [pr.opened_at, coalesce(pr.merged_at, pr.closed_at, now())]
 *
 * Writes: INSERT INTO session_repo_links (...) VALUES (...)
 *         ON CONFLICT (tenant_id, session_id, repo_id_hash, match_reason)
 *           DO NOTHING — safe to rerun.
 *
 * Run:
 *   railway ssh --service worker 'cd /app/apps/worker && bun scripts/link-sessions-by-branch.ts'
 */

import { createClient as createClickHouseClient } from "@clickhouse/client";
import postgres from "postgres";

const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? "bematist";
const PG_URL = process.env.DATABASE_URL;
const ORG_FILTER = process.env.BEMATIST_ORG_ID ?? null;

if (!PG_URL) {
  console.error("DATABASE_URL required");
  process.exit(2);
}

interface SessionWindow {
  org_id: string;
  engineer_id: string;
  session_id: string;
  branch: string;
  started_at: string;
  ended_at: string;
}

async function main() {
  const ch = createClickHouseClient({ url: CH_URL, database: CH_DB });
  const sql = postgres(PG_URL as string, { max: 4, idle_timeout: 5 });
  const orgClause = ORG_FILTER ? `AND org_id = {org:String}` : "";
  const chRes = await ch.query({
    query: `
      SELECT org_id,
             engineer_id,
             session_id,
             branch,
             toString(min(ts)) AS started_at,
             toString(max(ts)) AS ended_at
      FROM ${CH_DB}.events
      WHERE branch IS NOT NULL AND branch != ''
        ${orgClause}
      GROUP BY org_id, engineer_id, session_id, branch
    `,
    query_params: ORG_FILTER ? { org: ORG_FILTER } : {},
    format: "JSONEachRow",
  });
  const windows = (await chRes.json()) as SessionWindow[];

  // Group windows by (tenant_id, branch) to minimize PR query count.
  const byTenantBranch = new Map<string, SessionWindow[]>();
  for (const w of windows) {
    const key = `${w.org_id}|${w.branch}`;
    const arr = byTenantBranch.get(key) ?? [];
    arr.push(w);
    byTenantBranch.set(key, arr);
  }

  let _inserted = 0;
  let _skipped = 0;
  const salts = new Map<string, Buffer>(); // tenant_id -> salt
  async function salt(tenantId: string): Promise<Buffer> {
    const cached = salts.get(tenantId);
    if (cached) return cached;
    // Default salt derivation mirrors packages/scoring D12: hmac('bematist-
    // repo-id-hash', org.id). Used only to derive repo_id_hash when the
    // join below can't pull one from git_events (edge case).
    const { createHmac } = await import("node:crypto");
    const s = createHmac("sha256", "bematist-repo-id-hash").update(tenantId).digest();
    salts.set(tenantId, s);
    return s;
  }

  for (const [key, ws] of byTenantBranch) {
    const [tenantId, branch] = key.split("|");
    if (!tenantId || !branch) continue;
    // Find all PRs on that tenant whose head_ref = branch.
    const prs = (await sql.unsafe(
      `SELECT pr.provider_repo_id, pr.pr_number, pr.state, pr.opened_at, pr.closed_at,
              pr.merged_at, pr.head_sha,
              ge.repo_id_hash
         FROM github_pull_requests pr
         LEFT JOIN LATERAL (
           SELECT repo_id_hash
             FROM git_events
            WHERE event_kind = 'push'
              AND branch = pr.head_ref
              AND org_id = pr.tenant_id
            ORDER BY received_at DESC
            LIMIT 1
         ) ge ON TRUE
        WHERE pr.tenant_id = $1::uuid
          AND pr.head_ref = $2`,
      [tenantId, branch],
    )) as unknown as Array<{
      provider_repo_id: string;
      pr_number: number;
      state: string;
      opened_at: Date | null;
      closed_at: Date | null;
      merged_at: Date | null;
      head_sha: string | null;
      repo_id_hash: Buffer | null;
    }>;

    if (prs.length === 0) continue;

    for (const w of ws) {
      const sStart = new Date(w.started_at).getTime();
      const sEnd = new Date(w.ended_at).getTime();
      for (const pr of prs) {
        const pStart = pr.opened_at ? pr.opened_at.getTime() : 0;
        const pEnd = (pr.merged_at ?? pr.closed_at ?? new Date()).getTime();
        // Interval overlap: [sStart, sEnd] ∩ [pStart, pEnd] non-empty.
        if (sStart > pEnd || sEnd < pStart) continue;
        // Resolve a repo_id_hash. Prefer git_events.push match; fall back to
        // tenant-salt HMAC of provider_repo_id so we always have bytea.
        let rh: Buffer;
        if (pr.repo_id_hash && pr.repo_id_hash.length === 32) {
          rh = pr.repo_id_hash;
        } else {
          const s = await salt(tenantId);
          const { createHmac } = await import("node:crypto");
          rh = createHmac("sha256", s).update(`github:${pr.provider_repo_id}`).digest();
        }
        try {
          const res = (await sql.unsafe(
            `INSERT INTO session_repo_links
               (tenant_id, session_id, repo_id_hash, match_reason,
                provider_repo_id, evidence, confidence, inputs_sha256,
                computed_at, stale_at)
             SELECT $1::uuid, $2, $3::bytea, 'pr_link',
                    $4, $5::jsonb, 60, $6::bytea, now(), NULL
             WHERE NOT EXISTS (
               SELECT 1 FROM session_repo_links
                WHERE tenant_id = $1::uuid
                  AND session_id = $2
                  AND repo_id_hash = $3::bytea
                  AND match_reason = 'pr_link'
                  AND stale_at IS NULL
             )
             RETURNING session_id`,
            [
              tenantId,
              w.session_id,
              `\\x${rh.toString("hex")}`,
              pr.provider_repo_id,
              JSON.stringify({
                source: "branch_time_match",
                branch,
                pr_number: pr.pr_number,
                pr_state: pr.state,
                session_window: [w.started_at, w.ended_at],
                pr_window: [pr.opened_at, pr.merged_at ?? pr.closed_at],
              }),
              // Deterministic inputs_sha256 placeholder so the partial-
              // unique index is happy; rerun-safe via ON CONFLICT.
              `\\x${createHmacStatic(`${w.session_id}|${pr.pr_number}`).toString("hex")}`,
            ],
          )) as unknown as Array<{ session_id: string }>;
          if (res.length > 0) _inserted += 1;
          else _skipped += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[link-by-branch] insert failed for ${w.session_id}: ${msg.slice(0, 160)}`);
        }
      }
    }
  }
  await ch.close();
  await sql.end({ timeout: 5 });
}

function createHmacStatic(input: string): Buffer {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(input).digest();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
