// Outcomes store (CLAUDE.md §Outcome Attribution, Layer 2).
//
// Mirrors Postgres `INSERT INTO outcomes (org_id, engineer_id, kind,
// pr_number, commit_sha, session_id, ai_assisted, trailer_source)
// ON CONFLICT (org_id, commit_sha, COALESCE(session_id,'')) DO NOTHING`
// semantics for unit tests.
//
// Why a separate store from `gitEventsStore`: outcomes are per-COMMIT rows
// keyed on (org, commit_sha, session_id) — not per-PR. One push with 5
// trailer-bearing commits emits 5 outcome rows; gitEventsStore emits one
// row per push/PR event. The two join via `commit_sha` downstream.
//
// Idempotency: UNIQUE(org_id, commit_sha, COALESCE(session_id,'')) per
// CLAUDE.md. Duplicate `(org, sha, session)` on `INSERT ... ON CONFLICT DO
// NOTHING` is a no-op; caller sees `inserted:false` and does nothing.

export type TrailerSource = "push" | "pull_request" | "reconcile";

export interface OutcomeRow {
  org_id: string;
  engineer_id: string | null;
  kind: "pr_merged" | "commit_landed";
  pr_number: number | null;
  commit_sha: string;
  session_id: string;
  ai_assisted: boolean;
  trailer_source: TrailerSource;
}

export interface OutcomesStore {
  upsert(row: OutcomeRow): Promise<{ inserted: boolean }>;
  count(orgId: string): Promise<number>;
  findByCommit(orgId: string, commitSha: string, sessionId: string): Promise<OutcomeRow | null>;
  all(orgId: string): Promise<OutcomeRow[]>;
}

export function createInMemoryOutcomesStore(): OutcomesStore {
  // Key = `${org_id}:${commit_sha}:${session_id}` — matches the Postgres
  // UNIQUE(org_id, commit_sha, COALESCE(session_id,'')) constraint.
  const rows = new Map<string, OutcomeRow>();

  const keyFor = (org: string, sha: string, session: string): string => `${org}:${sha}:${session}`;

  return {
    async upsert(row) {
      const key = keyFor(row.org_id, row.commit_sha, row.session_id);
      if (rows.has(key)) return { inserted: false };
      rows.set(key, row);
      return { inserted: true };
    },
    async count(orgId) {
      let n = 0;
      for (const k of rows.keys()) {
        if (k.startsWith(`${orgId}:`)) n++;
      }
      return n;
    },
    async findByCommit(orgId, commitSha, sessionId) {
      return rows.get(keyFor(orgId, commitSha, sessionId)) ?? null;
    },
    async all(orgId) {
      const out: OutcomeRow[] = [];
      for (const [k, v] of rows.entries()) {
        if (k.startsWith(`${orgId}:`)) out.push(v);
      }
      return out;
    },
  };
}
