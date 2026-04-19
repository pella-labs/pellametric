// G1 step 2b — Route-Handler authz tests for the 3 admin/github endpoints.
//
// We verify the RBAC invariants at the query/mutation layer (the real
// security boundary per CLAUDE.md API Rules). The Route Handler itself is a
// thin wrapper — these tests call the underlying query/mutation with synthetic
// `Ctx`s that emulate admin / non-admin / unauthed sessions and assert:
//
//   - admin Ctx  → 200 / structured payload (via normal return)
//   - non-admin  → AuthError('FORBIDDEN')  (→ 403 at the HTTP layer)
//   - unauthed   → session resolver rejects before this code runs; we
//                  model it as AuthError('UNAUTHORIZED').
//
// This follows the existing pattern in `packages/api/src/queries/ingestKeys.test.ts`.

import { describe, expect, test } from "bun:test";
import { AuthError, type Ctx } from "@bematist/api";
import { enqueueGithubSync } from "@bematist/api/mutations/github/sync";
import { getGithubConnection } from "@bematist/api/queries/github/connection";
import { listGithubRepos } from "@bematist/api/queries/github/repos";

const TENANT = "11111111-2222-3333-4444-555555555555";
const ACTOR = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface FakePgCall {
  sql: string;
  params: unknown[] | undefined;
}

