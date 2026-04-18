import { afterAll, beforeAll, expect, test } from "bun:test";
import { explainNatural, explainWithProjection, projectionUsed } from "../explain";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeAll(async () => {
  await resetState(client);
  await insertEvents(
    client,
    Array.from({ length: 50 }, (_, i) => ({
      client_event_id: `ss000000-${i.toString().padStart(4, "0")}-0000-0000-000000000000`,
      ts: `2026-04-${String(1 + (i % 10)).padStart(2, "0")}T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
      org_id: "org_session",
      engineer_id: `eng_${i % 5}`,
      session_id: `s_${i % 20}`,
      event_seq: i,
      input_tokens: 100 + i,
    })),
  );
});

afterAll(async () => {
  await client.close();
});

test("session_lookup projection is registered on events", async () => {
  const rows = await query<{ name: string; table: string }>(
    client,
    `SELECT name, table FROM system.projection_parts WHERE database = 'bematist' AND table = 'events' AND name = 'session_lookup' LIMIT 1`,
  );
  expect(rows.length).toBeGreaterThan(0);
});

test("session-drill query selects a projection (force_optimize_projection=1 succeeds)", async () => {
  // Multiple projections share the `org_id` leading column; the optimizer may
  // pick any of them for a (org_id, session_id) filter. The gate is that SOME
  // projection is chosen, not a base-table scan.
  const explain = await explainWithProjection(
    client,
    `SELECT sum(input_tokens) FROM events WHERE org_id = 'org_session' AND session_id = 's_3'`,
  );
  expect(projectionUsed(explain)).not.toBeNull();
});

test("time-range-only query does NOT use session_lookup projection (natural optimizer)", async () => {
  const explain = await explainNatural(
    client,
    `SELECT sum(input_tokens) FROM events WHERE org_id = 'org_session' AND ts >= '2026-04-01 00:00:00'`,
  );
  expect(projectionUsed(explain)).not.toBe("session_lookup");
});
