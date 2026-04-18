// Unit tests for the pure session resolver — the branch-by-branch behaviour
// of `getSessionCtx` without booting Next.js' request scope.

import { beforeEach, describe, expect, test } from "bun:test";
import {
  AuthError,
  type ClickHouseClient,
  type Ctx,
  type PgClient,
  type RedisClient,
} from "@bematist/api";
import {
  DEV_ACTOR_ID_FALLBACK,
  DEV_TENANT_ID_FALLBACK,
  resolveSessionCtx,
} from "./session-resolver";

class FakeRedis implements RedisClient {
  public store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async setNx(key: string, value: string): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }
}

const fakePg: PgClient = {
  async query() {
    return [];
  },
};
const fakeCh: ClickHouseClient = {
  async query() {
    return [];
  },
};

function makeDb(redis: RedisClient): Ctx["db"] {
  return { pg: fakePg, ch: fakeCh, redis };
}

const ORG_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
});

describe("resolveSessionCtx — Better Auth cookie path", () => {
  test("validates session cookie against Redis and returns real tenant/actor/role", async () => {
    await redis.set(
      "auth:session:tok-abc",
      JSON.stringify({ user_id: USER_UUID, org_id: ORG_UUID, role: "manager" }),
    );
    const ctx = await resolveSessionCtx({
      sessionCookie: "tok-abc",
      revealHeader: null,
      env: { NODE_ENV: "production" },
      redis,
      db: makeDb(redis),
    });
    expect(ctx.tenant_id).toBe(ORG_UUID);
    expect(ctx.actor_id).toBe(USER_UUID);
    expect(ctx.role).toBe("manager");
    expect(ctx.reveal_token).toBeUndefined();
  });

  test("rejects cookie with malformed payload — falls through to other paths", async () => {
    await redis.set("auth:session:tok-bad", "not-json");
    const env = { NODE_ENV: "production" as const };
    await expect(
      resolveSessionCtx({
        sessionCookie: "tok-bad",
        revealHeader: null,
        env,
        redis,
        db: makeDb(redis),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  test("rejects cookie with unknown role — falls through", async () => {
    await redis.set(
      "auth:session:tok-role",
      JSON.stringify({ user_id: USER_UUID, org_id: ORG_UUID, role: "root" }),
    );
    await expect(
      resolveSessionCtx({
        sessionCookie: "tok-role",
        revealHeader: null,
        env: { NODE_ENV: "production" },
        redis,
        db: makeDb(redis),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("resolveSessionCtx — BEMATIST_DEV_TENANT_ID env fallback", () => {
  test("dev env pin resolves to a real UUID even under NODE_ENV=production", async () => {
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      revealHeader: null,
      env: { NODE_ENV: "production", BEMATIST_DEV_TENANT_ID: ORG_UUID },
      redis,
      db: makeDb(redis),
    });
    expect(ctx.tenant_id).toBe(ORG_UUID);
    expect(ctx.role).toBe("admin");
  });

  test("dev env pin honors BEMATIST_DEV_ACTOR_ID and BEMATIST_DEV_ROLE overrides", async () => {
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      revealHeader: null,
      env: {
        NODE_ENV: "development",
        BEMATIST_DEV_TENANT_ID: ORG_UUID,
        BEMATIST_DEV_ACTOR_ID: USER_UUID,
        BEMATIST_DEV_ROLE: "engineer",
      },
      redis,
      db: makeDb(redis),
    });
    expect(ctx.actor_id).toBe(USER_UUID);
    expect(ctx.role).toBe("engineer");
  });
});

describe("resolveSessionCtx — non-prod fallback", () => {
  test("emits a deterministic UUID that Postgres UUID cast accepts", async () => {
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      revealHeader: null,
      env: { NODE_ENV: "development" },
      redis,
      db: makeDb(redis),
    });
    expect(ctx.tenant_id).toBe(DEV_TENANT_ID_FALLBACK);
    expect(ctx.actor_id).toBe(DEV_ACTOR_ID_FALLBACK);
    // RFC 4122 shape — 8-4-4-4-12 hex.
    expect(ctx.tenant_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("prod with no cookie and no env → AuthError UNAUTHORIZED", async () => {
    await expect(
      resolveSessionCtx({
        sessionCookie: null,
        revealHeader: null,
        env: { NODE_ENV: "production" },
        redis,
        db: makeDb(redis),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("resolveSessionCtx — Better Auth PG path (M4 PR 1)", () => {
  /**
   * Fake PG client that returns the configured rows for any query. The real
   * resolver only issues one query (the session join) so this is enough;
   * we assert on params to make sure the cookie split is correct.
   */
  function makePgWithSession(rows: Array<{ id: string; org_id: string; role: string }>): {
    pg: PgClient;
    params: unknown[][];
  } {
    const params: unknown[][] = [];
    const pg: PgClient = {
      async query<T = unknown>(_sql: string, p?: unknown[]): Promise<T[]> {
        params.push(p ?? []);
        return rows as unknown as T[];
      },
    };
    return { pg, params };
  }

  test("resolves tenant/actor/role from a signed Better Auth cookie (`<token>.<sig>`)", async () => {
    const { pg, params } = makePgWithSession([{ id: USER_UUID, org_id: ORG_UUID, role: "admin" }]);
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      betterAuthCookie: "the-token.abcdef-signature",
      revealHeader: null,
      env: { NODE_ENV: "production" },
      redis,
      db: { pg, ch: fakeCh, redis },
    });
    expect(ctx.tenant_id).toBe(ORG_UUID);
    expect(ctx.actor_id).toBe(USER_UUID);
    expect(ctx.role).toBe("admin");
    // Resolver strips the signature before querying.
    expect(params[0]).toEqual(["the-token"]);
  });

  test("maps `ic` role from `users.role` to the dashboard `engineer` role", async () => {
    const { pg } = makePgWithSession([{ id: USER_UUID, org_id: ORG_UUID, role: "ic" }]);
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      betterAuthCookie: "tok.sig",
      revealHeader: null,
      env: { NODE_ENV: "production" },
      redis,
      db: { pg, ch: fakeCh, redis },
    });
    expect(ctx.role).toBe("engineer");
  });

  test("falls through when PG returns no rows (expired / revoked session)", async () => {
    const { pg } = makePgWithSession([]);
    await expect(
      resolveSessionCtx({
        sessionCookie: null,
        betterAuthCookie: "tok.sig",
        revealHeader: null,
        env: { NODE_ENV: "production" },
        redis,
        db: { pg, ch: fakeCh, redis },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("accepts unsigned cookie (no dot) by using the raw value as the token", async () => {
    const { pg, params } = makePgWithSession([
      { id: USER_UUID, org_id: ORG_UUID, role: "manager" },
    ]);
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      betterAuthCookie: "raw-token-no-sig",
      revealHeader: null,
      env: { NODE_ENV: "production" },
      redis,
      db: { pg, ch: fakeCh, redis },
    });
    expect(ctx.role).toBe("manager");
    expect(params[0]).toEqual(["raw-token-no-sig"]);
  });

  test("PG path takes priority over the legacy Redis shim when both cookies are present", async () => {
    const { pg } = makePgWithSession([{ id: "pg-user", org_id: "pg-org", role: "admin" }]);
    // Seed a legacy Redis session too; PG path should win.
    await redis.set(
      "auth:session:legacy-tok",
      JSON.stringify({
        user_id: "redis-user",
        org_id: "redis-org",
        role: "engineer",
      }),
    );
    const ctx = await resolveSessionCtx({
      sessionCookie: "legacy-tok",
      betterAuthCookie: "ba-tok.sig",
      revealHeader: null,
      env: { NODE_ENV: "production" },
      redis,
      db: { pg, ch: fakeCh, redis },
    });
    expect(ctx.tenant_id).toBe("pg-org");
    expect(ctx.actor_id).toBe("pg-user");
    expect(ctx.role).toBe("admin");
  });
});

describe("resolveSessionCtx — reveal token path", () => {
  test("stitches reveal_token when Redis `reveal:<token>` is alive", async () => {
    await redis.set("reveal:rt-xyz", `${USER_UUID}:session-1`);
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      revealHeader: "rt-xyz",
      env: { NODE_ENV: "development" },
      redis,
      db: makeDb(redis),
    });
    expect(ctx.reveal_token).toBe("rt-xyz");
  });

  test("silently drops reveal_token when Redis key is missing", async () => {
    const ctx = await resolveSessionCtx({
      sessionCookie: null,
      revealHeader: "rt-missing",
      env: { NODE_ENV: "development" },
      redis,
      db: makeDb(redis),
    });
    expect(ctx.reveal_token).toBeUndefined();
  });

  test("combines cookie auth with reveal stitching", async () => {
    await redis.set(
      "auth:session:tok-ok",
      JSON.stringify({ user_id: USER_UUID, org_id: ORG_UUID, role: "manager" }),
    );
    await redis.set("reveal:rt-ok", `${USER_UUID}:session-2`);
    const ctx = await resolveSessionCtx({
      sessionCookie: "tok-ok",
      revealHeader: "rt-ok",
      env: { NODE_ENV: "production" },
      redis,
      db: makeDb(redis),
    });
    expect(ctx.tenant_id).toBe(ORG_UUID);
    expect(ctx.reveal_token).toBe("rt-ok");
  });
});
