// G2-admin-apis — unit tests for the 5 new admin/github surfaces.
//
// These exercise the query/mutation layer (the actual security boundary
// per CLAUDE.md §API Rules). The HTTP Route Handlers are thin wrappers and
// delegate auth to these functions — so forbidden-role tests here are the
// authoritative 403-path proof.
//
// Pattern mirrors `apps/web/app/api/admin/github/routes.test.ts` from G1.

import { describe, expect, test } from "bun:test";
import { AuthError, type Ctx } from "../../auth";
import { redeliverWebhooks } from "../../mutations/github/redeliver";
import { patchRepoTracking } from "../../mutations/github/repoTracking";
import { rotateWebhookSecret } from "../../mutations/github/rotateWebhookSecret";
import { patchTrackingMode } from "../../mutations/github/trackingMode";
import { getTrackingPreview } from "./trackingPreview";

const TENANT = "11111111-2222-3333-4444-555555555555";
const ACTOR = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface PgRecordedCall {
  sql: string;
  params: unknown[] | undefined;
}

function makeCtx(
  role: Ctx["role"],
  responder: (sql: string, params?: unknown[]) => Array<Record<string, unknown>>,
  calls: PgRecordedCall[] = [],
): Ctx {
  return {
    tenant_id: TENANT,
    actor_id: ACTOR,
    role,
    db: {
      pg: {
        async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
          calls.push({ sql, params });
          return responder(sql, params) as unknown as T[];
        },
      },
      ch: {
        async query() {
          return [];
        },
      },
      redis: {
        async get() {
          return null;
        },
        async set() {},
        async setNx() {
          return true;
        },
      },
    },
  };
}

function recomputeDouble() {
  const flips: Array<{ tenant: string; newMode: "all" | "selected" }> = [];
  return {
    flips,
    emitter: {
      async emitTrackingModeFlipped(args: {
        tenant_id: string;
        newMode: "all" | "selected";
      }): Promise<number> {
        flips.push({ tenant: args.tenant_id, newMode: args.newMode });
        // Simulate 3 live sessions.
        return 3;
      },
    },
  };
}

