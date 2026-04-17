import { afterAll, beforeAll, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeAll(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("events has repo_id_hash and prompt_cluster_id columns (nullable)", async () => {
  const rows = await query<{ name: string; type: string }>(
    client,
    `SELECT name, type FROM system.columns WHERE database = 'bematist' AND table = 'events' AND name IN ('repo_id_hash', 'prompt_cluster_id')`,
  );
  const names = rows.map((r) => r.name).sort();
  expect(names).toEqual(["prompt_cluster_id", "repo_id_hash"]);
  for (const r of rows) {
    expect(r.type).toBe("Nullable(String)");
  }
});

test("event insert round-trips repo_id_hash and prompt_cluster_id", async () => {
  await insertEvents(client, [
    {
      client_event_id: "11111111-1111-1111-1111-111111111111",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      repo_id_hash: "repo_hash_x",
      prompt_cluster_id: "cluster_42",
    },
    {
      client_event_id: "22222222-2222-2222-2222-222222222222",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
    },
  ]);
  const out = await query<{ repo_id_hash: string | null; prompt_cluster_id: string | null }>(
    client,
    `SELECT repo_id_hash, prompt_cluster_id FROM events WHERE org_id = 'org_a' ORDER BY event_seq`,
  );
  expect(out).toEqual([
    { repo_id_hash: "repo_hash_x", prompt_cluster_id: "cluster_42" },
    { repo_id_hash: null, prompt_cluster_id: null },
  ]);
});
