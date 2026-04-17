import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

async function insertAssignment(
  rows: Array<{
    org_id: string;
    session_id: string;
    prompt_index: number;
    cluster_id: string;
    ts: string;
  }>,
): Promise<void> {
  const filled = rows.map((r) => ({
    ...r,
    ts: r.ts.replace("T", " ").replace("Z", ""),
  }));
  await client.insert({
    table: "cluster_assignment_mv",
    values: filled,
    format: "JSONEachRow",
  });
}

test("prompt_cluster_stats exists with AggregatingMergeTree inner engine", async () => {
  const rows = await query<{ engine: string }>(
    client,
    `SELECT inner.engine AS engine
     FROM system.tables AS v
     INNER JOIN system.tables AS inner ON ('.inner_id.' || toString(v.uuid)) = inner.name
     WHERE v.database = 'bematist' AND v.name = 'prompt_cluster_stats'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.engine).toBe("AggregatingMergeTree");
});

test("prompt_count_state increments per cluster-week; engineers uniq'd", async () => {
  await insertEvents(client, [
    {
      client_event_id: "77777777-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      cost_usd: 0.05,
      duration_ms: 1000,
    },
    {
      client_event_id: "77777777-0000-0000-0000-000000000002",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_2",
      session_id: "s2",
      event_seq: 0,
      cost_usd: 0.03,
      duration_ms: 500,
    },
  ]);
  await insertAssignment([
    {
      org_id: "org_a",
      session_id: "s1",
      prompt_index: 0,
      cluster_id: "c_42",
      ts: "2026-04-01T10:00:00.000Z",
    },
    {
      org_id: "org_a",
      session_id: "s2",
      prompt_index: 0,
      cluster_id: "c_42",
      ts: "2026-04-01T10:00:01.000Z",
    },
  ]);
  const out = await query<{ cluster_id: string; engineers: number; cnt: number }>(
    client,
    `SELECT cluster_id, toUInt32(uniqMerge(contributing_engineers_state)) AS engineers, toUInt32(sumMerge(prompt_count_state)) AS cnt
     FROM prompt_cluster_stats
     WHERE org_id = 'org_a'
     GROUP BY cluster_id`,
  );
  expect(out).toHaveLength(1);
  expect(out[0]?.cluster_id).toBe("c_42");
  expect(Number(out[0]?.engineers)).toBe(2);
  expect(Number(out[0]?.cnt)).toBe(2);
});

test("cost_usd_state reflects joined events", async () => {
  await insertEvents(client, [
    {
      client_event_id: "88888888-0000-0000-0000-000000000001",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s_cost",
      event_seq: 0,
      cost_usd: 1.5,
    },
  ]);
  await insertAssignment([
    {
      org_id: "org_a",
      session_id: "s_cost",
      prompt_index: 0,
      cluster_id: "c_cost",
      ts: "2026-04-01T10:00:00.000Z",
    },
  ]);
  const out = await query<{ cost: number }>(
    client,
    `SELECT sumMerge(cost_usd_state) AS cost FROM prompt_cluster_stats WHERE org_id = 'org_a' AND cluster_id = 'c_cost'`,
  );
  expect(Number(out[0]?.cost)).toBeCloseTo(1.5, 4);
});
