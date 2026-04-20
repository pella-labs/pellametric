// Integration tests for DrizzleOutcomesStore — hit a live Postgres with the
// 0001…0013 custom migrations applied. Matches the skip-pattern used in
// packages/schema/postgres/__tests__/ingest_keys_cross_tenant.test.ts:
// when DATABASE_URL is unset (local dev without docker), every test is
// skipIf'd and we emit a single pass so bun test reports the file.
//
// Tests cover:
//   1. Insert new trailer outcome — row exists with all fields round-tripped.
//   2. Duplicate insert on (org, commit, session) — no error, single row.
//   3. Same commit_sha with NULL session_id AND with non-NULL — two rows
//      (partial-unique COALESCE semantics from migration 0013).
//   4. All trailer_source enum values ('push', 'pull_request', 'reconcile')
//      round-trip correctly.
//   5. engineer_id NULL is accepted (trailer-arrived-before-mapping case).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as schema from "@bematist/schema/postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createDrizzleOutcomesStore, type DrizzleOutcomesStore } from "./drizzleOutcomesStore";
import type { OutcomeRow, TrailerSource } from "./outcomesStore";

const PG_LIVE = process.env.DATABASE_URL !== undefined;
const SUPER_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";

interface Setup {
  sql: ReturnType<typeof postgres>;
  db: PostgresJsDatabase<typeof schema>;
  store: DrizzleOutcomesStore;
  orgId: string;
}
let setup: Setup | null = null;

beforeAll(async () => {
  if (!PG_LIVE) return;
  const sql = postgres(SUPER_URL, { max: 2, idle_timeout: 5, connect_timeout: 5 });
  const db = drizzle(sql, { schema });

  // Seed a disposable org for this test file. Slug is unique + deterministic
  // so repeated runs against the same DB don't leave drift (we clean up every
  // outcomes row for this org in afterAll).
  const slug = `outcomes_ts_${Math.random().toString(36).slice(2, 10)}`;
  await sql.unsafe(`INSERT INTO orgs (slug, name) VALUES ($1, $2)`, [slug, "outcomes test"]);
  const rows = (await sql.unsafe(`SELECT id FROM orgs WHERE slug = $1`, [
    slug,
  ])) as unknown as Array<{
    id: string;
  }>;
  const orgId = rows[0]?.id;
  if (!orgId) throw new Error(`failed to seed org ${slug}`);

  const store = createDrizzleOutcomesStore(db);
  setup = { sql, db, store, orgId };
});

afterAll(async () => {
  if (!setup) return;
  try {
    await setup.sql.unsafe(`DELETE FROM outcomes WHERE org_id = $1::uuid`, [setup.orgId]);
    await setup.sql.unsafe(`DELETE FROM orgs WHERE id = $1::uuid`, [setup.orgId]);
  } catch {
    // best-effort cleanup; CI resets the DB between runs
  }
  await setup.sql.end().catch(() => {});
});

// biome-ignore lint/suspicious/noExplicitAny: bun:test exposes skipIf at runtime
const runIfPg = (test as any).skipIf ? (test as any).skipIf(!PG_LIVE) : test;

function requireSetup(): Setup {
  if (!setup) throw new Error("setup not complete — Postgres not available?");
  return setup;
}

function baseRow(over: Partial<OutcomeRow> & Pick<OutcomeRow, "commit_sha">): OutcomeRow {
  return {
    org_id: over.org_id ?? "PLACEHOLDER",
    engineer_id: over.engineer_id ?? null,
    kind: over.kind ?? "commit_landed",
    pr_number: over.pr_number ?? null,
    commit_sha: over.commit_sha,
    session_id: over.session_id ?? "sess-default",
    ai_assisted: over.ai_assisted ?? true,
    trailer_source: over.trailer_source ?? "push",
  };
}

