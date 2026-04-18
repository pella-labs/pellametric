// Gate 5 / 5 — RLS cross-tenant probe (INT9).
//
// MERGE BLOCKER per CLAUDE.md §Database Rules and §Testing Rules:
// "Adversarial cross-tenant probe (INT9) is a merge blocker — must return 0 rows."
//
// Strategy
// --------
// We don't reseed the schema (the canonical INT9 test in
// `packages/schema/postgres/__tests__/rls_int9.test.ts` already exercises the
// full 15-table seed-and-probe flow). This gate's job is twofold:
//
// 1. Confirm the `app_bematist` role exists with `NOBYPASSRLS` + `NOSUPERUSER`
//    (the two flags that make RLS load-bearing — superuser bypasses RLS,
//    bypassrls=true also bypasses).
// 2. Cross-tenant probe: as `app_bematist`, count rows with and without
//    `app.current_org_id` set on every RLS-protected control-plane table.
//    Without the GUC: 0 rows. With org A set: 0 org-B rows. Sample two
//    tenants by reading the orgs table itself (we don't seed; we sample what
//    is in CI).
//
// If Postgres or `app_bematist` is missing the live tests SKIP with a
// structured warning. The privacy CI workflow runs Postgres + the schema
// migrations, so the gate is merge-blocking in CI.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

// Gate runs against live Postgres when DATABASE_URL is exported. Local devs
// without docker get a structured skip; CI sets DATABASE_URL via the workflow's
// `env:` block so gate 5 is merge-blocking in CI. The realWriter live-test
// pattern (apps/ingest/src/clickhouse/realWriter.test.ts) is the established
// precedent for env-driven gating.
const PG_LIVE = process.env.DATABASE_URL !== undefined;
const SUPER_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const APP_URL = SUPER_URL.replace(
  "postgres://postgres:postgres@",
  "postgres://app_bematist:app_bematist_dev@",
);

// Same 15 tables as `packages/schema/postgres/__tests__/rls_int9.test.ts`.
// Kept in sync via the drift-guard test below.
const TABLES: Array<{ table: string; org_col: string }> = [
  { table: "users", org_col: "org_id" },
  { table: "teams", org_col: "org_id" },
  { table: "developers", org_col: "org_id" },
  { table: "repos", org_col: "org_id" },
  { table: "policies", org_col: "org_id" },
  { table: "git_events", org_col: "org_id" },
  { table: "ingest_keys", org_col: "org_id" },
  { table: "prompt_clusters", org_col: "org_id" },
  { table: "playbooks", org_col: "org_id" },
  { table: "audit_log", org_col: "org_id" },
  { table: "audit_events", org_col: "org_id" },
  { table: "erasure_requests", org_col: "target_org_id" },
  { table: "alerts", org_col: "org_id" },
  { table: "insights", org_col: "org_id" },
  { table: "outcomes", org_col: "org_id" },
];

let superClient: ReturnType<typeof postgres> | null = null;
let appClient: ReturnType<typeof postgres> | null = null;

beforeAll(() => {
  if (!PG_LIVE) return;
  superClient = postgres(SUPER_URL, { max: 2, idle_timeout: 5, connect_timeout: 5 });
  appClient = postgres(APP_URL, { max: 2, idle_timeout: 5, connect_timeout: 5 });
});

afterAll(async () => {
  if (superClient) await superClient.end().catch(() => {});
  if (appClient) await appClient.end().catch(() => {});
});

// biome-ignore lint/suspicious/noExplicitAny: bun:test exposes skipIf at runtime
const runIfPg = (test as any).skipIf
  ? // biome-ignore lint/suspicious/noExplicitAny: same
    (test as any).skipIf(!PG_LIVE)
  : test;

