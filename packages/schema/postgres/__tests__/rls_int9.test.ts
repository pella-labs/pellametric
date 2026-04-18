// INT9 adversarial cross-tenant probe. Contract 09 invariant 4: any query
// without `app.current_org_id` set returns 0 rows; any query with org A set
// never returns org B rows. MERGE BLOCKER.
//
// Strategy:
//   - Admin (superuser) seeds two orgs' data — postgres bypasses RLS.
//   - Adversarial connections use the app_bematist role (NOBYPASSRLS).
//   - Probe all 15 RLS-protected tables.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  alerts,
  audit_events,
  audit_log,
  developers,
  erasure_requests,
  gitEvents,
  ingestKeys,
  insights,
  orgs,
  outcomes,
  playbooks,
  policies,
  prompt_clusters,
  repos,
  teams,
  users,
} from "../schema";

// This file TRUNCATEs every RLS-protected table CASCADE. Running it against a
// shared dev database wipes the real org, users, developers, ingest keys, and
// policies — discovered after it nuked the M4 Tailscale rehearsal org. Gate on
// an explicit opt-in env var — CI sets `PG_INTEGRATION_TESTS=1` with a
// dedicated disposable Postgres service; local `bun run test` leaves it unset
// so a dev's running stack isn't wiped out from under them.
const RUN_INTEGRATION = process.env.PG_INTEGRATION_TESTS === "1";
const testIf = RUN_INTEGRATION ? test : test.skip;

const superUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const appUrl = superUrl.replace(
  "postgres://postgres:postgres@",
  "postgres://app_bematist:app_bematist_dev@",
);

const superClient = postgres(superUrl, { max: 3 });
const superDb = drizzle(superClient);
const appClient = postgres(appUrl, { max: 3 });

let orgA: { id: string };
let orgB: { id: string };

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

function must<T>(value: T | undefined, label = "expected non-empty value"): T {
  if (value === undefined) throw new Error(label);
  return value;
}

beforeAll(async () => {
  if (!RUN_INTEGRATION) return;
  await superDb.execute(
    sql`TRUNCATE TABLE outcomes, insights, alerts, erasure_requests, audit_events, audit_log, playbooks, prompt_clusters, ingest_keys, git_events, policies, repos, developers, teams, users, orgs RESTART IDENTITY CASCADE`,
  );

  orgA = must((await superDb.insert(orgs).values({ slug: "orgA", name: "A" }).returning())[0]);
  orgB = must((await superDb.insert(orgs).values({ slug: "orgB", name: "B" }).returning())[0]);

  async function seedOrg(org: { id: string }, tag: string) {
    const u = must(
      (
        await superDb
          .insert(users)
          .values({ org_id: org.id, sso_subject: `sub_${tag}`, email: `${tag}@x.test` })
          .returning()
      )[0],
    );
    const team = must(
      (
        await superDb
          .insert(teams)
          .values({ org_id: org.id, name: `team_${tag}` })
          .returning()
      )[0],
    );
    await superDb
      .insert(developers)
      .values({ org_id: org.id, user_id: u.id, team_id: team.id, stable_hash: `eng_${tag}` });
    await superDb
      .insert(repos)
      .values({ org_id: org.id, repo_id_hash: `rh_${tag}`, provider: "github" });
    await superDb.insert(policies).values({ org_id: org.id });
    await superDb.insert(gitEvents).values({
      org_id: org.id,
      source: "github",
      event_kind: "pull_request",
      pr_node_id: `pr_node_${tag}`,
      repo_id: `rh_${tag}`,
      pr_number: 1,
      payload: {},
    });
    await superDb.insert(ingestKeys).values({
      id: `bm_${tag}_key1`,
      org_id: org.id,
      name: `key-${tag}`,
      key_sha256: `sha_${tag}`,
    });
    const cluster = must(
      (
        await superDb
          .insert(prompt_clusters)
          .values({ org_id: org.id, centroid: [0.1], dim: 1, model: "m" })
          .returning()
      )[0],
    );
    await superDb.insert(playbooks).values({
      org_id: org.id,
      cluster_id: cluster.id,
      session_id: `s_${tag}`,
      abstract: "x",
      promoted_by: u.id,
    });
    await superDb.insert(audit_log).values({
      org_id: org.id,
      actor_user_id: u.id,
      action: "seed",
      target_type: "test",
      target_id: tag,
    });
    await superDb.insert(audit_events).values({
      org_id: org.id,
      actor_user_id: u.id,
      target_engineer_id_hash: `eh_${tag}`,
      surface: "engineer_page",
    });
    await superDb.insert(erasure_requests).values({
      requester_user_id: u.id,
      target_engineer_id: `eng_${tag}`,
      target_org_id: org.id,
    });
    await superDb
      .insert(alerts)
      .values({ org_id: org.id, kind: "k", signal: "s", value: 1, threshold: 0.5 });
    await superDb.insert(insights).values({ org_id: org.id, week: "2026-W15", confidence: "high" });
    await superDb
      .insert(outcomes)
      .values({ org_id: org.id, engineer_id: `eng_${tag}`, kind: "pr_merged" });
  }

  await seedOrg(orgA, "a");
  await seedOrg(orgB, "b");
});