function repoRecomputeDouble() {
  const flips: Array<{ tenant: string; repo: string; next: string }> = [];
  return {
    flips,
    emitter: {
      async emitRepoTrackingFlipped(args: {
        tenant_id: string;
        provider_repo_id: string;
        nextState: "inherit" | "included" | "excluded";
      }): Promise<number> {
        flips.push({ tenant: args.tenant_id, repo: args.provider_repo_id, next: args.nextState });
        return 2;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// PATCH /tracking-mode
// ---------------------------------------------------------------------------
describe("patchTrackingMode", () => {
  test("admin: flips mode + emits recompute + writes audit_log", async () => {
    const audit: string[] = [];
    const ctx = makeCtx("admin", (sql) => {
      if (/FROM orgs/i.test(sql) && /SELECT/i.test(sql)) {
        return [{ github_repo_tracking_mode: "all" }];
      }
      if (/UPDATE orgs/i.test(sql)) return [];
      if (/INSERT INTO audit_log/i.test(sql)) {
        audit.push(sql);
        return [];
      }
      return [];
    });
    const rc = recomputeDouble();
    const out = await patchTrackingMode(ctx, { mode: "selected" }, { recompute: rc.emitter });
    expect(out.mode).toBe("selected");
    expect(out.sessions_recompute_queued).toBe(3);
    expect(rc.flips).toEqual([{ tenant: TENANT, newMode: "selected" }]);
    expect(audit.length).toBe(1);
  });

  test("admin: unchanged mode → no emit + no UPDATE", async () => {
    let updateCount = 0;
    const ctx = makeCtx("admin", (sql) => {
      if (/FROM orgs/i.test(sql) && /SELECT/i.test(sql)) {
        return [{ github_repo_tracking_mode: "selected" }];
      }
      if (/UPDATE orgs/i.test(sql)) {
        updateCount++;
        return [];
      }
      return [];
    });
    const rc = recomputeDouble();
    const out = await patchTrackingMode(ctx, { mode: "selected" }, { recompute: rc.emitter });
    expect(out.sessions_recompute_queued).toBe(0);
    expect(rc.flips.length).toBe(0);
    expect(updateCount).toBe(0);
  });

  test("non-admin: FORBIDDEN", async () => {
    const ctx = makeCtx("engineer", () => []);
    const rc = recomputeDouble();
    await expect(
      patchTrackingMode(ctx, { mode: "selected" }, { recompute: rc.emitter }),
    ).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// PATCH /repos/:provider_repo_id/tracking
// ---------------------------------------------------------------------------
describe("patchRepoTracking", () => {
  test("admin: flips state + emits scoped recompute + audits", async () => {
    const ctx = makeCtx("admin", (sql) => {
      if (/FROM repos/i.test(sql) && /SELECT/i.test(sql)) {
        return [{ tracking_state: "inherit", id: "abc" }];
      }
      return [];
    });
    const rc = repoRecomputeDouble();
    const out = await patchRepoTracking(
      ctx,
      { provider_repo_id: "42", state: "included" },
      { recompute: rc.emitter },
    );
    expect(out.provider_repo_id).toBe("42");
    expect(out.state).toBe("included");
    expect(out.sessions_recompute_queued).toBe(2);
    expect(rc.flips).toEqual([{ tenant: TENANT, repo: "42", next: "included" }]);
  });

  test("unknown repo → FORBIDDEN (no cross-tenant leak)", async () => {
    const ctx = makeCtx("admin", () => []);
    const rc = repoRecomputeDouble();
    await expect(
      patchRepoTracking(
        ctx,
        { provider_repo_id: "999", state: "included" },
        { recompute: rc.emitter },
      ),
    ).rejects.toThrow(AuthError);
  });

  test("non-admin: FORBIDDEN", async () => {
    const ctx = makeCtx("viewer", () => []);
    const rc = repoRecomputeDouble();
    await expect(
      patchRepoTracking(
        ctx,
        { provider_repo_id: "42", state: "included" },
        { recompute: rc.emitter },
      ),
    ).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// GET /tracking-preview
// ---------------------------------------------------------------------------
describe("getTrackingPreview", () => {
  test("admin: computes would-flip counts + samples; no writes", async () => {
    const writes: string[] = [];
    const ctx = makeCtx("admin", (sql) => {
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
        writes.push(sql);
        return [];
      }
      if (/FROM repos/i.test(sql)) {
        return [
          { provider_repo_id: "1", tracking_state: "inherit" },
          { provider_repo_id: "2", tracking_state: "excluded" },
          { provider_repo_id: "3", tracking_state: "included" },
        ];
      }
      if (/session_repo_eligibility/i.test(sql)) {
        return [
          {
            session_id: "00000000-0000-0000-0000-000000000001",
            current_eligible: true,
            provider_repo_ids: ["2"], // now-excluded → would become ineligible
          },
          {
            session_id: "00000000-0000-0000-0000-000000000002",
            current_eligible: false,
            provider_repo_ids: ["1"], // mode=selected + in override → would become eligible
          },
          {
            session_id: "00000000-0000-0000-0000-000000000003",
            current_eligible: true,
            provider_repo_ids: ["3"], // included → stays eligible
          },
        ];
      }
      return [];
    });
    const out = await getTrackingPreview(ctx, { mode: "selected", included_repos: ["1"] });
    expect(writes.length).toBe(0); // NO WRITES
    expect(out.sessions_that_would_become_eligible).toBe(1);
    expect(out.sessions_that_would_become_ineligible).toBe(1);
    expect(out.sample_eligible_sessions.length).toBe(1);
    expect(out.sample_ineligible_sessions.length).toBe(1);
  });

  test("non-admin: FORBIDDEN", async () => {
    const ctx = makeCtx("engineer", () => []);
    await expect(getTrackingPreview(ctx, { mode: "all", included_repos: [] })).rejects.toThrow(
      AuthError,
    );
  });
});

// ---------------------------------------------------------------------------
// POST /webhook-secret/rotate
// ---------------------------------------------------------------------------
describe("rotateWebhookSecret", () => {
  test("admin: swaps columns + sets rotated_at + audits", async () => {
    const pgCalls: PgRecordedCall[] = [];
    const ctx = makeCtx(
      "admin",
      (sql) => {
        if (/SELECT installation_id/i.test(sql)) return [{ installation_id: "777" }];
        if (/UPDATE github_installations/i.test(sql)) {
          return [
            {
              webhook_secret_previous_ref: "old_ref",
              webhook_secret_active_ref: "new_ref_v2",
              webhook_secret_rotated_at: new Date("2026-04-18T12:00:00Z"),
            },
          ];
        }
        return [];
      },
      pgCalls,
    );
    const fixedNow = () => new Date("2026-04-18T12:00:00Z");
    const out = await rotateWebhookSecret(ctx, { new_secret_ref: "new_ref_v2" }, { now: fixedNow });
    expect(out.installation_id).toBe("777");
    expect(out.new_secret_ref).toBe("new_ref_v2");
    expect(out.rotated_at).toBe("2026-04-18T12:00:00.000Z");
    expect(out.window_expires_at).toBe("2026-04-18T12:10:00.000Z");
    // Audit row written.
    expect(pgCalls.some((c) => /INSERT INTO audit_log/i.test(c.sql))).toBe(true);
  });

  test("no installation → FORBIDDEN", async () => {
    const ctx = makeCtx("admin", () => []);
    await expect(rotateWebhookSecret(ctx, { new_secret_ref: "x" })).rejects.toThrow(AuthError);
  });

  test("non-admin: FORBIDDEN", async () => {
    const ctx = makeCtx("viewer", () => []);
    await expect(rotateWebhookSecret(ctx, { new_secret_ref: "x" })).rejects.toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// POST /redeliver
// ---------------------------------------------------------------------------
describe("redeliverWebhooks", () => {
  test("admin: lists deliveries + POSTs attempts + audits", async () => {
    const ctx = makeCtx("admin", (sql) => {
      if (/FROM github_installations/i.test(sql)) return [{ installation_id: "777" }];
      return [];
    });
    const calls: Array<{ method: "GET" | "POST"; url: string }> = [];
    const sleepSteps: number[] = [];
    const sleep = async (ms: number) => {
      sleepSteps.push(ms);
    };
    let getPage = 0;
    const http = {
      async get(url: string) {
        calls.push({ method: "GET", url });
        getPage++;
        if (getPage === 1) {
          return {
            status: 200,
            body: [
              {
                id: 101,
                guid: "a",
                delivered_at: "2026-04-10T01:00:00Z",
                event: "pull_request",
                installation_id: 777,
              },
              {
                id: 102,
                guid: "b",
                delivered_at: "2026-04-10T01:30:00Z",
                event: "push",
                installation_id: 777,
              },
              {
                id: 103,
                guid: "c",
                delivered_at: "2026-04-10T01:45:00Z",
                event: "pull_request",
                installation_id: 999, // other installation — skipped
              },
            ],
            headers: {},
          };
        }
        return { status: 200, body: [], headers: {} };
      },
      async post(url: string) {
        calls.push({ method: "POST", url });
        return { status: 202, body: {}, headers: {} };
      },
    };
    const out = await redeliverWebhooks(
      ctx,
      {
        from: "2026-04-10T00:00:00.000Z",
        to: "2026-04-10T23:59:59.000Z",
        event_types: ["pull_request", "push"],
      },
      {
        http,
        appJwtProvider: async () => "jwt-test",
        sleep,
        now: () => 0,
      },
    );
    // installation_id=999 is filtered.
    expect(out.deliveries_requested).toBe(2);
    expect(out.queued_attempts).toBe(2);
    expect(out.failed_attempts).toBe(0);
    // Posts were made to 101 and 102.
    const postUrls = calls.filter((c) => c.method === "POST").map((c) => c.url);
    expect(postUrls).toEqual([
      "https://api.github.com/app/hook/deliveries/101/attempts",
      "https://api.github.com/app/hook/deliveries/102/attempts",
    ]);
    // Rate-limit floor → at least 3 sleep ticks (1 pre-list + 2 pre-POSTs).
    expect(sleepSteps.filter((n) => n === 1000).length).toBeGreaterThanOrEqual(3);
  });

  test("non-admin: FORBIDDEN", async () => {
    const ctx = makeCtx("engineer", () => []);
    await expect(
      redeliverWebhooks(
        ctx,
        { from: "2026-04-10T00:00:00Z", to: "2026-04-10T23:59:59Z" },
        {
          http: {
            async get() {
              return { status: 200, body: [], headers: {} };
            },
            async post() {
              return { status: 202, body: {}, headers: {} };
            },
          },
          appJwtProvider: async () => "jwt",
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow(AuthError);
  });

  test("429 → retries with backoff via Retry-After", async () => {
    const ctx = makeCtx("admin", (sql) => {
      if (/FROM github_installations/i.test(sql)) return [{ installation_id: "777" }];
      return [];
    });
    const sleepSteps: number[] = [];
    const sleep = async (ms: number) => {
      sleepSteps.push(ms);
    };
    let postCount = 0;
    let getCount = 0;
    const http = {
      async get() {
        getCount++;
        if (getCount === 1) {
          return {
            status: 200,
            body: [
              {
                id: 1,
                guid: "x",
                delivered_at: "2026-04-10T01:00:00Z",
                event: "push",
                installation_id: 777,
              },
            ],
            headers: {},
          };
        }
        return { status: 200, body: [], headers: {} };
      },
      async post() {
        postCount++;
        if (postCount === 1) {
          return { status: 429, body: {}, headers: { "retry-after": "2" } };
        }
        return { status: 202, body: {}, headers: {} };
      },
    };
    const out = await redeliverWebhooks(
      ctx,
      { from: "2026-04-10T00:00:00Z", to: "2026-04-10T23:59:59Z" },
      {
        http,
        appJwtProvider: async () => "jwt",
        sleep,
        now: () => 0,
      },
    );
    expect(out.queued_attempts).toBe(1);
    // Retry-After=2 → slept 2000ms (plus jitter 0–400ms).
    expect(sleepSteps.some((n) => n >= 2000 && n < 2500)).toBe(true);
  });
});
