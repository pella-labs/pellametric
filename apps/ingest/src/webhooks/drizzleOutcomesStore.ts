// Drizzle-backed OutcomesStore for D29 AI-Assisted trailer attribution.
//
// Writes the (org_id, engineer_id, kind, pr_number, commit_sha, session_id,
// ai_assisted, trailer_source) tuple produced by emitTrailerOutcomes.ts
// into the Postgres `outcomes` table. Idempotency comes from the
// partial-unique functional index installed by
// migration `custom/0013_outcomes_trailer_source.sql`:
//
//   CREATE UNIQUE INDEX outcomes_org_commit_session_uidx
//     ON outcomes (org_id, commit_sha, (COALESCE(session_id, '')))
//
// Drizzle's `.onConflictDoNothing({ target: [...] })` does NOT accept a
// functional expression in the conflict target in 0.36.x, so we issue a raw
// `db.execute(sql\`INSERT ... ON CONFLICT (org_id, commit_sha,
// (COALESCE(session_id, ''))) DO NOTHING RETURNING id\`)`. The presence of a
// returned id row means `inserted: true`; an empty result means the unique
// index short-circuited the write (idempotency hit, `inserted: false`).
//
// Error handling mirrors InMemoryOutcomesStore: never throw on duplicate
// (the ON CONFLICT clause is the gate), and let genuinely unexpected DB
// errors bubble up after a structured log — the webhook caller wraps this
// in its own try/catch.

import { outcomes } from "@bematist/schema/postgres";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logger } from "../logger";
import type { OutcomeRow, OutcomesStore, TrailerSource } from "./outcomesStore";

export interface DrizzleOutcomesStoreDeps {
  db: PostgresJsDatabase<Record<string, unknown>>;
}

type OutcomeDbRow = {
  org_id: string;
  engineer_id: string | null;
  kind: string;
  pr_number: number | null;
  commit_sha: string | null;
  session_id: string | null;
  ai_assisted: boolean;
  trailer_source: string | null;
};

export class DrizzleOutcomesStore implements OutcomesStore {
  constructor(private readonly deps: DrizzleOutcomesStoreDeps) {}

  async upsert(row: OutcomeRow): Promise<{ inserted: boolean }> {
    try {
      // Raw INSERT with ON CONFLICT against the partial-unique functional
      // index. Drizzle 0.36 does not support functional-index conflict
      // targets on .onConflictDoNothing(); we template the exact shape that
      // migration 0013 installs to keep idempotency atomic.
      //
      // `ts` + `id` are omitted — the Drizzle schema applies `.defaultNow()`
      // + `gen_random_uuid()` at the DDL layer; letting the DB fill them
      // matches the insert path used by InMemoryOutcomesStore (no ts/id in
      // the in-memory map either).
      const result = (await this.deps.db.execute(sql`
        INSERT INTO outcomes
          (org_id, engineer_id, kind, pr_number, commit_sha, session_id,
           ai_assisted, trailer_source)
        VALUES
          (${row.org_id}::uuid, ${row.engineer_id}, ${row.kind},
           ${row.pr_number}, ${row.commit_sha}, ${row.session_id},
           ${row.ai_assisted}, ${row.trailer_source})
        ON CONFLICT (org_id, commit_sha, (COALESCE(session_id, '')))
        DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;

      const inserted = Array.isArray(result) && result.length > 0;
      return { inserted };
    } catch (err) {
      logger.error(
        {
          org_id: row.org_id,
          commit_sha: row.commit_sha,
          session_id: row.session_id,
          err: err instanceof Error ? err.message : String(err),
        },
        "drizzleOutcomesStore.upsert failed",
      );
      throw err;
    }
  }

  async count(orgId: string): Promise<number> {
    const rows = (await this.deps.db.execute(sql`
      SELECT COUNT(*)::bigint AS n FROM outcomes WHERE org_id = ${orgId}::uuid
    `)) as unknown as Array<{ n: string | number }>;
    const first = rows[0];
    if (!first) return 0;
    // postgres-js returns bigint as string; coerce once.
    return typeof first.n === "string" ? Number.parseInt(first.n, 10) : Number(first.n);
  }

  async findByCommit(
    orgId: string,
    commitSha: string,
    sessionId: string,
  ): Promise<OutcomeRow | null> {
    // The partial-unique index uses `COALESCE(session_id, '')`, so the
    // `session_id=''` case in the interface is encoded as `session_id IS
    // NULL` on disk. Match both shapes so callers don't need to know the
    // storage detail.
    const rows = await this.deps.db
      .select({
        org_id: outcomes.org_id,
        engineer_id: outcomes.engineer_id,
        kind: outcomes.kind,
        pr_number: outcomes.pr_number,
        commit_sha: outcomes.commit_sha,
        session_id: outcomes.session_id,
        ai_assisted: outcomes.ai_assisted,
        trailer_source: outcomes.trailer_source,
      })
      .from(outcomes)
      .where(
        and(
          eq(outcomes.org_id, orgId),
          eq(outcomes.commit_sha, commitSha),
          sessionId === ""
            ? sql`${outcomes.session_id} IS NULL`
            : eq(outcomes.session_id, sessionId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toOutcomeRow(row as OutcomeDbRow);
  }

  async all(orgId: string): Promise<OutcomeRow[]> {
    const rows = await this.deps.db
      .select({
        org_id: outcomes.org_id,
        engineer_id: outcomes.engineer_id,
        kind: outcomes.kind,
        pr_number: outcomes.pr_number,
        commit_sha: outcomes.commit_sha,
        session_id: outcomes.session_id,
        ai_assisted: outcomes.ai_assisted,
        trailer_source: outcomes.trailer_source,
      })
      .from(outcomes)
      .where(eq(outcomes.org_id, orgId));
    return rows.map((r) => toOutcomeRow(r as OutcomeDbRow));
  }
}

export function createDrizzleOutcomesStore(
  db: PostgresJsDatabase<Record<string, unknown>>,
): DrizzleOutcomesStore {
  return new DrizzleOutcomesStore({ db });
}

function toOutcomeRow(row: OutcomeDbRow): OutcomeRow {
  return {
    org_id: row.org_id,
    engineer_id: row.engineer_id,
    kind: normalizeKind(row.kind),
    pr_number: row.pr_number,
    commit_sha: row.commit_sha ?? "",
    session_id: row.session_id ?? "",
    ai_assisted: row.ai_assisted,
    trailer_source: normalizeTrailerSource(row.trailer_source),
  };
}

function normalizeKind(raw: string): OutcomeRow["kind"] {
  if (raw === "pr_merged" || raw === "commit_landed") return raw;
  // Legacy Layer-1 `test_passed` rows pre-date the trailer path (outcomesStore
  // interface only models the Layer-2 union). We surface them as
  // `commit_landed` so read paths don't throw — the in-memory store never
  // contains them, and the UI reads via the commit-sha join anyway.
  return "commit_landed";
}

function normalizeTrailerSource(raw: string | null): TrailerSource {
  if (raw === "push" || raw === "pull_request" || raw === "reconcile") return raw;
  // NULL (legacy Layer-1) → collapse to "reconcile" for the read path so the
  // interface stays non-nullable. InMemoryOutcomesStore never writes NULL.
  return "reconcile";
}
