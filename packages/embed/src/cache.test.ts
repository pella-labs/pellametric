import { expect, test } from "bun:test";
import { fromCached, InMemoryEmbedCache, toCached } from "./cache";
import { cacheKey } from "./cacheKey";
import { BudgetExceededError, CostGuard } from "./cost";
import { embedCached } from "./embedCached";
import type { EmbedProvider, EmbedRequest, EmbedResult } from "./types";

function fakeProvider(overrides: Partial<EmbedProvider> = {}): EmbedProvider {
  let callCount = 0;
  const p: EmbedProvider = {
    id: "openai",
    model: "text-embedding-3-small",
    dim: 4,
    maxBatch: 10,
    maxInputTokens: 100,
    costPerMillionTokens: 0.02,
    async embed(_req): Promise<EmbedResult> {
      callCount++;
      return {
        vector: Float32Array.from([0.1, 0.2, 0.3, 0.4]),
        provider: "openai",
        model: "text-embedding-3-small",
        dim: 4,
        cached: false,
        latency_ms: 1,
      };
    },
    async embedBatch(reqs) {
      return Promise.all(reqs.map((r) => p.embed(r)));
    },
    async health() {
      return { ok: true };
    },
    ...overrides,
  };
  // expose call count via symbol-keyed field
  (p as EmbedProvider & { _callCount: () => number })._callCount = () => callCount;
  return p;
}

test("cacheKey: different text → different key", () => {
  const p = fakeProvider();
  expect(cacheKey("a", p)).not.toBe(cacheKey("b", p));
});

test("cacheKey: same text but different dim → different key", () => {
  const p1 = fakeProvider();
  const p2 = fakeProvider({ dim: 8 });
  expect(cacheKey("hello", p1)).not.toBe(cacheKey("hello", p2));
});

test("cacheKey: same text+provider+dim → stable key", () => {
  const p = fakeProvider();
  expect(cacheKey("hello", p)).toBe(cacheKey("hello", p));
});

test("InMemoryEmbedCache: set/get round-trip", async () => {
  const cache = new InMemoryEmbedCache();
  await cache.set("k1", { vector: [1, 2, 3], provider: "openai", model: "m", dim: 3 });
  const hit = await cache.get("k1");
  expect(hit?.vector).toEqual([1, 2, 3]);
});

test("InMemoryEmbedCache: TTL expiry", async () => {
  const cache = new InMemoryEmbedCache();
  await cache.set("k1", { vector: [0], provider: "openai", model: "m", dim: 1 }, 0);
  // TTL 0 → immediate expiry on next get
  await new Promise((r) => setTimeout(r, 2));
  expect(await cache.get("k1")).toBeNull();
});

test("embedCached: L1 hit short-circuits provider and L2", async () => {
  const l1 = new InMemoryEmbedCache();
  const l2 = new InMemoryEmbedCache();
  const provider = fakeProvider();

  const req: EmbedRequest = { text: "hello", purpose: "ad-hoc" };
  const key = cacheKey(req.text, provider);
  await l1.set(key, { vector: [9, 9, 9, 9], provider: "openai", model: "m", dim: 4 });

  const res = await embedCached(req, { provider, l1, l2 });
  expect(res.cached).toBe(true);
  expect(Array.from(res.vector)).toEqual([9, 9, 9, 9]);
  expect((provider as EmbedProvider & { _callCount: () => number })._callCount()).toBe(0);
});

test("embedCached: L2 hit repopulates L1 and returns cached", async () => {
  const l1 = new InMemoryEmbedCache();
  const l2 = new InMemoryEmbedCache();
  const provider = fakeProvider();

  const req: EmbedRequest = { text: "hello", purpose: "ad-hoc" };
  const key = cacheKey(req.text, provider);
  await l2.set(key, { vector: [7, 7, 7, 7], provider: "openai", model: "m", dim: 4 });

  const res = await embedCached(req, { provider, l1, l2 });
  expect(res.cached).toBe(true);
  expect(Array.from(res.vector)).toEqual([7, 7, 7, 7]);
  // L1 now populated
  expect(await l1.get(key)).not.toBeNull();
  expect((provider as EmbedProvider & { _callCount: () => number })._callCount()).toBe(0);
});

test("embedCached: full miss invokes provider and populates both caches", async () => {
  const l1 = new InMemoryEmbedCache();
  const l2 = new InMemoryEmbedCache();
  const provider = fakeProvider();
  const req: EmbedRequest = { text: "new text", purpose: "ad-hoc" };

  const res = await embedCached(req, { provider, l1, l2 });
  expect(res.cached).toBe(false);
  const key = cacheKey(req.text, provider);
  expect(await l1.get(key)).not.toBeNull();
  expect(await l2.get(key)).not.toBeNull();
  expect((provider as EmbedProvider & { _callCount: () => number })._callCount()).toBe(1);
});

test("CostGuard: soft alert fires at 50% default", () => {
  let softFired = false;
  const g = new CostGuard({
    dailyBudgetUsd: 10,
    onSoftAlert: () => {
      softFired = true;
    },
  });
  g.register("org_a", 4); // 40% → no alert
  expect(softFired).toBe(false);
  g.register("org_a", 2); // 60% → fires once
  expect(softFired).toBe(true);
});

test("CostGuard: hard stop throws BudgetExceededError", () => {
  const g = new CostGuard({ dailyBudgetUsd: 1 });
  g.register("org_a", 0.5);
  expect(() => g.register("org_a", 0.6)).toThrow(BudgetExceededError);
});

test("embedCached: budget exceeded blocks live call but L1 hits still served", async () => {
  const l1 = new InMemoryEmbedCache();
  const provider = fakeProvider();
  const guard = new CostGuard({ dailyBudgetUsd: 0 /* zero budget */ });
  const req: EmbedRequest = { text: "blocked", purpose: "ad-hoc" };

  await expect(
    embedCached(req, { provider, l1, costGuard: guard, orgId: "org_z" }),
  ).rejects.toThrow(BudgetExceededError);
  expect((provider as EmbedProvider & { _callCount: () => number })._callCount()).toBe(0);

  // L1 hit still served (no budget check needed)
  const key = cacheKey(req.text, provider);
  await l1.set(key, { vector: [1, 1, 1, 1], provider: "openai", model: "m", dim: 4 });
  const res = await embedCached(req, { provider, l1, costGuard: guard, orgId: "org_z" });
  expect(res.cached).toBe(true);
});

test("toCached + fromCached round-trip preserves dim", () => {
  const result: EmbedResult = {
    vector: Float32Array.from([0.5, 0.25, 0.125]),
    provider: "openai",
    model: "m",
    dim: 3,
    cached: false,
    latency_ms: 5,
  };
  const cached = toCached(result);
  const restored = fromCached(cached);
  expect(restored.dim).toBe(3);
  expect(Array.from(restored.vector)).toEqual([0.5, 0.25, 0.125]);
  expect(restored.cached).toBe(true);
});
