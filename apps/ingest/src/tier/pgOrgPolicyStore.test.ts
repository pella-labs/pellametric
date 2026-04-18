import { describe, expect, test } from "bun:test";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createPgOrgPolicyStore } from "./pgOrgPolicyStore";

function makeStubDb(queue: Array<Array<Record<string, unknown>>>) {
  let calls = 0;
  const chain = {
    select(_cols: unknown) {
      return chain;
    },
    from(_t: unknown) {
      return chain;
    },
    where(_c: unknown) {
      return chain;
    },
    async limit(_n: number) {
      const next = queue.shift() ?? [];
      calls++;
      return next;
    },
  };
  return {
    db: chain as unknown as PostgresJsDatabase<Record<string, unknown>>,
    callCount: () => calls,
  };
}

describe("createPgOrgPolicyStore", () => {
  test("returns null when no policies row exists (trigger out of sync)", async () => {
    const { db } = makeStubDb([[]]);
    const store = createPgOrgPolicyStore({ db });
    expect(await store.get("missing-uuid")).toBeNull();
  });

  test("maps all policy columns — Tier-B default, tier_c_managed_cloud_optin=false, empty allowlists", async () => {
    const { db } = makeStubDb([
      [
        {
          tier_c_managed_cloud_optin: false,
          tier_default: "B",
          raw_attrs_allowlist_extra: [],
          webhook_secrets: {},
          webhook_source_ip_allowlist: [],
        },
      ],
    ]);
    const store = createPgOrgPolicyStore({ db });
    const p = await store.get("acme-uuid");
    expect(p).toEqual({
      tier_c_managed_cloud_optin: false,
      tier_default: "B",
      raw_attrs_allowlist_extra: [],
      webhook_secrets: {},
      webhook_source_ip_allowlist: [],
    });
  });

  test("caches the resolved value for TTL — second get() does not hit PG", async () => {
    const { db, callCount } = makeStubDb([
      [{ tier_c_managed_cloud_optin: false, tier_default: "B" }],
    ]);
    let now = 0;
    const store = createPgOrgPolicyStore({ db, ttlMs: 1000, clock: () => now });
    await store.get("o");
    now = 500;
    await store.get("o");
    expect(callCount()).toBe(1);
  });

  test("cache expires once TTL elapses — subsequent get() re-queries PG", async () => {
    const { db, callCount } = makeStubDb([
      [{ tier_c_managed_cloud_optin: false, tier_default: "B" }],
      [{ tier_c_managed_cloud_optin: true, tier_default: "C" }],
    ]);
    let now = 0;
    const store = createPgOrgPolicyStore({ db, ttlMs: 1000, clock: () => now });
    expect((await store.get("o"))?.tier_default).toBe("B");
    now = 2000;
    expect((await store.get("o"))?.tier_default).toBe("C");
    expect(callCount()).toBe(2);
  });

  test("null value is cached too — missing-org 500 doesn't stampede PG on hot paths", async () => {
    const { db, callCount } = makeStubDb([[]]);
    let now = 0;
    const store = createPgOrgPolicyStore({ db, ttlMs: 1000, clock: () => now });
    expect(await store.get("ghost")).toBeNull();
    now = 500;
    expect(await store.get("ghost")).toBeNull();
    expect(callCount()).toBe(1);
  });

  test("coerces jsonb string[] allowlist; rejects non-string array entries", async () => {
    const { db } = makeStubDb([
      [
        {
          tier_c_managed_cloud_optin: false,
          tier_default: "B",
          raw_attrs_allowlist_extra: ["device.id", 42, "session.id", null],
          webhook_source_ip_allowlist: [],
        },
      ],
    ]);
    const store = createPgOrgPolicyStore({ db });
    const p = await store.get("o");
    expect(p?.raw_attrs_allowlist_extra).toEqual(["device.id", "session.id"]);
  });

  test("throws on unknown tier_default value — never silently downgrade the default tier", async () => {
    const { db } = makeStubDb([[{ tier_c_managed_cloud_optin: false, tier_default: "D" }]]);
    const store = createPgOrgPolicyStore({ db });
    await expect(store.get("o")).rejects.toThrow(/unexpected tier_default/);
  });
});
