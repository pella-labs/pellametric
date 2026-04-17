import { afterAll, beforeEach, expect, test } from "bun:test";
import {
  alerts,
  audit_events,
  audit_log,
  developers,
  embedding_cache,
  git_events,
  ingest_keys,
  insights,
  orgs,
  outcomes,
  playbooks,
  policies,
  prompt_clusters,
  repos,
  teams,
  users,
} from "@bematist/schema/postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/bematist";
const client = postgres(url, { max: 3 });
const db = drizzle(client);

async function reset() {
  await db.execute(
    sql`TRUNCATE TABLE embedding_cache, outcomes, insights, alerts, erasure_requests, audit_events, audit_log, playbooks, prompt_clusters, ingest_keys, git_events, policies, repos, developers, teams, users, orgs RESTART IDENTITY CASCADE`,
  );
}

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await client.end();
});

test("core round-trip: orgs/users/teams/developers with team_id FK", async () => {
  const [org] = await db.insert(orgs).values({ slug: "rt", name: "Round Trip" }).returning();
  const [user] = await db
    .insert(users)
    .values({ org_id: org.id, sso_subject: "sub_rt", email: "rt@rt.test" })
    .returning();
  const [team] = await db.insert(teams).values({ org_id: org.id, name: "Platform" }).returning();
  const [dev] = await db
    .insert(developers)
    .values({ org_id: org.id, user_id: user.id, team_id: team.id, stable_hash: "eng_rt" })
    .returning();
  expect(dev.team_id).toBe(team.id);
});

test("repos + policies + git_events + ingest_keys round-trip", async () => {
  const [org] = await db.insert(orgs).values({ slug: "rt2", name: "RT2" }).returning();
  const [user] = await db
    .insert(users)
    .values({ org_id: org.id, sso_subject: "sub_2", email: "rt2@rt.test" })
    .returning();
  const [repo] = await db
    .insert(repos)
    .values({ org_id: org.id, repo_id_hash: "rhash_1", provider: "github" })
    .returning();
  await db.insert(policies).values({ org_id: org.id });
  await db.insert(git_events).values({
    org_id: org.id,
    repo_id: repo.id,
    kind: "pr",
    commit_sha: "abc",
    pr_number: 1,
  });
  await db.insert(ingest_keys).values({
    org_id: org.id,
    key_prefix: "dm_rt2",
    hashed_secret: "xxx",
    created_by: user.id,
  });
  const p = await db.select().from(policies).where(eq(policies.org_id, org.id));
  expect(p[0].tier_default).toBe("B");
});

test("playbooks + prompt_clusters + audit_events + alerts + insights + outcomes round-trip", async () => {
  const [org] = await db.insert(orgs).values({ slug: "rt3", name: "RT3" }).returning();
  const [user] = await db
    .insert(users)
    .values({ org_id: org.id, sso_subject: "sub_3", email: "rt3@rt.test" })
    .returning();
  const [cluster] = await db
    .insert(prompt_clusters)
    .values({ org_id: org.id, centroid: [0.1, 0.2, 0.3], dim: 3, model: "test" })
    .returning();
  await db.insert(playbooks).values({
    org_id: org.id,
    cluster_id: cluster.id,
    session_id: "s1",
    abstract: "test abstract",
    promoted_by: user.id,
  });
  await db.insert(audit_events).values({
    actor_user_id: user.id,
    target_engineer_id_hash: "eh_1",
    surface: "engineer_page",
  });
  await db.insert(alerts).values({
    org_id: org.id,
    kind: "anomaly",
    signal: "token_spike",
    value: 5,
    threshold: 3,
  });
  await db.insert(insights).values({
    org_id: org.id,
    week: "2026-W15",
    confidence: "high",
  });
  await db.insert(outcomes).values({
    org_id: org.id,
    engineer_id: "eng_rt3",
    kind: "pr_merged",
    pr_number: 10,
    ai_assisted: true,
  });
  const counts = await db.execute(sql`
    SELECT (SELECT count(*) FROM playbooks) AS p,
           (SELECT count(*) FROM prompt_clusters) AS c,
           (SELECT count(*) FROM audit_events) AS ae,
           (SELECT count(*) FROM alerts) AS a,
           (SELECT count(*) FROM insights) AS i,
           (SELECT count(*) FROM outcomes) AS o
  `);
  expect(Number((counts as unknown as { p: string }[])[0].p)).toBe(1);
});

test("embedding_cache upsert pattern", async () => {
  await db.insert(embedding_cache).values({
    cache_key: "sha256_xyz",
    provider: "openai",
    model: "text-embedding-3-small",
    dim: 512,
    vector: Array.from({ length: 512 }, (_, i) => i / 512),
  });
  const rows = await db.select().from(embedding_cache);
  expect(rows).toHaveLength(1);
  expect(rows[0].dim).toBe(512);
  expect(rows[0].vector).toHaveLength(512);
});

test("audit_log: INSERT works, UPDATE throws, DELETE throws (contract 09 invariant 6)", async () => {
  const [org] = await db.insert(orgs).values({ slug: "al", name: "AL" }).returning();
  const [user] = await db
    .insert(users)
    .values({ org_id: org.id, sso_subject: "sub_al", email: "al@al.test" })
    .returning();
  const [row] = await db
    .insert(audit_log)
    .values({
      actor_user_id: user.id,
      action: "test_action",
      target_type: "session",
      target_id: "s_test",
    })
    .returning();
  expect(row.action).toBe("test_action");

  await expect(async () => {
    await db.update(audit_log).set({ action: "mutated" }).where(eq(audit_log.id, row.id));
  }).toThrow(/append-only/i);

  await expect(async () => {
    await db.delete(audit_log).where(eq(audit_log.id, row.id));
  }).toThrow(/append-only/i);

  // After failed mutations, row is intact
  const still = await db.select().from(audit_log).where(eq(audit_log.id, row.id));
  expect(still[0].action).toBe("test_action");
});
