import { describe, expect, test } from "bun:test";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createPgIngestKeyStore } from "./pgIngestKeyStore";

// Minimal shape-stub — the store only calls .select().from().innerJoin().where().limit()
// in the happy path. We record which Drizzle primitive was invoked and return
// stubbed rows from .limit(). No live PG; no SQL parse — just verifies the
// returned IngestKeyStore honors the contract shape.
function makeStubDb(rows: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  const chain = {
    select(_cols: unknown) {
      calls.push("select");
      return chain;
    },
    from(_t: unknown) {
      calls.push("from");
      return chain;
    },
    innerJoin(_t: unknown, _c: unknown) {
      calls.push("innerJoin");
      return chain;
    },
    where(_c: unknown) {
      calls.push("where");
      return chain;
    },
    async limit(_n: number) {
      calls.push("limit");
      return rows;
    },
  };
  return { db: chain as unknown as PostgresJsDatabase<Record<string, unknown>>, calls };
}

describe("createPgIngestKeyStore", () => {
  test("returns null when the join yields zero rows", async () => {
    const { db, calls } = makeStubDb([]);
    const store = createPgIngestKeyStore({ db });
    const row = await store.get("acmesmall", "perfkey");
    expect(row).toBeNull();
    expect(calls).toEqual(["select", "from", "innerJoin", "where", "limit"]);
  });

  test("maps a row with nullable engineer_id/revoked_at through to the IngestKeyRow contract", async () => {
    const { db } = makeStubDb([
      {
        id: "perfkey",
        org_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        engineer_id: null,
        key_sha256: "deadbeef".repeat(8),
        tier_default: "B",
        revoked_at: null,
      },
    ]);
    const store = createPgIngestKeyStore({ db });
    const row = await store.get("acmesmall", "perfkey");
    expect(row).not.toBeNull();
    expect(row?.id).toBe("perfkey");
    expect(row?.org_id).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    expect(row?.engineer_id).toBeNull();
    expect(row?.tier_default).toBe("B");
    expect(row?.revoked_at).toBeNull();
  });

  test("normalizes lowercase tier_default to uppercase", async () => {
    const { db } = makeStubDb([
      {
        id: "k",
        org_id: "o",
        engineer_id: "e",
        key_sha256: "x",
        tier_default: "b",
        revoked_at: null,
      },
    ]);
    const store = createPgIngestKeyStore({ db });
    const row = await store.get("slug", "k");
    expect(row?.tier_default).toBe("B");
  });

  test("throws on unknown tier_default — fail loud, not silent Tier-A downgrade", async () => {
    const { db } = makeStubDb([
      {
        id: "k",
        org_id: "o",
        engineer_id: "e",
        key_sha256: "x",
        tier_default: "D",
        revoked_at: null,
      },
    ]);
    const store = createPgIngestKeyStore({ db });
    await expect(store.get("slug", "k")).rejects.toThrow(/unexpected tier_default/);
  });
});
