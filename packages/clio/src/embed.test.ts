import { describe, expect, test } from "bun:test";
import { abstractCacheKey, HashingEmbedder, LRUCache } from "./embed";

describe("Stage 4 — embed", () => {
  test("HashingEmbedder produces a 384-dim unit vector", async () => {
    const e = new HashingEmbedder();
    const r = await e.embed({ abstract: "hello world" });
    expect(r.dim).toBe(384);
    expect(r.vector.length).toBe(384);
    const norm = Math.sqrt(r.vector.reduce((s, v) => s + v * v, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });

  test("identical input → identical vector (deterministic)", async () => {
    const e = new HashingEmbedder();
    const a = await e.embed({ abstract: "alpha" });
    const b = await e.embed({ abstract: "alpha" });
    expect(b.cached).toBe(true);
    expect(a.vector).toEqual(b.vector);
  });

  test("different input → different vector", async () => {
    const e = new HashingEmbedder();
    const a = await e.embed({ abstract: "alpha" });
    const b = await e.embed({ abstract: "beta" });
    expect(a.vector).not.toEqual(b.vector);
  });

  test("abstractCacheKey is sha256(abstract)", () => {
    const k = abstractCacheKey("hello");
    expect(k).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("LRUCache", () => {
  test("evicts oldest beyond cap", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  test("get refreshes recency", () => {
    const c = new LRUCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
  });
});