describe("DrizzleOutcomesStore (live Postgres)", () => {
  runIfPg("insert new trailer outcome — row exists with correct fields", async () => {
    const s = requireSetup();
    const sha = `sha_insert_${Date.now()}`;
    const row = baseRow({
      org_id: s.orgId,
      commit_sha: sha,
      session_id: "sess-insert-1",
      engineer_id: null,
      pr_number: 42,
      kind: "pr_merged",
      trailer_source: "pull_request",
    });
    const res = await s.store.upsert(row);
    expect(res.inserted).toBe(true);

    const fetched = await s.store.findByCommit(s.orgId, sha, "sess-insert-1");
    expect(fetched).not.toBeNull();
    expect(fetched?.org_id).toBe(s.orgId);
    expect(fetched?.engineer_id).toBeNull();
    expect(fetched?.kind).toBe("pr_merged");
    expect(fetched?.pr_number).toBe(42);
    expect(fetched?.commit_sha).toBe(sha);
    expect(fetched?.session_id).toBe("sess-insert-1");
    expect(fetched?.ai_assisted).toBe(true);
    expect(fetched?.trailer_source).toBe("pull_request");
  });

  runIfPg(
    "duplicate insert (same org/commit/session) — no error, single row, inserted:false on retry",
    async () => {
      const s = requireSetup();
      const sha = `sha_dup_${Date.now()}`;
      const row = baseRow({
        org_id: s.orgId,
        commit_sha: sha,
        session_id: "sess-dup-1",
      });
      const first = await s.store.upsert(row);
      expect(first.inserted).toBe(true);
      const second = await s.store.upsert(row);
      expect(second.inserted).toBe(false);

      // Verify exactly one physical row via raw SQL so we're not trusting the
      // store's own count().
      const rows = (await s.sql.unsafe(
        `SELECT count(*)::int AS c FROM outcomes WHERE org_id = $1::uuid AND commit_sha = $2 AND session_id = $3`,
        [s.orgId, sha, "sess-dup-1"],
      )) as unknown as Array<{ c: number }>;
      expect(rows[0]?.c).toBe(1);
    },
  );

  runIfPg(
    "same commit_sha with NULL and non-NULL session_id → two rows (partial-unique semantics)",
    async () => {
      const s = requireSetup();
      const sha = `sha_partial_${Date.now()}`;
      // NULL session_id encoded as empty string on the interface; the store
      // writes NULL because the OutcomeRow passes through. Here we exercise
      // the storage layer directly by inserting a NULL session_id row via
      // raw SQL (mimics a legacy Layer-1 row) + a non-NULL one via the store.
      await s.sql.unsafe(
        `INSERT INTO outcomes (org_id, engineer_id, kind, commit_sha, session_id, ai_assisted, trailer_source)
         VALUES ($1::uuid, NULL, 'commit_landed', $2, NULL, false, NULL)`,
        [s.orgId, sha],
      );
      const res = await s.store.upsert(
        baseRow({
          org_id: s.orgId,
          commit_sha: sha,
          session_id: "sess-partial-1",
          trailer_source: "push",
        }),
      );
      expect(res.inserted).toBe(true);

      const rows = (await s.sql.unsafe(
        `SELECT session_id FROM outcomes WHERE org_id = $1::uuid AND commit_sha = $2 ORDER BY session_id NULLS FIRST`,
        [s.orgId, sha],
      )) as unknown as Array<{ session_id: string | null }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]?.session_id).toBeNull();
      expect(rows[1]?.session_id).toBe("sess-partial-1");
    },
  );

  runIfPg("all trailer_source enum values round-trip", async () => {
    const s = requireSetup();
    const sources: TrailerSource[] = ["push", "pull_request", "reconcile"];
    const shaBase = `sha_enum_${Date.now()}`;
    for (const src of sources) {
      const sha = `${shaBase}_${src}`;
      const res = await s.store.upsert(
        baseRow({
          org_id: s.orgId,
          commit_sha: sha,
          session_id: `sess-${src}`,
          trailer_source: src,
          kind: src === "pull_request" ? "pr_merged" : "commit_landed",
          pr_number: src === "pull_request" ? 7 : null,
        }),
      );
      expect(res.inserted).toBe(true);
      const fetched = await s.store.findByCommit(s.orgId, sha, `sess-${src}`);
      expect(fetched?.trailer_source).toBe(src);
    }
  });

  runIfPg("engineer_id NULL is accepted (trailer-arrived-before-mapping)", async () => {
    const s = requireSetup();
    const sha = `sha_engnull_${Date.now()}`;
    const res = await s.store.upsert(
      baseRow({
        org_id: s.orgId,
        commit_sha: sha,
        session_id: "sess-engnull",
        engineer_id: null,
      }),
    );
    expect(res.inserted).toBe(true);
    const fetched = await s.store.findByCommit(s.orgId, sha, "sess-engnull");
    expect(fetched?.engineer_id).toBeNull();

    // all() includes NULL-engineer rows too.
    const all = await s.store.all(s.orgId);
    const match = all.find((r) => r.commit_sha === sha && r.session_id === "sess-engnull");
    expect(match).toBeDefined();
    expect(match?.engineer_id).toBeNull();
  });

  runIfPg("count(orgId) scoped by org_id", async () => {
    const s = requireSetup();
    const before = await s.store.count(s.orgId);
    const sha = `sha_count_${Date.now()}`;
    await s.store.upsert(
      baseRow({
        org_id: s.orgId,
        commit_sha: sha,
        session_id: "sess-count-1",
      }),
    );
    const after = await s.store.count(s.orgId);
    expect(after).toBe(before + 1);
  });
});

if (!PG_LIVE) {
  test("drizzleOutcomesStore live tests skipped — DATABASE_URL not set (run via CI or docker compose -f docker-compose.dev.yml up)", () => {
    expect(true).toBe(true);
  });
}
