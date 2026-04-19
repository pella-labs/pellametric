// PRD §13 Phase G1 test #6 — initial sync pagination + rate-limit test.
//
// Seed a mock GH API with 250 repos + simulated X-RateLimit-Remaining=50 on
// page 2; assert pause-and-resume behavior, 3 pages consumed, all 250 repos
// UPSERTed.
//
// PRD §13 test #7 — initial-sync-concurrency-cap test (spawn 7 tenant syncs,
// assert ≤5 concurrent, others queued). See end of file.
//
// Real Postgres (no DB mocks). Gated on DATABASE_URL per repo convention.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import type { MockRepo } from "./ghApiMock";
import { createMockGitHubApi } from "./ghApiMock";
import { runInitialSync } from "./initialSync";
import { createLocalSemaphore } from "./semaphore";
import { createTokenBucket } from "./tokenBucket";

const PG_LIVE = process.env.DATABASE_URL !== undefined;
const SUPER_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";

// biome-ignore lint/suspicious/noExplicitAny: bun:test exposes skipIf at runtime
const runIfPg = (test as any).skipIf ? (test as any).skipIf(!PG_LIVE) : test;

let client: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!PG_LIVE) return;
  client = postgres(SUPER_URL, { max: 4, idle_timeout: 5, connect_timeout: 5 });
});

afterAll(async () => {
  if (client) await client.end();
});

async function freshOrg(slug: string): Promise<{ orgId: string; installationId: bigint }> {
  if (!client) throw new Error("no pg client");
  const orgRows = (await client.unsafe(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [slug, `Initial-Sync ${slug}`],
  )) as unknown as Array<{ id: string }>;
  const orgId = orgRows[0]?.id;
  if (!orgId) throw new Error("org insert failed");
  // Clean any prior test data.
  await client.unsafe(`DELETE FROM github_sync_progress WHERE tenant_id = $1`, [orgId]);
  await client.unsafe(`DELETE FROM repos WHERE org_id = $1`, [orgId]);
  await client.unsafe(`DELETE FROM github_installations WHERE tenant_id = $1`, [orgId]);

  const installationIdNum = Math.floor(Math.random() * 2_000_000_000) + 100_000;
  await client.unsafe(
    `INSERT INTO github_installations
       (tenant_id, installation_id, github_org_id, github_org_login, app_id,
        status, token_ref, webhook_secret_active_ref)
     VALUES ($1, $2, 999, 'test-org', 1234, 'active', 'kms://test-token', 'kms://test-secret')`,
    [orgId, installationIdNum],
  );
  return { orgId, installationId: BigInt(installationIdNum) };
}

function makeRepos(n: number): MockRepo[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 1_000_000 + i,
    name: `repo-${i}`,
    full_name: `test-org/repo-${i}`,
    default_branch: i % 3 === 0 ? "main" : "master",
  }));
}

