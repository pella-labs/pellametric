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
