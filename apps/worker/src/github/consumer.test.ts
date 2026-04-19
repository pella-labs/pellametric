// Integration tests for the worker's github.webhooks consumer. Uses the
// SAME real Postgres from docker-compose.dev.yml the existing tests rely on
// (DATABASE_URL env var). Skips gracefully when DATABASE_URL is unset so
// `bun test` on a dev machine without the stack still passes the unit suite.
//
// Coverage (one test per supported domain kind):
//   1. pull_request.opened → github_pull_requests row + recompute message
//   2. pull_request.closed (merged rebase) → state='merged' + merge_commit_sha
//   3. pull_request.closed (unmerged) → state='closed'
//   4. pull_request.opened-from-fork → from_fork=true in recompute evidence
//   5. pull_request.edited with "Closes #N" → has_closes_keyword=true
//   6. push.to-default-branch → git_events row, recompute payload carries branch
//   7. push.forced → recompute carries forced=true
//   8. check_suite.completed-failure → github_check_suites row, failed_runs_count=1
//   9. installation.suspend → status='suspended' + synthetic recompute
//  10. installation.unsuspend → status='active'
//  11. installation.deleted → status='revoked'
//  12. repository.renamed → repo_id_hash_aliases row
//  13. repository.transferred → repo_id_hash_aliases row

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import {
  createInMemoryRecomputeStream,
  type InMemoryRecomputeStream,
} from "../../../ingest/src/github-app/recomputeStream";
import { encodePayload, type WebhookBusPayload } from "../../../ingest/src/github-app/webhookBus";
import { type ConsumerDeps, consumeMessage } from "./consumer";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const FIXTURES_ROOT = resolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "fixtures",
  "github",
);

