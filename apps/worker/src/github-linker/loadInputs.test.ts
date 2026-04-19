// Integration tests for the real linker `loadInputs` wiring (B4b).
// Seeds Postgres (orgs, github_installations, repos, github_pull_requests,
// github_deployments, repo_id_hash_aliases) + ClickHouse `events` and asserts
// loadInputs assembles a correct LinkerInputs shape keyed on (tenant_id,
// session_id). Skips gracefully when PG or CH is unreachable so the unit
// suite stays green on developer machines without docker-compose up.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import postgres, { type Sql } from "postgres";
import { loadInputs } from "./loadInputs";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";

const SHA = (n: number): string => n.toString(16).padStart(40, "0");

async function canConnectPg(sql: Sql): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function canConnectCh(ch: ClickHouseClient): Promise<boolean> {
  try {
    await ch.query({ query: "SELECT 1", format: "JSONEachRow" });
    return true;
  } catch {
    return false;
  }
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 4, onnotice: () => {} });
const ch = createClient({ url: CLICKHOUSE_URL, database: CLICKHOUSE_DATABASE });
let skip = false;

let tenantId: string;
let sessionId: string;

async function seedTenant(): Promise<string> {
  const rows = (await sql<Array<{ id: string }>>`
    INSERT INTO orgs (name, slug)
    VALUES ('linker-loadinputs-test', ${`loadinputs-${Date.now()}-${Math.random()}`})
    RETURNING id`) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

async function seedRepo(providerRepoId: string, trackingState = "inherit"): Promise<void> {
  await sql.unsafe(
    `INSERT INTO repos
       (id, org_id, repo_id_hash, provider, provider_repo_id,
        full_name, default_branch, first_seen_at, tracking_state)
     VALUES ($1, $2, $3, 'github', $4, $5, 'main', now(), $6)
     ON CONFLICT (provider, provider_repo_id)
       WHERE provider_repo_id IS NOT NULL
       DO UPDATE SET tracking_state = EXCLUDED.tracking_state`,
    [
      randomUUID(),
      tenantId,
      `gh:pending:${tenantId}:${providerRepoId}`,
      providerRepoId,
      `org/repo-${providerRepoId}`,
      trackingState,
    ],
  );
}

let installationCounter = BigInt(Date.now()) * 1_000n;
async function seedInstallation(localId: string, status = "active"): Promise<void> {
  // installation_id is globally UNIQUE per the schema; derive a monotonically
  // increasing id so parallel test runs don't collide.
  installationCounter += 1n;
  await sql.unsafe(
    `INSERT INTO github_installations
       (tenant_id, installation_id, github_org_id, github_org_login, app_id,
        status, token_ref, webhook_secret_active_ref)
     VALUES ($1, $2::bigint, $3::bigint, $4, $5::bigint, $6, 'sm/tok', 'sm/webhook')`,
    [
      tenantId,
      installationCounter.toString(),
      installationCounter.toString(),
      `test-org-${localId}`,
      "99999",
      status,
    ],
  );
}

async function seedPullRequest(providerRepoId: string, prNumber: number, headSha: string) {
  await sql.unsafe(
    `INSERT INTO github_pull_requests
       (tenant_id, provider, provider_repo_id, pr_number, pr_node_id, state,
        title_hash, base_ref, head_ref, head_sha, merge_commit_sha,
        author_login_hash, additions, deletions, changed_files, commits_count,
        opened_at, ingested_at, updated_at)
     VALUES ($1, 'github', $2, $3, 'node', 'open',
             decode(repeat('ab', 32), 'hex'), 'main', 'feature', $4, NULL,
             decode(repeat('cd', 32), 'hex'), 1, 1, 1, 1,
             now(), now(), now())`,
    [tenantId, providerRepoId, prNumber, headSha],
  );
}

async function seedDeployment(providerRepoId: string, depId: bigint, sha: string) {
  await sql.unsafe(
    `INSERT INTO github_deployments
       (tenant_id, provider_repo_id, deployment_id, environment, sha, ref, status)
     VALUES ($1, $2, $3, 'production', $4, 'main', 'success')`,
    [tenantId, providerRepoId, depId.toString(), sha],
  );
}

async function seedAlias(): Promise<void> {
  const oldHash = Buffer.alloc(32, 1);
  const newHash = Buffer.alloc(32, 2);
  await sql.unsafe(
    `INSERT INTO repo_id_hash_aliases
       (tenant_id, old_hash, new_hash, reason, migrated_at, retires_at)
     VALUES ($1, $2, $3, 'rename', now(), now() + interval '180 days')`,
    [tenantId, oldHash, newHash],
  );
}

async function seedChEvents(commitSha: string, prNumber: number | null): Promise<void> {
  const tsStr = "2026-04-18 12:00:00";
  await ch.insert({
    table: "events",
    values: [
      {
        client_event_id: randomUUID(),
        schema_version: 1,
        ts: tsStr,
        org_id: tenantId,
        engineer_id: "eng-1",
        device_id: "dev-1",
        source: "claude-code",
        fidelity: "full",
        cost_estimated: false,
        tier: "B",
        session_id: sessionId,
        event_seq: 1,
        event_kind: "session_start",
        pr_number: prNumber,
        commit_sha: commitSha,
      },
    ],
    format: "JSONEachRow",
  });
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DELETE FROM github_pull_requests WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM github_deployments WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM github_installations WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM repo_id_hash_aliases WHERE tenant_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM repos WHERE org_id = $1`, [tenantId]);
  await sql.unsafe(`DELETE FROM orgs WHERE id = $1`, [tenantId]);
  await ch.command({
    query: `ALTER TABLE events DELETE WHERE org_id = {tid:String}`,
    query_params: { tid: tenantId },
  });
}

beforeAll(async () => {
  const ok = (await canConnectPg(sql)) && (await canConnectCh(ch));
  skip = !ok;
});
afterAll(async () => {
  await sql.end();
  await ch.close();
});
beforeEach(async () => {
  if (skip) return;
  tenantId = await seedTenant();
  sessionId = randomUUID();
});

describe("loadInputs — assembles LinkerInputs from PG + CH", () => {
  test("skip-note when DATABASE_URL or CLICKHOUSE_URL unreachable", () => {
    if (!skip) return;
    expect(skip).toBe(true);
  });

  test("assembles installation + repo + pr + deployment + alias + session shas", async () => {
    if (skip) return;
    const providerRepoId = `loadtest-${Date.now()}`;
    const sha = SHA(7);
    await seedInstallation("1001");
    await seedRepo(providerRepoId);
    await seedPullRequest(providerRepoId, 42, sha);
    await seedDeployment(providerRepoId, 99n, sha);
    await seedAlias();
    await seedChEvents(sha, 42);

    const inputs = await loadInputs({ sql, ch }, tenantId, sessionId);
    expect(inputs).not.toBeNull();
    if (!inputs) throw new Error("unreachable");
    expect(inputs.tenant_id).toBe(tenantId);
    expect(inputs.tenant_mode).toBe("all");
    expect(inputs.installations.some((i) => i.status === "active")).toBe(true);
    expect(inputs.installation_status).toBe("active");
    expect(inputs.repos.some((r) => r.provider_repo_id === providerRepoId)).toBe(true);
    expect(inputs.session.session_id).toBe(sessionId);
    expect(inputs.session.commit_shas).toContain(sha);
    expect(inputs.session.pr_numbers).toContain(42);
    expect(inputs.pull_requests.some((p) => p.pr_number === 42)).toBe(true);
    expect(inputs.deployments.some((d) => d.sha === sha)).toBe(true);
    expect(inputs.aliases.length).toBeGreaterThan(0);
    expect(inputs.tombstones).toEqual([]);
    await cleanup();
  });

  test("returns null when orgs row is absent (tenant hard-deleted)", async () => {
    if (skip) return;
    await sql.unsafe(`DELETE FROM orgs WHERE id = $1`, [tenantId]);
    const inputs = await loadInputs({ sql, ch }, tenantId, sessionId);
    expect(inputs).toBeNull();
  });

  test("empty CH events → returns inputs with empty session shas (doesn't throw)", async () => {
    if (skip) return;
    const providerRepoId = `loadtest-empty-${Date.now()}`;
    await seedInstallation("1002");
    await seedRepo(providerRepoId);
    const inputs = await loadInputs({ sql, ch }, tenantId, sessionId);
    expect(inputs).not.toBeNull();
    if (!inputs) throw new Error("unreachable");
    expect(inputs.session.commit_shas).toEqual([]);
    expect(inputs.session.pr_numbers).toEqual([]);
    expect(inputs.pull_requests).toEqual([]);
    expect(inputs.deployments).toEqual([]);
    await cleanup();
  });
});
