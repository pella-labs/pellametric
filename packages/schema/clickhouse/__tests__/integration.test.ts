import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState, type TestEvent } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("empty-cohort org returns 0 rows from dev_daily_rollup (not NULL row)", async () => {
  const rows = await query<{ c: number }>(
    client,
    `SELECT count() AS c FROM dev_daily_rollup WHERE org_id = 'org_never_written'`,
  );
  expect(Number(rows[0]?.c)).toBe(0);
});

test("property: sumMerge(input_tokens_state) equals naive SUM over 200 random rows", async () => {
  let state = 0x1337;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
  // Each event gets a unique (ts, engineer_id) tuple so ReplacingMergeTree
  // on `events` (ORDER BY org_id, ts, engineer_id) doesn't dedupe anything.
  const rows: TestEvent[] = Array.from({ length: 200 }, (_, i) => {
    const day = 1 + Math.floor(i / 20); // 10 days
    const minute = i % 60;
    const second = Math.floor(i / 60) % 60;
    return {
      client_event_id: `aabbccdd-${i.toString(16).padStart(4, "0")}-0000-0000-000000000000`,
      ts: `2026-04-${String(day).padStart(2, "0")}T00:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`,
      org_id: "org_prop",
      engineer_id: `eng_${rand() % 5}`,
      session_id: `s_${rand() % 20}`,
      event_seq: i,
      input_tokens: rand() % 10_000,
      output_tokens: rand() % 5000,
      cost_usd: (rand() % 1000) / 100,
    };
  });
  await insertEvents(client, rows);

  const raw = await query<{ tokens: number }>(
    client,
    `SELECT toUInt64(sum(input_tokens)) AS tokens FROM events WHERE org_id = 'org_prop'`,
  );
  const mv = await query<{ tokens: number }>(
    client,
    `SELECT toUInt64(sumMerge(input_tokens_state)) AS tokens FROM dev_daily_rollup WHERE org_id = 'org_prop'`,
  );
  expect(Number(mv[0]?.tokens)).toBe(Number(raw[0]?.tokens));
});

test("partition drop on dev_daily_rollup removes rows for that month", async () => {
  await insertEvents(client, [
    {
      client_event_id: "55555555-0000-0000-0000-000000000001",
      ts: "2026-03-15T10:00:00.000Z",
      org_id: "org_drop",
      engineer_id: "eng_d",
      session_id: "s_mar",
      event_seq: 0,
      input_tokens: 100,
    },
    {
      client_event_id: "55555555-0000-0000-0000-000000000002",
      ts: "2026-04-15T10:00:00.000Z",
      org_id: "org_drop",
      engineer_id: "eng_d",
      session_id: "s_apr",
      event_seq: 0,
      input_tokens: 200,
    },
  ]);

  const before = await query<{ c: number }>(
    client,
    `SELECT count() AS c FROM dev_daily_rollup WHERE org_id = 'org_drop'`,
  );
  expect(Number(before[0]?.c)).toBe(2);

  await client.command({ query: `ALTER TABLE dev_daily_rollup DROP PARTITION 202603` });

  const after = await query<{ c: number }>(
    client,
    `SELECT count() AS c FROM dev_daily_rollup WHERE org_id = 'org_drop'`,
  );
  expect(Number(after[0]?.c)).toBe(1);
});

test("repo_weekly_rollup excludes events with NULL repo_id_hash while dev_daily_rollup counts all", async () => {
  await insertEvents(client, [
    {
      client_event_id: "66666666-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_split",
      engineer_id: "eng_s",
      session_id: "s_n",
      event_seq: 0,
      input_tokens: 100,
      repo_id_hash: null,
    },
    {
      client_event_id: "66666666-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_split",
      engineer_id: "eng_s",
      session_id: "s_y",
      event_seq: 0,
      input_tokens: 200,
      repo_id_hash: "repo_y",
    },
  ]);
  const dev = await query<{ tokens: number }>(
    client,
    `SELECT toUInt32(sumMerge(input_tokens_state)) AS tokens FROM dev_daily_rollup WHERE org_id = 'org_split'`,
  );
  const repo = await query<{ tokens: number }>(
    client,
    `SELECT toUInt32(sumMerge(input_tokens_state)) AS tokens FROM repo_weekly_rollup WHERE org_id = 'org_split'`,
  );
  expect(Number(dev[0]?.tokens)).toBe(300);
  expect(Number(repo[0]?.tokens)).toBe(200);
});
