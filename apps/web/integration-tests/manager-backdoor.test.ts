// Manager-backdoor merge-blocker (PRD §13 + §17 risk #5).
//
// Verifies:
//   (a) non-admin IC trying to view another IC's /engineer/:id surface →
//       AuthError("FORBIDDEN")
//   (b) audit_events row is persisted for BOTH the denied attempt AND the
//       allowed admin view.
//   (c) the IC viewing their OWN page is always allowed (self-view).
//
// Real Postgres — skips gracefully when DATABASE_URL unreachable.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AuthError, type Ctx, type PgClient, recordEngineerViewAttempt } from "@bematist/api";
import postgres, { type Sql } from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const sql = postgres(DATABASE_URL, { prepare: false, max: 2, onnotice: () => {} });
let skip = false;

async function canConnect(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  skip = !(await canConnect(sql));
});
afterAll(async () => {
  await sql.end();
});

let tenantId: string;
let actorUserId: string;
let otherUserId: string;

async function seed(): Promise<void> {
  const orgRows = (await sql<Array<{ id: string }>>`
    INSERT INTO orgs (name, slug)
    VALUES ('backdoor-test', ${`backdoor-test-${Date.now()}-${Math.random()}`})
    RETURNING id`) as unknown as Array<{ id: string }>;
  tenantId = orgRows[0]?.id;
  const u1 = (await sql<Array<{ id: string }>>`
    INSERT INTO users (org_id, sso_subject, email)
    VALUES (${tenantId}, ${"sub-a"}, ${`a-${Date.now()}-${Math.random()}@x.test`})
    RETURNING id`) as unknown as Array<{ id: string }>;
  const u2 = (await sql<Array<{ id: string }>>`
    INSERT INTO users (org_id, sso_subject, email)
    VALUES (${tenantId}, ${"sub-b"}, ${`b-${Date.now()}-${Math.random()}@x.test`})
    RETURNING id`) as unknown as Array<{ id: string }>;
  actorUserId = u1[0]?.id;
  otherUserId = u2[0]?.id;
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DELETE FROM audit_events WHERE org_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM users WHERE org_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM orgs WHERE id = $1`, [tenantId]);
}

beforeEach(async () => {
  if (skip) return;
  await seed();
});

// Minimal PgClient shim against postgres.js — recordEngineerViewAttempt
// uses `ctx.db.pg.query(sql, params)`.
function makeCtx(role: Ctx["role"], subjectId: string = actorUserId): Ctx {
  const pg: PgClient = {
    async query<T = unknown>(sqlText: string, params?: unknown[]): Promise<T[]> {
      // postgres.js `unsafe` signature matches $N placeholders + params array.
      return (await sql.unsafe(sqlText, params ?? [])) as unknown as T[];
    },
  };
  // Upgrade types don't include ch / redis; cast to Ctx's shape.
  return {
    tenant_id: tenantId,
    actor_id: subjectId,
    role,
    db: { pg, ch: {} as never, redis: {} as never },
  } as Ctx;
}

const suite = skip ? describe.skip : describe;

suite("recordEngineerViewAttempt — PRD §17 risk #5 merge blocker", () => {
  test("non-admin IC viewing ANOTHER IC → FORBIDDEN + audit_events row persisted", async () => {
    const ctx = makeCtx("engineer");
    await expect(
      recordEngineerViewAttempt(ctx, { target_engineer_id: otherUserId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const rows = (await sql.unsafe(
      `SELECT actor_user_id, surface, target_engineer_id_hash
         FROM audit_events WHERE org_id = $1`,
      [tenantId],
    )) as unknown as Array<{
      actor_user_id: string;
      surface: string;
      target_engineer_id_hash: string;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.actor_user_id).toBe(actorUserId);
    expect(rows[0]?.surface).toBe("engineer_page");
    // Hash matches sha256(otherUserId)
    const { createHash } = await import("node:crypto");
    const expectedHash = createHash("sha256").update(otherUserId).digest("hex");
    expect(rows[0]?.target_engineer_id_hash).toBe(expectedHash);
    await cleanup();
  });

  test("non-admin IC viewing OWN page → allowed, audit row persisted", async () => {
    const ctx = makeCtx("engineer");
    const out = await recordEngineerViewAttempt(ctx, { target_engineer_id: actorUserId });
    expect(out.ok).toBe(true);
    const rows = await sql<
      Array<{ surface: string }>
    >`SELECT surface FROM audit_events WHERE org_id = ${tenantId}`;
    expect(rows[0]?.surface).toBe("engineer_page");
    await cleanup();
  });

  test("admin viewing another IC → allowed, audit row persisted", async () => {
    const ctx = makeCtx("admin");
    const out = await recordEngineerViewAttempt(ctx, { target_engineer_id: otherUserId });
    expect(out.ok).toBe(true);
    const rows = await sql<Array<unknown>>`SELECT 1 FROM audit_events WHERE org_id = ${tenantId}`;
    expect(rows.length).toBe(1);
    await cleanup();
  });

  test("viewer role is explicitly forbidden from viewing others", async () => {
    const ctx = makeCtx("viewer");
    await expect(
      recordEngineerViewAttempt(ctx, { target_engineer_id: otherUserId }),
    ).rejects.toBeInstanceOf(AuthError);
    await cleanup();
  });
});
