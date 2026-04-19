// G3 — patchRepoProdEnvRegex test: verifies invalid-regex 400 path + happy
// path + existence check. Uses a fake in-memory ctx (no DB), consistent
// with `trackingMode.recompute.test.ts`.

import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../auth";
import { AuthError } from "../../auth";
import { patchRepoProdEnvRegex } from "./prodEnvRegex";

const TENANT = "11111111-2222-3333-4444-555555555555";

interface QueryLog {
  sql: string;
  params: unknown[];
}

function makeCtx(opts: { repoExists?: boolean } = {}): { ctx: Ctx; queries: QueryLog[] } {
  const queries: QueryLog[] = [];
  const repoExists = opts.repoExists ?? true;
  const ctx: Ctx = {
    tenant_id: TENANT,
    actor_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    role: "admin",
    db: {
      pg: {
        async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
          queries.push({ sql, params });
          if (/FROM repos/i.test(sql) && /SELECT id/i.test(sql)) {
            return repoExists
              ? ([{ id: "repo-uuid-1" }] as unknown as T[])
              : ([] as unknown as T[]);
          }
          if (/FROM github_deployments/i.test(sql)) {
            // 5 observed environments in last 30d.
            return [
              { environment: "production" },
              { environment: "staging" },
              { environment: "deploy-us-east" },
              { environment: "canary-eu" },
              { environment: "prod" },
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
  return { ctx, queries };
}

describe("patchRepoProdEnvRegex", () => {
  test("invalid regex → BAD_REQUEST AuthError (→ 400)", async () => {
    const { ctx } = makeCtx();
    try {
      await patchRepoProdEnvRegex(ctx, {
        provider_repo_id: "987654321",
        pattern: "((invalid",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("BAD_REQUEST");
      expect((err as AuthError).message.toLowerCase()).toContain("invalid regex");
    }
  });

  test("pattern=null → resets to default, no compilation attempt", async () => {
    const { ctx, queries } = makeCtx();
    const out = await patchRepoProdEnvRegex(ctx, {
      provider_repo_id: "987654321",
      pattern: null,
    });
    expect(out.pattern).toBeNull();
    // Default regex is applied in the matching preview → "production", "prod".
    expect(out.matching_environments_sample).toContain("production");
    expect(out.matching_environments_sample).toContain("prod");
    expect(out.matching_environments_sample).not.toContain("staging");
    // audit_log row written
    expect(queries.some((q) => /INSERT INTO audit_log/i.test(q.sql))).toBe(true);
  });

  test("custom regex matches `deploy-us-east` preview", async () => {
    const { ctx } = makeCtx();
    const out = await patchRepoProdEnvRegex(ctx, {
      provider_repo_id: "987654321",
      pattern: "^deploy-",
    });
    expect(out.pattern).toBe("^deploy-");
    expect(out.matching_environments_sample).toEqual(["deploy-us-east"]);
  });

  test("unknown repo → FORBIDDEN", async () => {
    const { ctx } = makeCtx({ repoExists: false });
    try {
      await patchRepoProdEnvRegex(ctx, {
        provider_repo_id: "0",
        pattern: null,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).code).toBe("FORBIDDEN");
    }
  });
});