async function canConnect(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

interface Ctx {
  sql: Sql;
  tenantId: string;
  installationId: bigint;
  recompute: InMemoryRecomputeStream;
}

async function seedTenantAndInstallation(sql: Sql): Promise<{
  tenantId: string;
  installationId: bigint;
}> {
  const tenantId = (
    await sql<Array<{ id: string }>>`
      INSERT INTO orgs (name, slug)
      VALUES ('worker-github-test', ${`worker-github-test-${Date.now()}-${Math.random()}`})
      RETURNING id`
  )[0]?.id;
  if (!tenantId) throw new Error("unreachable: tenant insert returned no id");
  // github_installations: unique on installation_id globally — use time-jittered id.
  const installationId = BigInt(
    Math.floor(Date.now() % 1_000_000_000) + Math.floor(Math.random() * 1000),
  );
  await sql.unsafe(
    `INSERT INTO github_installations
       (tenant_id, installation_id, github_org_id, github_org_login, app_id,
        status, token_ref, webhook_secret_active_ref)
     VALUES ($1, $2, 123456, 'fixture-org', 909090,
             'active', 'tok:test', 'ws:active')`,
    [tenantId, installationId.toString()],
  );
  return { tenantId, installationId };
}

async function cleanup(sql: Sql, tenantId: string): Promise<void> {
  // Delete order matters — FKs on tenant_id.
  await sql.unsafe(`DELETE FROM repo_id_hash_aliases WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM github_deployments WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM github_check_suites WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM github_pull_requests WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM git_events WHERE org_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM github_installations WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM orgs WHERE id = $1`, [tenantId]);
}

function makePayload(
  ctx: { tenantId: string; installationId: bigint },
  event: string,
  bodyJson: string,
  deliveryId = `d-${Date.now()}-${Math.random()}`,
): WebhookBusPayload {
  return {
    delivery_id: deliveryId,
    event,
    tenant_id: ctx.tenantId,
    installation_id: ctx.installationId.toString(),
    body_b64: Buffer.from(bodyJson, "utf8").toString("base64"),
    received_at: new Date().toISOString(),
  };
}

function consumerDeps(ctx: Ctx): ConsumerDeps {
  return {
    sql: ctx.sql,
    recompute: ctx.recompute,
    log: () => {},
  };
}

function readFixture(event: string, scenario: string): string {
  return readFileSync(resolve(FIXTURES_ROOT, event, `${scenario}.json`), "utf8");
}

// ---------------------------------------------------------------------------

const sql = postgres(DATABASE_URL, { prepare: false, max: 4, onnotice: () => {} });
let skip = false;
let ctx: Ctx;

beforeAll(async () => {
  skip = !(await canConnect(sql));
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  if (skip) return;
  const ids = await seedTenantAndInstallation(sql);
  ctx = {
    sql,
    tenantId: ids.tenantId,
    installationId: ids.installationId,
    recompute: createInMemoryRecomputeStream(),
  };
});

describe("worker/github consumer — real Postgres integration", () => {
  test("skip-note: DATABASE_URL not reachable; skipping integration suite", () => {
    if (!skip) return;
    expect(skip).toBe(true);
  });

  // 1. pull_request.opened (G0 fixture reuse — already passes HMAC + parser)
  test("pull_request.opened → UPSERT + recompute", async () => {
    if (skip) return;
    const body = readFixture("pull_request", "opened");
    const out = await consumeMessage(
      encodePayload(makePayload(ctx, "pull_request", body)),
      consumerDeps(ctx),
    );
    expect(out.handled).toBe("pull_request_upsert");
    expect(out.recomputeTrigger).toBe("webhook_pr_upsert");
    const rows = await sql<
      Array<{ state: string; additions: number }>
    >`SELECT state, additions FROM github_pull_requests WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows.length).toBe(1);
    expect(rows[0]?.state).toBe("open");
    expect(ctx.recompute.readStream(ctx.tenantId).length).toBe(1);
    await cleanup(sql, ctx.tenantId);
  });

  // 2. pull_request.closed-merged-rebase
  test("pull_request.closed-merged-rebase → state='merged' + merge_commit_sha", async () => {
    if (skip) return;
    const body = readFixture("pull_request", "closed-merged-rebase");
    await consumeMessage(encodePayload(makePayload(ctx, "pull_request", body)), consumerDeps(ctx));
    const rows = await sql<
      Array<{ state: string; merge_commit_sha: string | null }>
    >`SELECT state, merge_commit_sha FROM github_pull_requests WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.state).toBe("merged");
    expect(rows[0]?.merge_commit_sha).toBe("0000000000000000000000000000000000000008");
    await cleanup(sql, ctx.tenantId);
  });

  // 3. pull_request.closed-unmerged
  test("pull_request.closed-unmerged → state='closed', merge_commit_sha null", async () => {
    if (skip) return;
    const body = readFixture("pull_request", "closed-unmerged");
    await consumeMessage(encodePayload(makePayload(ctx, "pull_request", body)), consumerDeps(ctx));
    const rows = await sql<
      Array<{ state: string; merge_commit_sha: string | null }>
    >`SELECT state, merge_commit_sha FROM github_pull_requests WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.state).toBe("closed");
    expect(rows[0]?.merge_commit_sha).toBeNull();
    await cleanup(sql, ctx.tenantId);
  });

  // 4. opened-from-fork
  test("pull_request.opened-from-fork → recompute carries from_fork=true", async () => {
    if (skip) return;
    const body = readFixture("pull_request", "opened-from-fork");
    await consumeMessage(encodePayload(makePayload(ctx, "pull_request", body)), consumerDeps(ctx));
    const msgs = ctx.recompute.readStream(ctx.tenantId);
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.msg.payload.from_fork).toBe(true);
    await cleanup(sql, ctx.tenantId);
  });

  // 5. edited-with-closes-keyword
  test("pull_request.edited-with-closes-keyword → has_closes_keyword=true", async () => {
    if (skip) return;
    const body = readFixture("pull_request", "edited-with-closes-keyword");
    await consumeMessage(encodePayload(makePayload(ctx, "pull_request", body)), consumerDeps(ctx));
    const msgs = ctx.recompute.readStream(ctx.tenantId);
    expect(msgs[0]?.msg.payload.has_closes_keyword).toBe(true);
    await cleanup(sql, ctx.tenantId);
  });

  // 6. push.to-default-branch
  test("push.to-default-branch → git_events row, recompute carries branch=main", async () => {
    if (skip) return;
    const body = readFixture("push", "to-default-branch");
    const out = await consumeMessage(
      encodePayload(makePayload(ctx, "push", body)),
      consumerDeps(ctx),
    );
    expect(out.handled).toBe("push");
    const rows = await sql<
      Array<{ branch: string | null; commit_sha: string | null }>
    >`SELECT branch, commit_sha FROM git_events WHERE org_id = ${ctx.tenantId}`;
    expect(rows.length).toBe(1);
    expect(rows[0]?.branch).toBe("main");
    const msgs = ctx.recompute.readStream(ctx.tenantId);
    expect(msgs[0]?.msg.payload.branch).toBe("main");
    await cleanup(sql, ctx.tenantId);
  });

  // 7. push.forced (G0 fixture)
  test("push.forced → recompute carries forced=true", async () => {
    if (skip) return;
    const body = readFixture("push", "forced");
    await consumeMessage(encodePayload(makePayload(ctx, "push", body)), consumerDeps(ctx));
    const msgs = ctx.recompute.readStream(ctx.tenantId);
    expect(msgs[0]?.msg.payload.forced).toBe(true);
    await cleanup(sql, ctx.tenantId);
  });

  // 8. check_suite.completed-failure
  test("check_suite.completed-failure → github_check_suites + failed_runs_count=1", async () => {
    if (skip) return;
    const body = readFixture("check_suite", "completed-failure");
    const out = await consumeMessage(
      encodePayload(makePayload(ctx, "check_suite", body)),
      consumerDeps(ctx),
    );
    expect(out.handled).toBe("check_suite_upsert");
    const rows = await sql<
      Array<{ conclusion: string | null; failed_runs_count: number }>
    >`SELECT conclusion, failed_runs_count FROM github_check_suites WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.conclusion).toBe("failure");
    expect(rows[0]?.failed_runs_count).toBe(1);
    await cleanup(sql, ctx.tenantId);
  });

  // 9. installation.suspend → status suspended
  test("installation.suspend → status='suspended' + synthetic recompute", async () => {
    if (skip) return;
    const body = readFixture("installation", "suspend");
    const out = await consumeMessage(
      encodePayload(makePayload(ctx, "installation", body)),
      consumerDeps(ctx),
    );
    expect(out.handled).toBe("installation_state_change");
    const rows = await sql<
      Array<{ status: string }>
    >`SELECT status FROM github_installations WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.status).toBe("suspended");
    const msgs = ctx.recompute.readStream(ctx.tenantId);
    expect(msgs[0]?.msg.payload.next_status).toBe("suspended");
    await cleanup(sql, ctx.tenantId);
  });

  // 10. installation.unsuspend → status active
  test("installation.unsuspend → status='active'", async () => {
    if (skip) return;
    // Seed suspended first.
    await sql.unsafe(`UPDATE github_installations SET status='suspended' WHERE tenant_id=$1`, [
      ctx.tenantId,
    ]);
    const body = readFixture("installation", "unsuspend");
    await consumeMessage(encodePayload(makePayload(ctx, "installation", body)), consumerDeps(ctx));
    const rows = await sql<
      Array<{ status: string }>
    >`SELECT status FROM github_installations WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.status).toBe("active");
    await cleanup(sql, ctx.tenantId);
  });

  // 11. installation.deleted → status revoked
  test("installation.deleted → status='revoked'", async () => {
    if (skip) return;
    const body = readFixture("installation", "deleted");
    await consumeMessage(encodePayload(makePayload(ctx, "installation", body)), consumerDeps(ctx));
    const rows = await sql<
      Array<{ status: string }>
    >`SELECT status FROM github_installations WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.status).toBe("revoked");
    await cleanup(sql, ctx.tenantId);
  });

  // 12. repository.renamed → alias row
  test("repository.renamed → repo_id_hash_aliases row with reason='rename'", async () => {
    if (skip) return;
    const body = readFixture("repository", "renamed");
    const out = await consumeMessage(
      encodePayload(makePayload(ctx, "repository", body)),
      consumerDeps(ctx),
    );
    expect(out.handled).toBe("repository_rename_or_transfer");
    const rows = await sql<
      Array<{ reason: string }>
    >`SELECT reason FROM repo_id_hash_aliases WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.reason).toBe("rename");
    await cleanup(sql, ctx.tenantId);
  });

  // 13. repository.transferred → alias with reason='transfer'
  test("repository.transferred → reason='transfer'", async () => {
    if (skip) return;
    const body = readFixture("repository", "transferred");
    await consumeMessage(encodePayload(makePayload(ctx, "repository", body)), consumerDeps(ctx));
    const rows = await sql<
      Array<{ reason: string }>
    >`SELECT reason FROM repo_id_hash_aliases WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.reason).toBe("transfer");
    await cleanup(sql, ctx.tenantId);
  });

  // 14 (G3). deployment.created → github_deployments row, status='pending'
  test("deployment.created → github_deployments + status='pending' + recompute", async () => {
    if (skip) return;
    const body = readFixture("deployment", "created");
    const out = await consumeMessage(
      encodePayload(makePayload(ctx, "deployment", body)),
      consumerDeps(ctx),
    );
    expect(out.handled).toBe("deployment_upsert");
    const rows = await sql<
      Array<{ status: string; environment: string; first_success_at: Date | null }>
    >`SELECT status, environment, first_success_at
        FROM github_deployments
        WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.environment).toBe("production");
    expect(rows[0]?.first_success_at).toBeNull();
    const msgs = ctx.recompute.readStream(ctx.tenantId);
    expect(msgs[0]?.msg.trigger).toBe("webhook_deployment");
    await cleanup(sql, ctx.tenantId);
  });

  // 15 (G3). deployment_status.success → status='success', first_success_at set
  test("deployment_status.success → status='success' + first_success_at set", async () => {
    if (skip) return;
    const body = readFixture("deployment_status", "success");
    const out = await consumeMessage(
      encodePayload(makePayload(ctx, "deployment_status", body)),
      consumerDeps(ctx),
    );
    expect(out.handled).toBe("deployment_status_upsert");
    const rows = await sql<
      Array<{ status: string; first_success_at: Date | null }>
    >`SELECT status, first_success_at
        FROM github_deployments
        WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.status).toBe("success");
    expect(rows[0]?.first_success_at).not.toBeNull();
    await cleanup(sql, ctx.tenantId);
  });

  // 16 (G3). deployment_status.failure → status='failure', first_success_at null
  test("deployment_status.failure → status='failure' + no first_success_at", async () => {
    if (skip) return;
    const body = readFixture("deployment_status", "failure");
    await consumeMessage(
      encodePayload(makePayload(ctx, "deployment_status", body)),
      consumerDeps(ctx),
    );
    const rows = await sql<
      Array<{ status: string; first_success_at: Date | null }>
    >`SELECT status, first_success_at
        FROM github_deployments
        WHERE tenant_id = ${ctx.tenantId}`;
    expect(rows[0]?.status).toBe("failure");
    expect(rows[0]?.first_success_at).toBeNull();
    await cleanup(sql, ctx.tenantId);
  });
});
