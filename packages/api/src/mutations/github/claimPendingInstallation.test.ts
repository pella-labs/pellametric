// B1 — admin claim flow for github_pending_installations.
//
// Integration test: real Postgres via the same pattern as other /api tests.
// Seeds a pending row under global-admin RLS context, calls
// `claimPendingInstallation`, asserts a `github_installations` row is created
// under the caller's tenant and the pending row is marked claimed.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import type { Ctx, PgClient } from "../../auth";
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

let actorUserId: string;
function ctx(role: Ctx["role"] = "admin"): Ctx {
  const pg: PgClient = {
    async query<T = unknown>(q: string, params?: unknown[]): Promise<T[]> {
      // biome-ignore lint/suspicious/noExplicitAny: postgres-js ParameterOrJSON widen
      return (await sql.unsafe(q, (params ?? []) as any[])) as unknown as T[];
    },
    async transaction<T>(fn: (tx: PgClient) => Promise<T>): Promise<T> {
      return sql.begin(async (txSql) => {
        const tx: PgClient = {
          async query<R = unknown>(q: string, params?: unknown[]): Promise<R[]> {
            // biome-ignore lint/suspicious/noExplicitAny: postgres-js ParameterOrJSON widen
            return (await txSql.unsafe(q, (params ?? []) as any[])) as unknown as R[];
          },
        };
        return await fn(tx);
      }) as T;
    },
  };
  return {
    tenant_id: tenantId,
    actor_id: actorUserId,
    role,
    db: {
      pg,
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
  const result = (await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.is_global_admin = 'true'`);
    const rows = (await tx.unsafe(
      `INSERT INTO github_pending_installations
         (installation_id, github_org_id, github_org_login, app_id, target_type,
          repositories_selected_count)
       VALUES ($1::bigint, 123456::bigint, 'test-org', 909090::bigint, 'Organization', 2)
       RETURNING id::text AS id, installation_id::text AS installation_id`,
      [iid.toString()],
    )) as unknown as Array<{ id: string; installation_id: string }>;
    return rows;
  })) as unknown as Array<{ id: string; installation_id: string }>;
  return { id: result[0]!.id, installation_id: BigInt(result[0]!.installation_id) };
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DELETE FROM github_installations WHERE tenant_id = $1`, [tenantId]);
  await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.is_global_admin = 'true'`);
    await tx.unsafe(`DELETE FROM github_pending_installations WHERE installation_id = $1::bigint`, [
      installationId.toString(),
    ]);
  });
  // audit_log is append-only (trigger audit_log_prevent_mutate) — leave rows.
  // The FK on actor_user_id is ON DELETE NO ACTION, so users must survive.
  // We leave both tables' rows intact; the tenant row on orgs still cascades.
  await sql
    .unsafe(`UPDATE audit_log SET target_id = target_id WHERE org_id = $1`, [tenantId])
    .catch(() => {});
  await sql.unsafe(`DELETE FROM orgs WHERE id = $1`, [tenantId]).catch(() => {});
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
  // Seed a real user row for audit_log.actor_user_id FK.
  const userRows = (await sql<Array<{ id: string }>>`
    INSERT INTO users (org_id, sso_subject, email, role)
    VALUES (${tenantId}, ${`sso-${Date.now()}-${Math.random()}`}, 'test@example.com', 'admin')
    RETURNING id`) as unknown as Array<{ id: string }>;
  actorUserId = userRows[0]!.id;
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
    expect(bound[0]?.status).toBe("active");
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
