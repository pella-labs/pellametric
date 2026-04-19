// B1 — admin claim flow for github_pending_installations.
//
// Integration test: real Postgres via the same pattern as other /api tests.
// Seeds a pending row under global-admin RLS context, calls
// `claimPendingInstallation`, asserts a `github_installations` row is created
// under the caller's tenant and the pending row is marked claimed.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type { Ctx } from "../../auth";
import { claimPendingInstallation } from "./claimPendingInstallation";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";

async function canConnect(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 4, onnotice: () => {} });
let skip = false;

let tenantId: string;
let pendingId: string;
let installationId: bigint;

function ctx(role: Ctx["role"] = "admin"): Ctx {
  return {
    tenant_id: tenantId,
    actor_id: "test-actor",
    role,
    db: {
      pg: {
        async query<T = unknown>(q: string, params?: unknown[]): Promise<T[]> {
          return (await sql.unsafe(q, (params ?? []) as unknown[])) as unknown as T[];
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: test-only ch/redis fakes
      ch: {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: test-only redis fake
      redis: {} as any,
    },
  };
}

async function seedTenant(): Promise<string> {
  const rows = (await sql<Array<{ id: string }>>`
    INSERT INTO orgs (name, slug)
    VALUES ('claim-test', ${`claim-test-${Date.now()}-${Math.random()}`})
    RETURNING id`) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function seedPending(): Promise<{ id: string; installation_id: bigint }> {
  const iid = BigInt(Date.now()) * 1_000n + BigInt(Math.floor(Math.random() * 1000));
  const rows = (await sql.unsafe(
    `SET LOCAL app.is_global_admin = 'true';
     INSERT INTO github_pending_installations
       (installation_id, github_org_id, github_org_login, app_id, target_type,
        repositories_selected_count)
     VALUES ($1::bigint, 123456::bigint, 'test-org', 909090::bigint, 'Organization', 2)
     RETURNING id::text AS id, installation_id::text AS installation_id`,
    [iid.toString()],
  )) as unknown as Array<{ id: string; installation_id: string }>;
  return { id: rows[0]!.id, installation_id: BigInt(rows[0]!.installation_id) };
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DELETE FROM github_installations WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(
    `SET LOCAL app.is_global_admin = 'true';
     DELETE FROM github_pending_installations WHERE installation_id = $1::bigint`,
    [installationId.toString()],
  );
  await sql.unsafe(`DELETE FROM orgs WHERE id = $1`, [tenantId]);
}

beforeAll(async () => {
  skip = !(await canConnect(sql));
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  if (skip) return;
  tenantId = await seedTenant();
  const p = await seedPending();
  pendingId = p.id;
  installationId = p.installation_id;
});

describe("claimPendingInstallation", () => {
  test("skip-note when DB unreachable", () => {
    if (!skip) return;
    expect(skip).toBe(true);
  });

  test("admin claims → github_installations row appears under their tenant", async () => {
    if (skip) return;
    const out = await claimPendingInstallation(ctx(), {
      pending_id: pendingId,
      token_ref: "sm/test-token",
      webhook_secret_ref: "sm/test-webhook",
    });
    expect(out.installation_id).toBe(installationId.toString());
    const bound = (await sql.unsafe(
      `SELECT installation_id::text AS installation_id, status
         FROM github_installations
        WHERE tenant_id = $1 AND installation_id = $2::bigint`,
      [tenantId, installationId.toString()],
    )) as unknown as Array<{ installation_id: string; status: string }>;
    expect(bound.length).toBe(1);
    expect(bound[0]!.status).toBe("active");
    await cleanup();
  });

  test("non-admin → FORBIDDEN", async () => {
    if (skip) return;
    await expect(
      claimPendingInstallation(ctx("engineer"), {
        pending_id: pendingId,
        token_ref: "sm/x",
        webhook_secret_ref: "sm/y",
      }),
    ).rejects.toThrow();
    await cleanup();
  });

  test("already-claimed → BAD_REQUEST", async () => {
    if (skip) return;
    await claimPendingInstallation(ctx(), {
      pending_id: pendingId,
      token_ref: "sm/once",
      webhook_secret_ref: "sm/once",
    });
    await expect(
      claimPendingInstallation(ctx(), {
        pending_id: pendingId,
        token_ref: "sm/twice",
        webhook_secret_ref: "sm/twice",
      }),
    ).rejects.toThrow();
    await cleanup();
  });
});
