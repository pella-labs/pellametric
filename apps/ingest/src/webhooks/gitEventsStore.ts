// In-memory git_events store (Sprint-1 Phase 6, PRD §Phase 6).
//
// Mirrors Postgres `INSERT INTO git_events ... ON CONFLICT (pr_node_id) DO
// UPDATE` semantics for unit tests; the real impl lives in the worker reading
// from this interface against the 0003_sprint1_git_events migration.
//
// Per D-S1-17, row-level dedup via UNIQUE(pr_node_id) is the SECOND layer —
// transport dedup via Redis SETNX on delivery_id is the first. Push events
// (no pr_node_id) bypass the unique constraint; each push row is retained.

import type { WebhookSource } from "./verify";

export type GitEventRow = {
  source: WebhookSource;
  event_kind: string;
  pr_node_id: string | null;
  repo_id: string;
  pr_number?: number;
  commit_sha?: string | null;
  merged_at?: string | null;
  payload: unknown;
};

export interface GitEventsStore {
  upsert(row: GitEventRow, orgId: string): Promise<{ inserted: boolean }>;
  count(orgId: string): Promise<number>;
  findByPrNode(orgId: string, prNodeId: string): Promise<GitEventRow | null>;
}

export function createInMemoryGitEventsStore(): GitEventsStore {
  // key = `${orgId}:${pr_node_id}` for PR-bearing rows; push/null-pr rows get
  // a synthetic key and always insert.
  const rows = new Map<string, GitEventRow>();
  let pushCounter = 0;

  return {
    async upsert(row, orgId) {
      if (row.pr_node_id === null) {
        const syntheticKey = `push:${row.source}:${row.commit_sha ?? "nosha"}:${Date.now()}:${pushCounter++}`;
        rows.set(`${orgId}:${syntheticKey}`, row);
        return { inserted: true };
      }
      const key = `${orgId}:${row.pr_node_id}`;
      const existing = rows.get(key);
      rows.set(key, row);
      return { inserted: existing === undefined };
    },
    async count(orgId) {
      let n = 0;
      for (const k of rows.keys()) {
        if (k.startsWith(`${orgId}:`)) n++;
      }
      return n;
    },
    async findByPrNode(orgId, prNodeId) {
      return rows.get(`${orgId}:${prNodeId}`) ?? null;
    },
  };
}
