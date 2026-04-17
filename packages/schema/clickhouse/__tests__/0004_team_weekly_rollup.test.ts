import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("team_weekly_rollup exists with AggregatingMergeTree inner engine", async () => {
  const rows = await query<{ engine: string }>(
    client,
    `SELECT inner.engine AS engine
     FROM system.tables AS v
     INNER JOIN system.tables AS inner ON ('.inner_id.' || toString(v.uuid)) = inner.name
     WHERE v.database = 'bematist' AND v.name = 'team_weekly_rollup'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.engine).toBe("AggregatingMergeTree");
});

test("dev_team_dict dictionary is registered", async () => {
  const rows = await query<{ name: string }>(
    client,
    `SELECT name FROM system.dictionaries WHERE name = 'dev_team_dict'`,
  );
  expect(rows).toHaveLength(1);
});

test("team_id is NULL when dev is not in dictionary; weeks bucket by Monday UTC", async () => {
  // Monday 2026-03-30, midweek 2026-04-01 (same week), next Monday 2026-04-06
  await insertEvents(client, [
    {
      client_event_id: "dddddddd-0000-0000-0000-000000000001",
      ts: "2026-03-30T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_unknown",
      session_id: "s1",
      event_seq: 0,
      input_tokens: 10,
    },
    {
      client_event_id: "dddddddd-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_unknown",
      session_id: "s2",
      event_seq: 0,
      input_tokens: 20,
    },
    {
      client_event_id: "dddddddd-0000-0000-0000-000000000003",
      ts: "2026-04-06T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_unknown",
      session_id: "s3",
      event_seq: 0,
      input_tokens: 40,
    },
  ]);
  const out = await query<{ team_id: string | null; week: string; tokens: number }>(
    client,
    `SELECT team_id, toString(week) AS week, toUInt32(sumMerge(input_tokens_state)) AS tokens
     FROM team_weekly_rollup
     WHERE org_id = 'org_a'
     GROUP BY team_id, week
     ORDER BY week`,
  );
  expect(out).toHaveLength(2);
  expect(out[0]).toEqual({ team_id: null, week: "2026-03-30", tokens: 30 });
  expect(out[1]).toEqual({ team_id: null, week: "2026-04-06", tokens: 40 });
});
