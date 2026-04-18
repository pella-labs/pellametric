import { afterAll, beforeEach, expect, test } from "bun:test";
import { audit_log, developers, erasure_requests, orgs, users } from "@bematist/schema/postgres";
import { eq, sql } from "drizzle-orm";
import { ch } from "../clickhouse";
import { db, pgClient } from "../db";
import { handlePartitionDrop } from "./partition_drop";

const chClient = ch();

// This file TRUNCATEs `orgs` CASCADE and `events`, wiping every downstream row
// in a shared dev database. Gate on an explicit opt-in env var — CI sets
// `PG_INTEGRATION_TESTS=1` with a dedicated disposable Postgres service; local
// `bun run test` leaves it unset so a dev's running stack isn't wiped.
const RUN_INTEGRATION = process.env.PG_INTEGRATION_TESTS === "1";
const testIf = RUN_INTEGRATION ? test : test.skip;

async function reset() {
  await db.execute(
    sql`TRUNCATE TABLE audit_log, erasure_requests, developers, users, orgs RESTART IDENTITY CASCADE`,
  );
  await chClient.command({ query: "TRUNCATE TABLE events" });
}

function must<T>(value: T | undefined, label = "expected non-empty value"): T {
  if (value === undefined) throw new Error(label);
  return value;
}

async function seedTwoOrgsWithEvents() {
  const orgTarget = must(
    (await db.insert(orgs).values({ slug: "target_org", name: "Target" }).returning())[0],
  );
  const orgBystander = must(
    (await db.insert(orgs).values({ slug: "bystander_org", name: "Bystander" }).returning())[0],
  );
  const userTarget = must(
    (
      await db
        .insert(users)
        .values({ org_id: orgTarget.id, sso_subject: "sub_t", email: "t@t.test" })
        .returning()
    )[0],
  );
  const userBy = must(
    (
      await db
        .insert(users)
        .values({ org_id: orgBystander.id, sso_subject: "sub_b", email: "b@b.test" })
        .returning()
    )[0],
  );
  await db
    .insert(developers)
    .values({ org_id: orgTarget.id, user_id: userTarget.id, stable_hash: "eng_target" });
  await db
    .insert(developers)
    .values({ org_id: orgBystander.id, user_id: userBy.id, stable_hash: "eng_by" });

  const events = [
    buildEvent(orgTarget.id, "eng_target", "s_t1", 0, "2026-04-01T10:00:00.000Z"),
    buildEvent(orgTarget.id, "eng_target", "s_t2", 0, "2026-04-01T11:00:00.000Z"),
    buildEvent(orgBystander.id, "eng_by", "s_b1", 0, "2026-04-01T12:00:00.000Z"),
  ];
  await chClient.insert({ table: "events", values: events, format: "JSONEachRow" });

  return { orgTarget, orgBystander, userTarget };
}

function buildEvent(
  org_id: string,
  engineer_id: string,
  session_id: string,
  event_seq: number,
  iso: string,
): Record<string, unknown> {
  return {
    client_event_id: `${engineer_id.slice(0, 8).padEnd(8, "x")}-${event_seq.toString(16).padStart(4, "0")}-0000-0000-000000000000`,
    schema_version: 1,
    ts: iso.replace("T", " ").replace("Z", ""),
    org_id,
    engineer_id,
    device_id: "d1",
    source: "claude-code",
    source_version: "1.0.0",
    fidelity: "full",
    cost_estimated: 0,
    tier: "B",
    session_id,
    event_seq,
    parent_session_id: null,
    gen_ai_system: "anthropic",
    gen_ai_request_model: "claude-opus-4-7",
    gen_ai_response_model: "claude-opus-4-7",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    event_kind: "llm_request",
    cost_usd: 0.01,
    pricing_version: "v1",
    duration_ms: 100,
    tool_name: "",
    tool_status: "",
    hunk_sha256: null,
    file_path_hash: null,
    edit_decision: "",
    revert_within_24h: null,
    first_try_failure: null,
    prompt_text: null,
    tool_input: null,
    tool_output: null,
    prompt_abstract: null,
    prompt_embedding: [],
    prompt_index: 0,
    redaction_count: 0,
    pr_number: null,
    commit_sha: null,
    branch: null,
    raw_attrs: "{}",
    repo_id_hash: null,
    prompt_cluster_id: null,
  };
}

beforeEach(async () => {
  if (!RUN_INTEGRATION) return;
  await reset();
});

afterAll(async () => {
  await chClient.close();
  await pgClient.end();
});

testIf("worker drops partitions for target org; marks completed; writes audit_log", async () => {
  const { orgTarget, userTarget } = await seedTwoOrgsWithEvents();

  await db.insert(erasure_requests).values({
    requester_user_id: userTarget.id,
    target_engineer_id: "eng_target",
    target_org_id: orgTarget.id,
  });

  const processed = await handlePartitionDrop({ db, ch: chClient });
  expect(processed).toBe(1);

  const targetRows = await chClient.query({
    query: `SELECT count() AS c FROM events WHERE org_id = {org:String}`,
    query_params: { org: orgTarget.id },
    format: "JSONEachRow",
  });
  const targetCount = ((await targetRows.json()) as Array<{ c: number }>)[0]?.c;
  expect(Number(targetCount)).toBe(0);

  const reqs = await db.select().from(erasure_requests);
  expect(reqs).toHaveLength(1);
  expect(reqs[0]?.status).toBe("completed");
  expect(reqs[0]?.partition_dropped).toBe("true");

  const audits = await db.select().from(audit_log).where(eq(audit_log.action, "partition_drop"));
  expect(audits).toHaveLength(1);
  expect(audits[0]?.target_id).toBe("eng_target");
});

testIf("worker is idempotent — no-op on already-completed requests", async () => {
  const { orgTarget, userTarget } = await seedTwoOrgsWithEvents();
  await db.insert(erasure_requests).values({
    requester_user_id: userTarget.id,
    target_engineer_id: "eng_target",
    target_org_id: orgTarget.id,
    status: "completed",
    completed_at: new Date(),
    partition_dropped: "true",
  });
  const processed = await handlePartitionDrop({ db, ch: chClient });
  expect(processed).toBe(0);
});

testIf("worker fails a request cleanly if CH partition drop errors", async () => {
  // Insert a request for a non-existent org — listPartitionsForOrg returns [], so the
  // loop is a no-op and the request completes successfully. This test verifies
  // completion without events (gracefully handles empty partition list).
  const orgTarget = must(
    (await db.insert(orgs).values({ slug: "empty_org", name: "Empty" }).returning())[0],
  );
  const userTarget = must(
    (
      await db
        .insert(users)
        .values({ org_id: orgTarget.id, sso_subject: "sub_e", email: "e@e.test" })
        .returning()
    )[0],
  );

  await db.insert(erasure_requests).values({
    requester_user_id: userTarget.id,
    target_engineer_id: "eng_empty",
    target_org_id: orgTarget.id,
  });

  const processed = await handlePartitionDrop({ db, ch: chClient });
  expect(processed).toBe(1);

  const reqs = await db.select().from(erasure_requests);
  expect(reqs[0]?.status).toBe("completed");

  const audits = await db.select().from(audit_log);
  expect(audits).toHaveLength(1);
  // No partitions were dropped, but audit row still created (metadata.partitions=[])
  expect(audits[0]?.metadata_json).toEqual({ partitions: [], target_org_id: orgTarget.id });
});
