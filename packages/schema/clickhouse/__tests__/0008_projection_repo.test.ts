import { afterAll, beforeAll, expect, test } from "bun:test";
import { explainNatural, explainWithProjection, projectionUsed } from "../explain";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeAll(async () => {
  await resetState(client);
  // Seed enough data that the query planner has reason to consider the projection.
  await insertEvents(
    client,
    Array.from({ length: 50 }, (_, i) => ({
      client_event_id: `pp000000-${i.toString().padStart(4, "0")}-0000-0000-000000000000`,
      ts: `2026-04-${String(1 + (i % 10)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
      org_id: "org_proj",
      engineer_id: `eng_${i % 5}`,
      session_id: `s_${i % 20}`,
      event_seq: i,
      repo_id_hash: i % 2 === 0 ? "repo_alpha" : "repo_beta",
      input_tokens: 100 + i,
    })),
  );
});

afterAll(async () => {
  await client.close();
});

test("repo_lookup projection is registered on events", async () => {
  const rows = await query<{ name: string; table: string }>(
    client,
    `SELECT name, table FROM system.projection_parts WHERE database = 'bematist' AND table = 'events' AND name = 'repo_lookup' LIMIT 1`,
  );
  expect(rows.length).toBeGreaterThan(0);
});

test("repo-drill query uses repo_lookup projection (force_optimize_projection=1)", async () => {
  const explain = await explainWithProjection(
    client,
    `SELECT sum(input_tokens) FROM events WHERE org_id = 'org_proj' AND repo_id_hash = 'repo_alpha'`,
  );
  expect(projectionUsed(explain)).toBe("repo_lookup");
});

test("time-range-only query does NOT use repo_lookup projection (natural optimizer)", async () => {
  const explain = await explainNatural(
    client,
    `SELECT sum(input_tokens) FROM events WHERE org_id = 'org_proj' AND ts >= '2026-04-01 00:00:00'`,
  );
  expect(projectionUsed(explain)).not.toBe("repo_lookup");
});

test("row counts match between base table and repo-filtered read (projection transparent)", async () => {
  const base = await query<{ c: number }>(
    client,
    `SELECT toUInt32(count()) AS c FROM events WHERE org_id = 'org_proj' AND repo_id_hash = 'repo_alpha'`,
  );
  expect(Number(base[0]?.c)).toBe(25);
});
