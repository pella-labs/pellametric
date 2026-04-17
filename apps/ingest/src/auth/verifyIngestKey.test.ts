import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type AuthContext,
  type IngestKeyRow,
  type IngestKeyStore,
  LRUCache,
  verifyBearer,
} from "./verifyIngestKey";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function makeRow(overrides: Partial<IngestKeyRow> = {}): IngestKeyRow {
  return {
    id: "keyabc",
    org_id: "orgabc",
    engineer_id: "eng_abc",
    key_sha256: hashSecret("s3cret"),
    tier_default: "B",
    revoked_at: null,
    ...overrides,
  };
}

function makeStore(rows: Record<string, IngestKeyRow | null>): IngestKeyStore & {
  calls: Array<{ orgId: string; keyId: string }>;
} {
  const calls: Array<{ orgId: string; keyId: string }> = [];
  return {
    calls,
    async get(orgId: string, keyId: string) {
      calls.push({ orgId, keyId });
      const key = `${orgId}/${keyId}`;
      return rows[key] ?? null;
    },
  };
}

describe("verifyBearer", () => {
  test("null header → null", async () => {
    const store = makeStore({});
    const res = await verifyBearer(null, store);
    expect(res).toBeNull();
  });

  test("malformed Bearer (Basic auth) → null", async () => {
    const store = makeStore({});
    const res = await verifyBearer("Basic xxx", store);
    expect(res).toBeNull();
  });

  test("garbage token (no bm_ prefix) → null", async () => {
    const store = makeStore({});
    const res = await verifyBearer("Bearer garbage", store);
    expect(res).toBeNull();
  });

  test("unknown orgId → null (store miss)", async () => {
    const store = makeStore({});
    const res = await verifyBearer("Bearer bm_unknownorg_keyid_secret", store);
    expect(res).toBeNull();
    expect(store.calls.length).toBe(1);
  });

  test("revoked key → null", async () => {
    const row = makeRow({
      org_id: "orgabc",
      id: "keyabc",
      key_sha256: hashSecret("s3cret"),
      revoked_at: new Date("2026-04-15T00:00:00Z"),
    });
    const store = makeStore({ "orgabc/keyabc": row });
    const res = await verifyBearer("Bearer bm_orgabc_keyabc_s3cret", store);
    expect(res).toBeNull();
  });

  test("wrong secret (hash mismatch) → null (timing-safe path)", async () => {
    const row = makeRow({
      org_id: "orgabc",
      id: "keyabc",
      key_sha256: hashSecret("correct-secret"),
    });
    const store = makeStore({ "orgabc/keyabc": row });
    const res = await verifyBearer("Bearer bm_orgabc_keyabc_WRONG", store);
    expect(res).toBeNull();
  });

  test("stored key_sha256 with wrong length → null (length guard, no throw)", async () => {
    const row = makeRow({
      org_id: "orgabc",
      id: "keyabc",
      // deliberately truncated — not a valid sha256 hex
      key_sha256: "abc123",
    });
    const store = makeStore({ "orgabc/keyabc": row });
    const res = await verifyBearer("Bearer bm_orgabc_keyabc_s3cret", store);
    expect(res).toBeNull();
  });

  test("valid bearer → returns AuthContext", async () => {
    const secret = "s3cret";
    const row = makeRow({
      org_id: "orgabc",
      id: "keyabc",
      key_sha256: hashSecret(secret),
      tier_default: "B",
      engineer_id: "eng_xyz",
    } as Partial<IngestKeyRow>);
    const store = makeStore({ "orgabc/keyabc": row });
    const res = (await verifyBearer(`Bearer bm_orgabc_keyabc_${secret}`, store)) as AuthContext;
    expect(res).not.toBeNull();
    expect(res.tenantId).toBe("orgabc");
    expect(res.engineerId).toBe("eng_xyz");
    expect(res.tier).toBe("B");
    expect(res.keyId).toBe("keyabc");
  });

  test("LRU cache hit — second call within TTL does not hit store", async () => {
    const secret = "s3cret";
    const row = makeRow({
      org_id: "orgabc",
      id: "keyabc",
      key_sha256: hashSecret(secret),
    });
    const store = makeStore({ "orgabc/keyabc": row });
    const cache = new LRUCache({ max: 10, ttlMs: 60_000 });
    const header = `Bearer bm_orgabc_keyabc_${secret}`;
    const r1 = await verifyBearer(header, store, cache);
    const r2 = await verifyBearer(header, store, cache);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(store.calls.length).toBe(1); // cache hit
  });

  test("LRU cache expires after TTL", async () => {
    const secret = "s3cret";
    const row = makeRow({
      org_id: "orgabc",
      id: "keyabc",
      key_sha256: hashSecret(secret),
    });
    const store = makeStore({ "orgabc/keyabc": row });
    // mock clock: start at 0, then jump past TTL
    let now = 1_000_000;
    const cache = new LRUCache({
      max: 10,
      ttlMs: 60_000,
      clock: () => now,
    });
    const header = `Bearer bm_orgabc_keyabc_${secret}`;
    const r1 = await verifyBearer(header, store, cache);
    expect(r1).not.toBeNull();
    now += 61_000; // past TTL
    const r2 = await verifyBearer(header, store, cache);
    expect(r2).not.toBeNull();
    expect(store.calls.length).toBe(2); // expired → refetched
  });

  test("LRU eviction — max=2, insert 3 keys, oldest evicted", async () => {
    const cache = new LRUCache<string, number>({ max: 2, ttlMs: 60_000 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeNull(); // evicted
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  test("legacy 2-segment bearer bm_<orgId>_<secret> — keyId omitted, falls back to single-row lookup", async () => {
    const secret = "abc";
    const row = makeRow({
      org_id: "test",
      id: "legacy_key",
      key_sha256: hashSecret(secret),
      tier_default: "B",
    });
    // Legacy store: look up by orgId only (keyId="*")
    const store: IngestKeyStore = {
      async get(orgId, keyId) {
        if (orgId === "test" && (keyId === "*" || keyId === "legacy_key")) {
          return row;
        }
        return null;
      },
    };
    const res = await verifyBearer("Bearer bm_test_abc", store);
    expect(res).not.toBeNull();
    expect(res?.tenantId).toBe("test");
  });

  test("L4: cache key is sha256 hash of raw bearer, not the raw bearer itself", async () => {
    // Previously the cache stored entries keyed on the raw Bearer secret —
    // any future "dump cache for debug" endpoint would leak every active
    // secret. Keys now hash first.
    const secret = "exposed_secret_value_42";
    const header = `Bearer bm_orgabc_keyabc_${secret}`;
    const row = makeRow({ org_id: "orgabc", id: "keyabc", key_sha256: hashSecret(secret) });
    const store = makeStore({ "orgabc/keyabc": row });
    const cache = new LRUCache({ max: 10, ttlMs: 60_000 });
    await verifyBearer(header, store, cache);
    // The cache should have exactly one entry — the entry's key must NOT
    // contain the raw secret. Iterate via the (internal) keys iterator by
    // poking at cache.get with a computed hash.
    const { createHash } = await import("node:crypto");
    const raw = header.slice("Bearer ".length);
    const expectedKey = createHash("sha256").update(raw).digest("hex");
    expect(cache.get(expectedKey)).not.toBeNull();
    // Looking up by the raw secret must now MISS.
    expect(cache.get(raw)).toBeNull();
  });
});