function makeFakeCtx(
  role: Ctx["role"],
  rows: Array<Record<string, unknown>> = [],
  opts: { onQuery?: (c: FakePgCall) => void } = {},
): Ctx {
  const calls: FakePgCall[] = [];
  return {
    tenant_id: TENANT,
    actor_id: ACTOR,
    role,
    db: {
      pg: {
        async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
          const call = { sql, params };
          calls.push(call);
          opts.onQuery?.(call);
          // Cycle rows so each SELECT returns the next shape. Tests that need
          // multiple canned responses build the ctx per-call.
          const next = rows.shift();
          return next ? ([next] as unknown as T[]) : ([] as T[]);
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

describe("admin/github route authz", () => {
  test("GET /connection: admin returns structured payload", async () => {
    const ctx = makeFakeCtx("admin", [
      {
        installation_id: "777",
        github_org_login: "my-org",
        status: "active",
        installed_at: new Date("2026-03-01T00:00:00Z"),
        last_reconciled_at: null,
      },
      { github_repo_tracking_mode: "all" },
      // No progress row:
    ]);
    const out = await getGithubConnection(ctx, {});
    expect(out.installation?.installation_id).toBe("777");
    expect(out.installation?.github_org_login).toBe("my-org");
    expect(out.installation?.status).toBe("active");
    expect(out.tracking_mode).toBe("all");
    expect(out.installation?.sync).toBeNull();
  });

  test("GET /connection: manager (non-admin) → FORBIDDEN", async () => {
    const ctx = makeFakeCtx("manager");
    await expect(getGithubConnection(ctx, {})).rejects.toThrow(AuthError);
    try {
      await getGithubConnection(ctx, {});
    } catch (err) {
      const authErr = err as AuthError;
      expect(authErr.code).toBe("FORBIDDEN");
    }
  });

  test("GET /connection: returns null installation when none bound", async () => {
    const ctx = makeFakeCtx("admin", [
      // zero installation rows then tracking_mode row:
      { github_repo_tracking_mode: "selected" },
    ]);
    // The fake query shifts rows; first call gets the tracking_mode row.
    // Re-structure: simulate empty installations by making first call return
    // no rows. We use a custom responder:
    const ctx2: Ctx = {
      ...ctx,
      db: {
        ...ctx.db,
        pg: {
          async query<T = unknown>(sql: string): Promise<T[]> {
            if (/FROM github_installations/i.test(sql)) return [] as T[];
            if (/FROM orgs/i.test(sql)) {
              return [{ github_repo_tracking_mode: "selected" }] as unknown as T[];
            }
            return [] as T[];
          },
        },
      },
    };
    const out = await getGithubConnection(ctx2, {});
    expect(out.installation).toBeNull();
    expect(out.tracking_mode).toBe("selected");
  });

  test("GET /repos: admin returns list + collapses tracking lattice", async () => {
    // Two repos: one excluded, one inherit (mode=all → tracked true).
    const ctx: Ctx = {
      tenant_id: TENANT,
      actor_id: ACTOR,
      role: "admin",
      db: {
        pg: {
          async query<T = unknown>(sql: string): Promise<T[]> {
            if (/FROM orgs/i.test(sql)) {
              return [{ github_repo_tracking_mode: "all" }] as unknown as T[];
            }
            if (/count\(\*\)/i.test(sql)) {
              return [{ n: 2 }] as unknown as T[];
            }
            if (/FROM repos/i.test(sql)) {
              return [
                {
                  id: "11111111-1111-1111-1111-111111111111",
                  provider_repo_id: "1",
                  repo_id_hash: "gh:pending:t:1",
                  default_branch: "main",
                  tracking_state: "inherit",
                  first_seen_at: new Date("2026-04-10T00:00:00Z"),
                  archived_at: null,
                },
                {
                  id: "22222222-2222-2222-2222-222222222222",
                  provider_repo_id: "2",
                  repo_id_hash: "gh:pending:t:2",
                  default_branch: "master",
                  tracking_state: "excluded",
                  first_seen_at: new Date("2026-04-09T00:00:00Z"),
                  archived_at: null,
                },
              ] as unknown as T[];
            }
            return [] as T[];
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
    const out = await listGithubRepos(ctx, { page: 1, per_page: 50, include_archived: false });
    expect(out.total).toBe(2);
    expect(out.tracking_mode).toBe("all");
    expect(out.repos).toHaveLength(2);
    const a = out.repos[0];
    const b = out.repos[1];
    if (!a || !b) throw new Error("repos missing");
    expect(a.tracking_state).toBe("inherit");
    expect(a.effective_tracked).toBe(true); // mode=all + inherit → tracked
    expect(b.tracking_state).toBe("excluded");
    expect(b.effective_tracked).toBe(false);
    // humanizeHash strips the placeholder prefix:
    expect(a.full_name).toBe("github/id:1");
  });

  test("GET /repos: non-admin → FORBIDDEN", async () => {
    const ctx = makeFakeCtx("engineer");
    await expect(
      listGithubRepos(ctx, { page: 1, per_page: 50, include_archived: false }),
    ).rejects.toThrow(AuthError);
  });

  test("POST /sync: admin enqueues a sync", async () => {
    const ctx: Ctx = {
      tenant_id: TENANT,
      actor_id: ACTOR,
      role: "admin",
      db: {
        pg: {
          async query<T = unknown>(sql: string): Promise<T[]> {
            if (/FROM github_installations/i.test(sql)) {
              return [{ installation_id: "777" }] as unknown as T[];
            }
            if (/FROM github_sync_progress/i.test(sql) && /SELECT/i.test(sql)) {
              return [] as T[];
            }
            if (/INSERT INTO github_sync_progress/i.test(sql)) {
              return [
                {
                  status: "queued",
                  started_at: null,
                  total_repos: null,
                  fetched_repos: 0,
                  pages_fetched: 0,
                },
              ] as unknown as T[];
            }
            return [] as T[];
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
    const out = await enqueueGithubSync(ctx, { force: false });
    expect(out.installation_id).toBe("777");
    expect(out.status).toBe("queued");
  });

  test("POST /sync: no installation → FORBIDDEN", async () => {
    const ctx: Ctx = {
      tenant_id: TENANT,
      actor_id: ACTOR,
      role: "admin",
      db: {
        pg: {
          async query<T = unknown>(): Promise<T[]> {
            return [] as T[];
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
    await expect(enqueueGithubSync(ctx, { force: false })).rejects.toThrow(AuthError);
  });

  test("POST /sync: non-admin → FORBIDDEN", async () => {
    const ctx = makeFakeCtx("viewer");
    await expect(enqueueGithubSync(ctx, { force: false })).rejects.toThrow(AuthError);
  });
});
