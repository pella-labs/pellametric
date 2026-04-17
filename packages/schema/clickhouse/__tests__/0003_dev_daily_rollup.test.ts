import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("dev_daily_rollup exists with AggregatingMergeTree inner engine", async () => {
  // CH MVs report engine='MaterializedView' on the user-facing view; the storage
  // engine lives on the hidden .inner_id.<uuid> table. Join via system.tables uuid.
  const rows = await query<{ engine: string }>(
    client,
    `SELECT inner.engine AS engine
     FROM system.tables AS v
     INNER JOIN system.tables AS inner ON ('.inner_id.' || toString(v.uuid)) = inner.name
     WHERE v.database = 'bematist' AND v.name = 'dev_daily_rollup'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.engine).toBe("AggregatingMergeTree");
});

test("sumMerge(input_tokens_state) equals SUM(input_tokens) across 10 events", async () => {
  const base = "2026-04-01T10:00:00.000Z";
  const rows = Array.from({ length: 10 }, (_, i) => ({
    client_event_id: `ev${i.toString().padStart(2, "0")}0000-0000-0000-0000-000000000000`,
    ts: base,
    org_id: "org_a",
    engineer_id: "eng_1",
    session_id: "s1",
    event_seq: i,
    input_tokens: 100 * (i + 1),
    output_tokens: 50,
    cost_usd: 0.01,
  }));
  await insertEvents(client, rows);
  const out = await query<{ tokens: string }>(
    client,
    `SELECT sumMerge(input_tokens_state) AS tokens FROM dev_daily_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0]?.tokens)).toBe(5500);
});

test("uniqMerge(sessions_state) counts distinct sessions per engineer per day", async () => {
  await insertEvents(client, [
    {
      client_event_id: "aaaaaaaa-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
    },
    {
      client_event_id: "aaaaaaaa-0000-0000-0000-000000000002",
      ts: "2026-04-01T11:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
    },
    {
      client_event_id: "aaaaaaaa-0000-0000-0000-000000000003",
      ts: "2026-04-01T12:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s2",
      event_seq: 0,
    },
    {
      client_event_id: "aaaaaaaa-0000-0000-0000-000000000004",
      ts: "2026-04-01T13:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_2",
      session_id: "s3",
      event_seq: 0,
    },
  ]);
  const out = await query<{ engineer_id: string; sessions: number }>(
    client,
    `SELECT engineer_id, toUInt32(uniqMerge(sessions_state)) AS sessions FROM dev_daily_rollup WHERE org_id = 'org_a' GROUP BY engineer_id ORDER BY engineer_id`,
  );
  expect(out).toEqual([
    { engineer_id: "eng_1", sessions: 2 },
    { engineer_id: "eng_2", sessions: 1 },
  ]);
});

test("accepted_edits_state counts only code_edit_decision accept events", async () => {
  await insertEvents(client, [
    {
      client_event_id: "bbbbbbbb-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      event_kind: "code_edit_decision",
      edit_decision: "accept",
    },
    {
      client_event_id: "bbbbbbbb-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
      event_kind: "code_edit_decision",
      edit_decision: "accept",
    },
    {
      client_event_id: "bbbbbbbb-0000-0000-0000-000000000003",
      ts: "2026-04-01T10:00:02.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 2,
      event_kind: "code_edit_decision",
      edit_decision: "accept",
    },
    {
      client_event_id: "bbbbbbbb-0000-0000-0000-000000000004",
      ts: "2026-04-01T10:00:03.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 3,
      event_kind: "code_edit_decision",
      edit_decision: "reject",
    },
    {
      client_event_id: "bbbbbbbb-0000-0000-0000-000000000005",
      ts: "2026-04-01T10:00:04.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 4,
      event_kind: "llm_request",
    },
  ]);
  const out = await query<{ accepted: string }>(
    client,
    `SELECT countIfMerge(accepted_edits_state) AS accepted FROM dev_daily_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0]?.accepted)).toBe(3);
});

test("accepted_retained_edits_state excludes revert_within_24h=1", async () => {
  await insertEvents(client, [
    {
      client_event_id: "cccccccc-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      event_kind: "code_edit_decision",
      edit_decision: "accept",
      revert_within_24h: 0,
    },
    {
      client_event_id: "cccccccc-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
      event_kind: "code_edit_decision",
      edit_decision: "accept",
      revert_within_24h: 0,
    },
    {
      client_event_id: "cccccccc-0000-0000-0000-000000000003",
      ts: "2026-04-01T10:00:02.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 2,
      event_kind: "code_edit_decision",
      edit_decision: "accept",
      revert_within_24h: 1,
    },
  ]);
  const out = await query<{ accepted: string; retained: string }>(
    client,
    `SELECT countIfMerge(accepted_edits_state) AS accepted, countIfMerge(accepted_retained_edits_state) AS retained FROM dev_daily_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0]?.accepted)).toBe(3);
  expect(Number(out[0]?.retained)).toBe(2);
});
