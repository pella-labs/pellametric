// Unit tests — 90-day history backfill.
//
// Real Postgres (DATABASE_URL gate); no real GitHub (mock). We assert:
//   1. Correct pagination + `since` cutoff — older-than-cutoff PRs terminate
//      the walk (sort=updated desc break), commits paginate until empty.
//   2. 429 backoff — a seeded 429 on page 2 triggers a sleep and succeeds on
//      retry without dropping items.
//   3. Resumability — after a simulated crash mid-repo, re-running picks up
//      from the saved `next_page_cursor`.
//   4. Idempotency — completed rows are not re-walked; re-enqueue is a no-op
//      for already-seen items downstream (same payload → consumer's ON
//      CONFLICT handles the replay).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { decodePayload, type WebhookBusMessage } from "../../../ingest/src/github-app/webhookBus";
import { createLocalSemaphore } from "../github-initial-sync/semaphore";
import { createTokenBucket } from "../github-initial-sync/tokenBucket";
import {
  enqueueHistoryBackfill,
  listTrackedRepos,
  runHistoryBackfill,
  type TrackedRepo,
} from "./backfill";
import { createMockGitHubApi, makeCommits, makePulls } from "./ghApiMock";

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

async function freshInstallation(
  slug: string,
  opts?: { repos?: TrackedRepo[] },
): Promise<{ orgId: string; installationId: bigint; repos: TrackedRepo[] }> {
  if (!client) throw new Error("pg not live");
  const orgRows = (await client.unsafe(
    `INSERT INTO orgs (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [slug, `History ${slug}`],
  )) as unknown as Array<{ id: string }>;
  const orgId = orgRows[0]?.id;
  if (!orgId) throw new Error("org insert failed");

  await client.unsafe(`DELETE FROM github_history_sync_progress WHERE tenant_id = $1`, [orgId]);
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
  await client.unsafe(
    `INSERT INTO github_sync_progress
       (tenant_id, installation_id, status, completed_at, last_progress_at, updated_at)
     VALUES ($1, $2, 'completed', now(), now(), now())`,
    [orgId, installationIdNum],
  );

  const repos = opts?.repos ?? [
    { providerRepoId: "2001", fullName: "test-org/repo-a", defaultBranch: "main" },
    { providerRepoId: "2002", fullName: "test-org/repo-b", defaultBranch: "main" },
  ];
  for (const r of repos) {
    await client.unsafe(
      `INSERT INTO repos
         (id, org_id, repo_id_hash, provider, provider_repo_id, full_name,
          default_branch, first_seen_at, tracking_state)
       VALUES (gen_random_uuid(), $1, $2::bytea, 'github', $3, $4, $5, now(), 'inherit')`,
      [
        orgId,
        `\\x${Buffer.from(`gh:${r.providerRepoId}:${orgId}`).toString("hex")}`,
        r.providerRepoId,
        r.fullName,
        r.defaultBranch,
      ],
    );
  }

  return { orgId, installationId: BigInt(installationIdNum), repos };
}

function makeBucket(clock: () => number) {
  const mem = new Map<string, string>();
  return createTokenBucket({
    store: {
      async get(k) {
        return mem.get(k) ?? null;
      },
      async set(k, v) {
        mem.set(k, v);
      },
    },
    refillPerSecond: 1_000,
    burst: 1_000,
    clock,
  });
}

// ---------------------------------------------------------------------------
// Tests

describe("github-history-backfill/backfill", () => {
  runIfPg("listTrackedRepos obeys orgs.github_repo_tracking_mode", async () => {
    if (!client) throw new Error("pg not live");
    const { orgId } = await freshInstallation("gh_hist_tracked", {
      repos: [
        { providerRepoId: "3001", fullName: "test-org/a", defaultBranch: "main" },
        { providerRepoId: "3002", fullName: "test-org/b", defaultBranch: "main" },
        { providerRepoId: "3003", fullName: "test-org/c", defaultBranch: "main" },
      ],
    });
    await client.unsafe(
      `UPDATE repos SET tracking_state='excluded' WHERE org_id=$1 AND provider_repo_id=$2`,
      [orgId, "3002"],
    );
    await client.unsafe(`UPDATE orgs SET github_repo_tracking_mode='all' WHERE id=$1`, [orgId]);
    const tracked = await listTrackedRepos(client, orgId);
    expect(tracked.map((t) => t.providerRepoId).sort()).toEqual(["3001", "3003"]);

    await client.unsafe(`UPDATE orgs SET github_repo_tracking_mode='selected' WHERE id=$1`, [
      orgId,
    ]);
    await client.unsafe(
      `UPDATE repos SET tracking_state='included' WHERE org_id=$1 AND provider_repo_id=$2`,
      [orgId, "3003"],
    );
    const selected = await listTrackedRepos(client, orgId);
    expect(selected.map((t) => t.providerRepoId)).toEqual(["3003"]);
  });

  runIfPg("paginates /pulls and /commits, stops at 90d cutoff, publishes all items", async () => {
    if (!client) throw new Error("pg not live");
    const { orgId, installationId, repos } = await freshInstallation("gh_hist_pages");

    let fakeNowMs = Date.parse("2026-04-15T00:00:00Z");
    const clock = () => fakeNowMs;
    const sleep = async (ms: number) => {
      fakeNowMs += ms;
    };

    // Repo A: 250 recent pulls + 50 older-than-90d; 180 commits.
    // Repo B: 30 pulls (1 page); 60 commits (1 page).
    const repoAId = Number(repos[0]?.providerRepoId);
    const repoBId = Number(repos[1]?.providerRepoId);
    const mockOpts = {
      perPage: 100,
      clock,
      repos: [
        {
          owner: "test-org",
          name: "repo-a",
          pulls: makePulls(250, repoAId, {
            baseTs: Date.parse("2026-04-14T00:00:00Z"),
            olderTs: Date.parse("2025-12-01T00:00:00Z"),
            olderCount: 50,
          }),
          commits: makeCommits(180, repoAId, {
            baseTs: Date.parse("2026-04-14T00:00:00Z"),
          }),
        },
        {
          owner: "test-org",
          name: "repo-b",
          pulls: makePulls(30, repoBId),
          commits: makeCommits(60, repoBId),
        },
      ],
    };
    const mock = createMockGitHubApi(mockOpts);

    await enqueueHistoryBackfill({
      sql: client,
      tenantId: orgId,
      installationId,
      windowDays: 90,
      now: clock,
    });

    const published: Array<{ topic: string; msg: WebhookBusMessage }> = [];
    const report = await runHistoryBackfill({
      sql: client,
      tenantId: orgId,
      installationId,
      getInstallationToken: async () => "ghs_fake",
      semaphore: createLocalSemaphore(5),
      tokenBucket: makeBucket(clock),
      publish: async (topic, msg) => {
        published.push({ topic, msg });
      },
      fetchFn: mock.fetch,
      sleep,
      clock,
      perPage: 100,
    });

    expect(report.status).toBe("completed");
    expect(report.reposProcessed).toBe(4); // 2 repos × 2 kinds

    // Published totals: 250+30 PRs (older-than-90d NOT published) + 180+60 commits = 520.
    expect(report.prsPublished).toBe(280);
    expect(report.commitsPublished).toBe(240);
    expect(published.length).toBe(520);

    // Verify cutoff short-circuits: repo-a pulls only fetched pages until the
    // desc walk hit the 90d boundary (in page 3 of 3). No page-4 request.
    const aPullRequests = mock.history.filter(
      (h) => h.owner === "test-org" && h.name === "repo-a" && h.kind === "pulls",
    );
    // 250 recent on 3 pages of 100; older-than-cutoff all land on page 3 too
    // (sort desc), so pagination stops after page 3.
    expect(aPullRequests.map((r) => r.page).sort()).toEqual([1, 2, 3]);

    // Shape of a published PR message — consumer parses it as pull_request.opened.
    const prMsg = published.find((p) => p.msg.headers["x-github-event"] === "pull_request")!;
    const payload = decodePayload(prMsg.msg.value);
    expect(payload.event).toBe("pull_request");
    expect(payload.tenant_id).toBe(orgId);
    expect(payload.installation_id).toBe(installationId.toString());
    const body = JSON.parse(Buffer.from(payload.body_b64, "base64").toString("utf8"));
    expect(body.action).toBe("opened");
    expect(body.repository.id).toBeTypeOf("number");
    expect(body.pull_request.number).toBeTypeOf("number");

    // All rows are completed.
    const rows = (await client.unsafe(
      `SELECT provider_repo_id, kind, status, fetched
         FROM github_history_sync_progress
        WHERE tenant_id=$1 AND installation_id=$2
        ORDER BY provider_repo_id, kind`,
      [orgId, installationId.toString()],
    )) as unknown as Array<{
      provider_repo_id: string;
      kind: string;
      status: string;
      fetched: number;
    }>;
    expect(rows.length).toBe(4);
    for (const r of rows) expect(r.status).toBe("completed");
  });

  runIfPg("honors 429 with exponential backoff then succeeds", async () => {
    if (!client) throw new Error("pg not live");
    const { orgId, installationId, repos } = await freshInstallation("gh_hist_429", {
      repos: [{ providerRepoId: "4001", fullName: "test-org/single", defaultBranch: "main" }],
    });

    let fakeNowMs = Date.parse("2026-04-15T00:00:00Z");
    const clock = () => fakeNowMs;
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
      fakeNowMs += ms;
    };

    const repoId = Number(repos[0]?.providerRepoId);
    // 150 pulls → 2 pages. Page 2 first returns 429, then 200 on retry.
    // We model "429-then-200" by overriding just the first attempt via a
    // state flag.
    let page2Attempts = 0;
    const baseMock = createMockGitHubApi({
      perPage: 100,
      clock,
      repos: [
        {
          owner: "test-org",
          name: "single",
          pulls: makePulls(150, repoId),
          commits: [],
        },
      ],
    });
    const wrappedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/pulls") && url.includes("page=2")) {
        page2Attempts += 1;
        if (page2Attempts === 1) {
          return new Response(JSON.stringify({ message: "rate limited" }), {
            status: 429,
            headers: { "retry-after": "0", "content-type": "application/json" },
          });
        }
      }
      return baseMock.fetch(input, init);
    }) as unknown as typeof fetch;

    await enqueueHistoryBackfill({
      sql: client,
      tenantId: orgId,
      installationId,
      windowDays: 90,
      now: clock,
    });

    const published: WebhookBusMessage[] = [];
    const report = await runHistoryBackfill({
      sql: client,
      tenantId: orgId,
      installationId,
      getInstallationToken: async () => "ghs_fake",
      semaphore: createLocalSemaphore(5),
      tokenBucket: makeBucket(clock),
      publish: async (_topic, msg) => {
        published.push(msg);
      },
      fetchFn: wrappedFetch,
      sleep,
      clock,
      perPage: 100,
    });

    expect(report.status).toBe("completed");
    expect(report.prsPublished).toBe(150);
    expect(report.retries).toBeGreaterThanOrEqual(1);
    // A long sleep (>= 48s from min(60s · 2^0, 900s) × 0.8-jitter lower bound)
    // means the 429 path was taken.
    expect(sleepCalls.some((ms) => ms >= 48_000)).toBe(true);
    expect(page2Attempts).toBeGreaterThanOrEqual(2);
  });

  runIfPg("is resumable after a mid-repo crash via next_page_cursor", async () => {
    if (!client) throw new Error("pg not live");
    const { orgId, installationId, repos } = await freshInstallation("gh_hist_resume", {
      repos: [{ providerRepoId: "5001", fullName: "test-org/solo", defaultBranch: "main" }],
    });

    let fakeNowMs = Date.parse("2026-04-15T00:00:00Z");
    const clock = () => fakeNowMs;
    const sleep = async (ms: number) => {
      fakeNowMs += ms;
    };

    const repoId = Number(repos[0]?.providerRepoId);
    const mock = createMockGitHubApi({
      perPage: 100,
      clock,
      repos: [
        {
          owner: "test-org",
          name: "solo",
          pulls: makePulls(250, repoId),
          commits: [],
        },
      ],
    });

    // Pre-seed the progress row as if a crash happened after page 1 — so the
    // worker must resume from page 2.
    await client.unsafe(
      `INSERT INTO github_history_sync_progress
         (tenant_id, installation_id, provider_repo_id, kind, status,
          since_ts, next_page_cursor, fetched, pages_fetched, started_at,
          last_progress_at, updated_at)
       VALUES ($1, $2, $3, 'pulls', 'running', $4, '2', 100, 1, now(), now(), now())`,
      [
        orgId,
        installationId.toString(),
        "5001",
        new Date(fakeNowMs - 90 * 86_400_000).toISOString(),
      ],
    );

    const published: WebhookBusMessage[] = [];
    const report = await runHistoryBackfill({
      sql: client,
      tenantId: orgId,
      installationId,
      getInstallationToken: async () => "ghs_fake",
      semaphore: createLocalSemaphore(5),
      tokenBucket: makeBucket(clock),
      publish: async (_topic, msg) => {
        published.push(msg);
      },
      fetchFn: mock.fetch,
      sleep,
      clock,
      perPage: 100,
    });

    expect(report.status).toBe("completed");
    // We should have fetched pages 2 + 3 (NOT page 1 — that was "already done").
    const pullPages = mock.history
      .filter((h) => h.kind === "pulls")
      .map((h) => h.page)
      .sort();
    expect(pullPages).toEqual([2, 3]);
    // Published: 150 PRs from pages 2+3. The 100 from the "already done" page 1
    // are NOT republished — that's the resumability invariant.
    expect(report.prsPublished).toBe(150);
    expect(published.length).toBe(150);
  });

  runIfPg(
    "idempotent re-enqueue resets cursor; completed rows do not re-walk until forced",
    async () => {
      if (!client) throw new Error("pg not live");
      const { orgId, installationId, repos } = await freshInstallation("gh_hist_idem", {
        repos: [{ providerRepoId: "6001", fullName: "test-org/only", defaultBranch: "main" }],
      });

      let fakeNowMs = Date.parse("2026-04-15T00:00:00Z");
      const clock = () => fakeNowMs;
      const sleep = async (ms: number) => {
        fakeNowMs += ms;
      };

      const repoId = Number(repos[0]?.providerRepoId);
      const mock = createMockGitHubApi({
        perPage: 100,
        clock,
        repos: [
          {
            owner: "test-org",
            name: "only",
            pulls: makePulls(50, repoId),
            commits: makeCommits(50, repoId),
          },
        ],
      });

      await enqueueHistoryBackfill({
        sql: client,
        tenantId: orgId,
        installationId,
        windowDays: 90,
        now: clock,
      });
      await runHistoryBackfill({
        sql: client,
        tenantId: orgId,
        installationId,
        getInstallationToken: async () => "ghs_fake",
        semaphore: createLocalSemaphore(5),
        tokenBucket: makeBucket(clock),
        publish: async () => {},
        fetchFn: mock.fetch,
        sleep,
        clock,
        perPage: 100,
      });

      // Second run with NO re-enqueue — there are no queued/running rows, so
      // zero fetches to GitHub.
      const before = mock.history.length;
      const report2 = await runHistoryBackfill({
        sql: client,
        tenantId: orgId,
        installationId,
        getInstallationToken: async () => "ghs_fake",
        semaphore: createLocalSemaphore(5),
        tokenBucket: makeBucket(clock),
        publish: async () => {},
        fetchFn: mock.fetch,
        sleep,
        clock,
        perPage: 100,
      });
      expect(report2.reposProcessed).toBe(0);
      expect(mock.history.length).toBe(before);

      // Re-enqueue → rows reset to 'queued' with next_page_cursor=NULL → next
      // run walks them from the start again.
      await enqueueHistoryBackfill({
        sql: client,
        tenantId: orgId,
        installationId,
        windowDays: 90,
        now: clock,
      });
      const report3 = await runHistoryBackfill({
        sql: client,
        tenantId: orgId,
        installationId,
        getInstallationToken: async () => "ghs_fake",
        semaphore: createLocalSemaphore(5),
        tokenBucket: makeBucket(clock),
        publish: async () => {},
        fetchFn: mock.fetch,
        sleep,
        clock,
        perPage: 100,
      });
      expect(report3.reposProcessed).toBe(2);
      expect(report3.prsPublished).toBe(50);
      expect(report3.commitsPublished).toBe(50);
    },
  );
});
