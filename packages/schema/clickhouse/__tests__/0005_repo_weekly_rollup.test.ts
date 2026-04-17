import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("repo_weekly_rollup exists with AggregatingMergeTree inner engine", async () => {
  const rows = await query<{ engine: string }>(
    client,
    `SELECT inner.engine AS engine
     FROM system.tables AS v
     INNER JOIN system.tables AS inner ON ('.inner_id.' || toString(v.uuid)) = inner.name
     WHERE v.database = 'bematist' AND v.name = 'repo_weekly_rollup'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.engine).toBe("AggregatingMergeTree");
});

test("events without repo_id_hash are excluded", async () => {
  await insertEvents(client, [
    {
      client_event_id: "eeeeeeee-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      input_tokens: 100,
      repo_id_hash: "repo_x",
    },
    {
      client_event_id: "eeeeeeee-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
      input_tokens: 200,
      repo_id_hash: null,
    },
  ]);
  const out = await query<{ tokens: number }>(
    client,
    `SELECT toUInt32(sumMerge(input_tokens_state)) AS tokens FROM repo_weekly_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0]?.tokens)).toBe(100);
});

test("prs_state counts only non-null distinct pr_number", async () => {
  await insertEvents(client, [
    {
      client_event_id: "ffffffff-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      repo_id_hash: "repo_x",
      pr_number: 101,
    },
    {
      client_event_id: "ffffffff-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
      repo_id_hash: "repo_x",
      pr_number: 102,
    },
    {
      client_event_id: "ffffffff-0000-0000-0000-000000000003",
      ts: "2026-04-01T10:00:02.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 2,
      repo_id_hash: "repo_x",
      pr_number: 101,
    },
    {
      client_event_id: "ffffffff-0000-0000-0000-000000000004",
      ts: "2026-04-01T10:00:03.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 3,
      repo_id_hash: "repo_x",
      pr_number: null,
    },
  ]);
  const out = await query<{ prs: number }>(
    client,
    `SELECT toUInt32(uniqMerge(prs_state)) AS prs FROM repo_weekly_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0]?.prs)).toBe(2);
});

test("commits_state counts distinct commit_sha per repo-week", async () => {
  await insertEvents(client, [
    {
      client_event_id: "99999999-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      repo_id_hash: "repo_x",
      commit_sha: "abc123",
    },
    {
      client_event_id: "99999999-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
      repo_id_hash: "repo_x",
      commit_sha: "abc123",
    },
    {
      client_event_id: "99999999-0000-0000-0000-000000000003",
      ts: "2026-04-01T10:00:02.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 2,
      repo_id_hash: "repo_x",
      commit_sha: "def456",
    },
  ]);
  const out = await query<{ commits: number }>(
    client,
    `SELECT toUInt32(uniqMerge(commits_state)) AS commits FROM repo_weekly_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0]?.commits)).toBe(2);
});
