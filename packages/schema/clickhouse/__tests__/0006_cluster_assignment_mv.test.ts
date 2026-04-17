import { afterAll, beforeEach, expect, test } from "bun:test";
import { makeClient, query, resetState } from "./_harness";

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

test("cluster_assignment_mv exists with ReplacingMergeTree engine", async () => {
  const rows = await query<{ engine: string; engine_full: string }>(
    client,
    `SELECT engine, engine_full FROM system.tables WHERE database = 'bematist' AND name = 'cluster_assignment_mv'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.engine).toBe("ReplacingMergeTree");
  expect(rows[0]?.engine_full).toContain("ReplacingMergeTree(ts)");
});

test("insert round-trips (org, session, prompt_index, cluster_id, ts)", async () => {
  await insertAssignment([
    {
      org_id: "org_a",
      session_id: "s1",
      prompt_index: 0,
      cluster_id: "c_1",
      ts: "2026-04-01T10:00:00.000Z",
    },
  ]);
  const out = await query<{ cluster_id: string }>(
    client,
    `SELECT cluster_id FROM cluster_assignment_mv WHERE org_id = 'org_a' AND session_id = 's1'`,
  );
  expect(out).toHaveLength(1);
  expect(out[0]?.cluster_id).toBe("c_1");
});

test("latest ts wins after FINAL when re-clustering happens", async () => {
  await insertAssignment([
    {
      org_id: "org_a",
      session_id: "s1",
      prompt_index: 0,
      cluster_id: "c_old",
      ts: "2026-04-01T10:00:00.000Z",
    },
    {
      org_id: "org_a",
      session_id: "s1",
      prompt_index: 0,
      cluster_id: "c_new",
      ts: "2026-04-02T10:00:00.000Z",
    },
  ]);
  const out = await query<{ cluster_id: string }>(
    client,
    `SELECT cluster_id FROM cluster_assignment_mv FINAL WHERE org_id = 'org_a' AND session_id = 's1' AND prompt_index = 0`,
  );
  expect(out).toHaveLength(1);
  expect(out[0]?.cluster_id).toBe("c_new");
});