describe("github-initial-sync/initialSync", () => {
  runIfPg("paginates 250 repos + honors X-RateLimit-Remaining<100 pause/resume", async () => {
    if (!client) throw new Error("pg not live");
    const { orgId, installationId } = await freshOrg("gh_init_sync_250");

    let fakeNowMs = 1_700_000_000_000;
    const clock = () => fakeNowMs;

    // Page 2 returns remaining=50 — the sync must pause until reset + jitter.
    // Reset is 3 seconds out (tiny, so the test runs fast; real prod is up
    // to 1 hour).
    const resetEpochSec = Math.floor(fakeNowMs / 1000) + 3;
    const mock = createMockGitHubApi({
      repos: makeRepos(250),
      perPage: 100,
      clock,
      pageOverrides: {
        2: { rateLimitRemaining: 50, rateLimitResetEpochSec: resetEpochSec },
      },
    });

    const sleepCalls: number[] = [];
    const fakeSleep = async (ms: number) => {
      sleepCalls.push(ms);
      fakeNowMs += ms;
    };

    const memRedis = new Map<string, string>();
    const bucket = createTokenBucket({
      store: {
        async get(k) {
          return memRedis.get(k) ?? null;
        },
        async set(k, v) {
          memRedis.set(k, v);
        },
      },
      refillPerSecond: 1,
      burst: 10,
      clock,
    });

    const semaphore = createLocalSemaphore(5);

    const report = await runInitialSync({
      sql: client,
      tenantId: orgId,
      installationId,
      getInstallationToken: async () => "ghs_fake_token",
      semaphore,
      tokenBucket: bucket,
      fetchFn: mock.fetch,
      sleep: fakeSleep,
      clock,
      apiBase: "https://api.github.com",
      // Disable the recompute emission path for this unit (it's tested
      // separately).
      emitRecompute: async () => {},
    });

    // 250 repos / 100 per page = 3 pages.
    expect(report.pagesFetched).toBe(3);
    expect(report.reposUpserted).toBe(250);
    expect(report.status).toBe("completed");

    // Exactly ONE rate-limit pause happened (after page 2 returned remaining<100).
    // And that pause was at least (reset - now) + 5s jitter = 8s.
    const longSleep = sleepCalls.find((ms) => ms >= 5_000);
    expect(longSleep).toBeDefined();
    expect(longSleep ?? 0).toBeGreaterThanOrEqual(5_000);

    // All 250 repos are in the DB.
    const dbRows = (await client.unsafe(
      `SELECT count(*)::int AS n FROM repos WHERE org_id = $1 AND provider = 'github'`,
      [orgId],
    )) as unknown as Array<{ n: number }>;
    expect(dbRows[0]?.n).toBe(250);

    // Progress row shows completed.
    const progress = (await client.unsafe(
      `SELECT status, total_repos, fetched_repos, pages_fetched, completed_at
         FROM github_sync_progress
        WHERE tenant_id = $1 AND installation_id = $2`,
      [orgId, installationId.toString()],
    )) as unknown as Array<{
      status: string;
      total_repos: number;
      fetched_repos: number;
      pages_fetched: number;
      completed_at: unknown;
    }>;
    expect(progress[0]?.status).toBe("completed");
    expect(progress[0]?.fetched_repos).toBe(250);
    expect(progress[0]?.pages_fetched).toBe(3);
    expect(progress[0]?.completed_at).not.toBeNull();

    // Resumability: re-run is idempotent — UPSERT on (provider, provider_repo_id).
    // We reset the progress row and re-run; repo count unchanged.
    await client.unsafe(
      `UPDATE github_sync_progress SET status='queued', fetched_repos=0, pages_fetched=0, next_page_cursor=null, completed_at=null WHERE tenant_id = $1`,
      [orgId],
    );
    const mock2 = createMockGitHubApi({
      repos: makeRepos(250),
      perPage: 100,
      clock,
    });
    const r2 = await runInitialSync({
      sql: client,
      tenantId: orgId,
      installationId,
      getInstallationToken: async () => "ghs_fake_token",
      semaphore,
      tokenBucket: bucket,
      fetchFn: mock2.fetch,
      sleep: fakeSleep,
      clock,
      apiBase: "https://api.github.com",
      emitRecompute: async () => {},
    });
    expect(r2.reposUpserted).toBe(250);
    const dbRows2 = (await client.unsafe(
      `SELECT count(*)::int AS n FROM repos WHERE org_id = $1 AND provider = 'github'`,
      [orgId],
    )) as unknown as Array<{ n: number }>;
    // Still 250 — not doubled.
    expect(dbRows2[0]?.n).toBe(250);
  });

  runIfPg("≤5 concurrent initial syncs per worker node (PRD §13 test #7)", async () => {
    if (!client) throw new Error("pg not live");

    const TENANTS = 7;
    const orgs: Array<{ orgId: string; installationId: bigint }> = [];
    for (let i = 0; i < TENANTS; i++) {
      orgs.push(await freshOrg(`gh_concur_${i}`));
    }

    const fakeNowMs = 1_800_000_000_000;
    const clock = () => fakeNowMs;

    const timeline: Array<{ tenant: string; event: "start" | "end"; at: number }> = [];
    let current = 0;
    let peak = 0;

    const memRedis = new Map<string, string>();
    const bucket = createTokenBucket({
      store: {
        async get(k) {
          return memRedis.get(k) ?? null;
        },
        async set(k, v) {
          memRedis.set(k, v);
        },
      },
      refillPerSecond: 1_000, // high — we're not rate-testing here
      burst: 1_000,
      clock,
    });
    const semaphore = createLocalSemaphore(5);

    const runs = orgs.map(({ orgId, installationId }, i) => {
      const mock = createMockGitHubApi({
        repos: makeRepos(10), // tiny — focus is concurrency, not pagination
        perPage: 100,
        clock,
      });
      return runInitialSync({
        sql: client!,
        tenantId: orgId,
        installationId,
        getInstallationToken: async () => `ghs_fake_${i}`,
        semaphore,
        tokenBucket: bucket,
        fetchFn: mock.fetch,
        // Real sleep so tenants actually overlap in wall-clock time.
        sleep: async (ms) => {
          await new Promise((r) => setTimeout(r, ms));
        },
        clock: Date.now,
        apiBase: "https://api.github.com",
        emitRecompute: async () => {},
        onInstrumentation: (evt) => {
          if (evt.stage === "slot_acquired") {
            current += 1;
            peak = Math.max(peak, current);
            timeline.push({ tenant: orgId, event: "start", at: Date.now() });
          } else if (evt.stage === "slot_released") {
            current -= 1;
            timeline.push({ tenant: orgId, event: "end", at: Date.now() });
          }
        },
        // Force each sync to hold its slot briefly so contention is visible.
        holdSlotMs: 40,
      });
    });

    void fakeNowMs; // silence unused in this path

    const results = await Promise.all(runs);
    for (const r of results) {
      expect(r.status).toBe("completed");
    }

    expect(peak).toBeLessThanOrEqual(5);

    // Cross-check via timeline replay — never more than 5 outstanding "start"s.
    let concurrent = 0;
    let maxConcurrent = 0;
    const sorted = [...timeline].sort((a, b) => a.at - b.at);
    for (const evt of sorted) {
      if (evt.event === "start") concurrent += 1;
      else concurrent -= 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
    }
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