afterAll(async () => {
  await superClient.end();
  await appClient.end();
});

testIf("app_bematist role exists and is NOBYPASSRLS + NOSUPERUSER", async () => {
  const rows = (await superClient.unsafe(
    `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_bematist'`,
  )) as unknown as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.rolbypassrls).toBe(false);
  expect(rows[0]?.rolsuper).toBe(false);
});

testIf("INT9: without app.current_org_id set, every RLS-protected table returns 0 rows", async () => {
  for (const { table } of TABLES) {
    const rows = (await appClient.unsafe(
      `SELECT count(*)::int AS c FROM ${table}`,
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]?.c).toBe(0);
  }
});

testIf("INT9: with org A set, tables return ONLY org A rows (zero leak from org B)", async () => {
  await appClient.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_org_id = '${orgA.id}'`);
    for (const { table, org_col } of TABLES) {
      const rows = (await tx.unsafe(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ${org_col} = '${orgA.id}')::int AS a_rows,
                count(*) FILTER (WHERE ${org_col} = '${orgB.id}')::int AS b_rows
         FROM ${table}`,
      )) as unknown as Array<{ total: number; a_rows: number; b_rows: number }>;
      const r = rows[0];
      if (!r) throw new Error(`empty row from ${table}`);
      expect(r.total).toBeGreaterThan(0);
      expect(r.b_rows).toBe(0);
      expect(r.a_rows).toBe(r.total);
    }
  });
});

testIf("INT9: with org B set, tables return ONLY org B rows (zero leak from org A)", async () => {
  await appClient.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_org_id = '${orgB.id}'`);
    for (const { table, org_col } of TABLES) {
      const rows = (await tx.unsafe(
        `SELECT count(*) FILTER (WHERE ${org_col} = '${orgA.id}')::int AS a_leak FROM ${table}`,
      )) as unknown as Array<{ a_leak: number }>;
      expect(rows[0]?.a_leak).toBe(0);
    }
  });
});

testIf("INT9: transaction-scoped setting releases on commit (next query returns 0)", async () => {
  // Inside txn with org A set — should see rows
  await appClient.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.current_org_id = '${orgA.id}'`);
    const rows = (await tx.unsafe(`SELECT count(*)::int AS c FROM users`)) as unknown as Array<{
      c: number;
    }>;
    expect(rows[0]?.c).toBeGreaterThan(0);
  });
  // After txn commits, a fresh connection state — setting is gone
  const rows = (await appClient.unsafe(
    `SELECT count(*)::int AS c FROM users`,
  )) as unknown as Array<{ c: number }>;
  expect(rows[0]?.c).toBe(0);
});