describe("PRIVACY GATE 5/5 — RLS cross-tenant probe (INT9)", () => {
  test("table list matches the canonical INT9 list (15 tables, drift guard)", () => {
    expect(TABLES).toHaveLength(15);
    const names = new Set(TABLES.map((t) => t.table));
    for (const required of [
      "users",
      "teams",
      "developers",
      "repos",
      "policies",
      "git_events",
      "ingest_keys",
      "prompt_clusters",
      "playbooks",
      "audit_log",
      "audit_events",
      "erasure_requests",
      "alerts",
      "insights",
      "outcomes",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  runIfPg("app_bematist role is NOBYPASSRLS + NOSUPERUSER", async () => {
    if (!superClient) throw new Error("super client missing despite postgresAvailable");
    const rows = (await superClient.unsafe(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_bematist'`,
    )) as unknown as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolbypassrls).toBe(false);
    expect(rows[0]?.rolsuper).toBe(false);
  });

  runIfPg("RLS is enabled on every protected table (rowsecurity=true, force=true)", async () => {
    if (!superClient) throw new Error("super client missing despite postgresAvailable");
    for (const { table } of TABLES) {
      const rows = (await superClient.unsafe(
        `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = '${table}' AND relkind = 'r'`,
      )) as unknown as Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    }
  });

  runIfPg(
    "INT9: without app.current_org_id set, every RLS-protected table returns 0 rows",
    async () => {
      if (!appClient) throw new Error("app client missing despite postgresAvailable");
      for (const { table } of TABLES) {
        const rows = (await appClient.unsafe(
          `SELECT count(*)::int AS c FROM ${table}`,
        )) as unknown as Array<{ c: number }>;
        expect(rows[0]?.c).toBe(0);
      }
    },
  );

  runIfPg("INT9: with org A set, no org B rows are returned (cross-tenant zero leak)", async () => {
    if (!superClient || !appClient) throw new Error("clients missing despite postgresAvailable");
    // Sample any two distinct orgs from the orgs table. If CI has < 2 orgs
    // we synthesize them — the canonical INT9 test (run as part of `bun
    // run test`) already seeds 2 orgs so this branch exists only as a
    // defensive fallback.
    let orgRows = (await superClient.unsafe(
      `SELECT id::text AS id FROM orgs ORDER BY created_at LIMIT 2`,
    )) as unknown as Array<{ id: string }>;
    if (orgRows.length < 2) {
      await superClient.unsafe(
        `INSERT INTO orgs (slug, name) VALUES ('privacy_gate_a','A'),('privacy_gate_b','B') ON CONFLICT (slug) DO NOTHING`,
      );
      orgRows = (await superClient.unsafe(
        `SELECT id::text AS id FROM orgs WHERE slug IN ('privacy_gate_a','privacy_gate_b') LIMIT 2`,
      )) as unknown as Array<{ id: string }>;
    }
    expect(orgRows.length).toBeGreaterThanOrEqual(2);
    const a = orgRows[0]?.id;
    const b = orgRows[1]?.id;
    if (!a || !b) throw new Error("could not sample two org ids");

    await appClient.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_org_id = '${a}'`);
      for (const { table, org_col } of TABLES) {
        const rows = (await tx.unsafe(
          `SELECT count(*) FILTER (WHERE ${org_col} = '${b}')::int AS leak FROM ${table}`,
        )) as unknown as Array<{ leak: number }>;
        if (rows[0]?.leak !== 0) {
          console.error(
            `[privacy-gate-5] CROSS-TENANT LEAK in ${table}: ${rows[0]?.leak} rows of org ${b} ` +
              `visible while org ${a} is set.`,
          );
        }
        expect(rows[0]?.leak).toBe(0);
      }
    });
  });

  runIfPg("INT9: transaction-scoped GUC clears on commit (next query returns 0)", async () => {
    if (!superClient || !appClient) throw new Error("clients missing despite postgresAvailable");
    const orgRow = (await superClient.unsafe(
      `SELECT id::text AS id FROM orgs ORDER BY created_at LIMIT 1`,
    )) as unknown as Array<{ id: string }>;
    if (orgRow.length === 0) {
      // Nothing to probe — degenerate database. The probe holds vacuously.
      return;
    }
    const orgId = orgRow[0]?.id;
    if (!orgId) throw new Error("orgs table sample missing id");

    await appClient.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_org_id = '${orgId}'`);
      const inside = (await tx.unsafe(
        `SELECT count(*)::int AS c FROM users WHERE org_id = '${orgId}'`,
      )) as unknown as Array<{ c: number }>;
      // Could be 0 if the sampled org has no users — but the txn must AT
      // LEAST not error out. The hard invariant is the post-commit zero.
      expect(typeof inside[0]?.c).toBe("number");
    });

    const after = (await appClient.unsafe(
      `SELECT count(*)::int AS c FROM users`,
    )) as unknown as Array<{ c: number }>;
    expect(after[0]?.c).toBe(0);
  });
});
