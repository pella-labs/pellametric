// G3 — hourly reconciler gap-fill path (PRD §11.3 / D51 / §17 risk #6).
//
// Seeds 5 deliveries in a fake GitHub API. Marks 4 as already-seen in
// `github_webhook_deliveries_seen`. Expects the reconciler to issue
// POST /app/hook/deliveries/:id/attempts for exactly the 1 missing delivery.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { type ReconcileHttpClient, runReconcileScaffold } from "./reconcileScaffold";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const sql = postgres(DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} });
let skip = false;

async function canConnect(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  skip = !(await canConnect());
});
afterAll(async () => {
  await sql.end();
});

let tenantId: string;
let installationId: bigint;

async function seed(): Promise<void> {
  const rows = (await sql<Array<{ id: string }>>`
    INSERT INTO orgs (name, slug)
    VALUES ('reconcile-gap-fill', ${`reconcile-gap-fill-${Date.now()}-${Math.random()}`})
    RETURNING id`) as unknown as Array<{ id: string }>;
  tenantId = rows[0]!.id;
  installationId = BigInt(
    Math.floor(Date.now() % 1_000_000_000) + Math.floor(Math.random() * 1000),
  );
  await sql.unsafe(
    `INSERT INTO github_installations
       (tenant_id, installation_id, github_org_id, github_org_login, app_id,
        status, token_ref, webhook_secret_active_ref)
     VALUES ($1, $2, 1, 'gapfill', 1, 'active', 'tok', 'ws')`,
    [tenantId, installationId.toString()],
  );
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DELETE FROM github_webhook_deliveries_seen WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM github_installations WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM orgs WHERE id = $1`, [tenantId]);
}

/**
 * The reconciler walks EVERY active installation. To isolate the test from
 * leftover installations created by earlier test files in this session,
 * we briefly suspend any other active installation, run the test, then
 * restore their status on cleanup. Neighboring tests are unaffected
 * because each test ALSO asserts its own counts scoped to its tenant.
 */
let neighborInstallationIds: string[] = [];

async function quiesceNeighbors(): Promise<void> {
  const rows = (await sql.unsafe(
    `SELECT installation_id::text AS id FROM github_installations
       WHERE status = 'active' AND tenant_id <> $1`,
    [tenantId],
  )) as unknown as Array<{ id: string }>;
  neighborInstallationIds = rows.map((r) => r.id);
  if (neighborInstallationIds.length > 0) {
    await sql.unsafe(
      `UPDATE github_installations
          SET status = 'suspended'
        WHERE installation_id = ANY($1::bigint[])`,
      [neighborInstallationIds],
    );
  }
}

async function restoreNeighbors(): Promise<void> {
  if (neighborInstallationIds.length > 0) {
    await sql.unsafe(
      `UPDATE github_installations
          SET status = 'active'
        WHERE installation_id = ANY($1::bigint[])`,
      [neighborInstallationIds],
    );
  }
  neighborInstallationIds = [];
}

beforeEach(async () => {
  if (skip) return;
  await seed();
  await quiesceNeighbors();
});

/**
 * Minimal fake GitHub API. `/app/hook/deliveries` returns a static list.
 * `/app/hook/deliveries/:id/attempts` records a POST. One page is enough
 * for 5 deliveries at per_page=100.
 */
function makeFakeHttp(now: Date): {
  http: ReconcileHttpClient;
  postedIds: string[];
  deliveries: Array<{ guid: string; id: number; delivered_at: string; event: string }>;
} {
  const deliveries = [1, 2, 3, 4, 5].map((i) => ({
    guid: `delivery-uuid-${i}`,
    id: 1000 + i,
    delivered_at: new Date(now.getTime() - i * 60_000).toISOString(), // each 1 min older
    event: "pull_request",
  }));
  const postedIds: string[] = [];
  const http: ReconcileHttpClient = {
    async get(url) {
      if (/\/app\/hook\/deliveries(\?|$)/.test(url)) {
        return { status: 200, body: deliveries, headers: {} };
      }
      return { status: 404, body: {}, headers: {} };
    },
    async post(url) {
      const m = url.match(/\/app\/hook\/deliveries\/([^/]+)\/attempts$/);
      if (m?.[1]) {
        postedIds.push(decodeURIComponent(m[1]));
        return { status: 202, body: {}, headers: {} };
      }
      return { status: 404, body: {}, headers: {} };
    },
  };
  return { http, postedIds, deliveries };
}

const suite = skip ? describe.skip : describe;

suite("runReconcileScaffold — G3 gap-fill path", () => {
  test("reconciler redelivers exactly the 1 delivery missing from seen-table", async () => {
    const now = new Date("2026-04-18T12:00:00Z");
    const { http, postedIds, deliveries } = makeFakeHttp(now);
    // Mark 4 of 5 as seen — only `delivery-uuid-3` is missing.
    for (const d of deliveries) {
      if (d.guid === "delivery-uuid-3") continue;
      await sql.unsafe(
        `INSERT INTO github_webhook_deliveries_seen
           (tenant_id, installation_id, delivery_id, event)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, installationId.toString(), d.guid, d.event],
      );
    }

    const result = await runReconcileScaffold(
      sql,
      {
        http,
        appJwtProvider: async () => "fake.jwt.token",
        apiBase: "https://api.github.test",
        sleep: async () => {}, // skip real sleeps in test
        maxPagesPerInstallation: 1,
      },
      now,
    );

    expect(result.installationsChecked).toBeGreaterThanOrEqual(1);
    expect(result.deliveriesSeenInGithub).toBe(5);
    expect(result.deliveriesMissingFromOurDb).toBe(1);
    expect(result.redeliveryRequestsQueued).toBe(1);
    expect(result.redeliveryRequestsFailed).toBe(0);
    expect(postedIds).toEqual(["delivery-uuid-3"]);
    await restoreNeighbors();
    await cleanup();
  });

  test("no gaps → no redelivery attempts, still heartbeats", async () => {
    const now = new Date("2026-04-18T12:00:00Z");
    const { http, postedIds, deliveries } = makeFakeHttp(now);
    for (const d of deliveries) {
      await sql.unsafe(
        `INSERT INTO github_webhook_deliveries_seen
           (tenant_id, installation_id, delivery_id, event)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, installationId.toString(), d.guid, d.event],
      );
    }

    const result = await runReconcileScaffold(
      sql,
      {
        http,
        appJwtProvider: async () => "fake.jwt",
        apiBase: "https://api.github.test",
        sleep: async () => {},
        maxPagesPerInstallation: 1,
      },
      now,
    );

    expect(result.deliveriesMissingFromOurDb).toBe(0);
    expect(result.redeliveryRequestsQueued).toBe(0);
    expect(postedIds).toEqual([]);
    expect(result.heartbeatsWritten).toBeGreaterThanOrEqual(1);
    await restoreNeighbors();
    await cleanup();
  });
});
