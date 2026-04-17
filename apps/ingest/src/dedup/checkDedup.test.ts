import { describe, expect, test } from "bun:test";
import { checkDedup, dedupKey, InMemoryDedupStore } from "./checkDedup";

describe("dedupKey", () => {
  test("2. hash-tag regex match: tenant in braces, session can contain `:`", () => {
    const key = dedupKey({ tenantId: "org_abc", sessionId: "sess_1", eventSeq: 5 });
    // H3 fix: loosened sessionId to allow `:`/`.`/`/`. The essential
    // invariant is just the hash-tag braces around tenant + a trailing
    // numeric event_seq after the final `:`.
    expect(key).toMatch(/^dedup:\{[^}]+\}:.+:\d+$/);
  });

  test("hash-tag exact format: dedup:{org_abc}:sess_1:5", () => {
    expect(dedupKey({ tenantId: "org_abc", sessionId: "sess_1", eventSeq: 5 })).toBe(
      "dedup:{org_abc}:sess_1:5",
    );
  });

  test("4. throws dedup:bad-input on malformed tenantId ('a:b')", () => {
    expect(() => dedupKey({ tenantId: "a:b", sessionId: "s", eventSeq: 0 })).toThrow(
      "dedup:bad-input",
    );
  });

  test("4. throws dedup:bad-input on malformed sessionId ('x}')", () => {
    expect(() => dedupKey({ tenantId: "t", sessionId: "x}", eventSeq: 0 })).toThrow(
      "dedup:bad-input",
    );
  });

  test("4. throws dedup:bad-input on tenantId with braces", () => {
    expect(() => dedupKey({ tenantId: "t{x", sessionId: "s", eventSeq: 0 })).toThrow(
      "dedup:bad-input",
    );
  });

  test("4. throws dedup:bad-input on negative eventSeq", () => {
    expect(() => dedupKey({ tenantId: "t", sessionId: "s", eventSeq: -1 })).toThrow(
      "dedup:bad-input",
    );
  });

  test("4. throws dedup:bad-input on NaN eventSeq", () => {
    expect(() => dedupKey({ tenantId: "t", sessionId: "s", eventSeq: Number.NaN })).toThrow(
      "dedup:bad-input",
    );
  });

  test("4. throws dedup:bad-input on non-integer eventSeq", () => {
    expect(() => dedupKey({ tenantId: "t", sessionId: "s", eventSeq: 1.5 })).toThrow(
      "dedup:bad-input",
    );
  });

  test("string eventSeq parses as integer when valid", () => {
    expect(dedupKey({ tenantId: "t", sessionId: "s", eventSeq: "42" })).toBe("dedup:{t}:s:42");
  });

  test("H3: sessionId with dots (ISO timestamp) accepted", () => {
    const k = dedupKey({
      tenantId: "org_abc",
      sessionId: "chat:2026-04-16T12:00:00.000Z",
      eventSeq: 0,
    });
    expect(k).toBe("dedup:{org_abc}:chat:2026-04-16T12:00:00.000Z:0");
  });

  test("H3: sessionId with slashes and colons accepted (hierarchical paths)", () => {
    const k = dedupKey({
      tenantId: "org_abc",
      sessionId: "project/x:branch:feature.1",
      eventSeq: 7,
    });
    expect(k).toBe("dedup:{org_abc}:project/x:branch:feature.1:7");
  });

  test("H3: sessionId with whitespace rejected", () => {
    expect(() => dedupKey({ tenantId: "t", sessionId: "a b", eventSeq: 0 })).toThrow(
      "dedup:bad-input",
    );
  });

  test("H3: sessionId with control chars rejected", () => {
    expect(() => dedupKey({ tenantId: "t", sessionId: "a\x01b", eventSeq: 0 })).toThrow(
      "dedup:bad-input",
    );
  });

  test("H3: empty sessionId rejected", () => {
    expect(() => dedupKey({ tenantId: "t", sessionId: "", eventSeq: 0 })).toThrow(
      "dedup:bad-input",
    );
  });
});

describe("InMemoryDedupStore", () => {
  test("1. first call setnx(key, ttl) === true; second === false (duplicate)", async () => {
    const store = new InMemoryDedupStore();
    const first = await store.setnx("k1", 1000);
    const second = await store.setnx("k1", 1000);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  test("3. TTL expiry: advance ttlMs-1 → still dup; advance ttlMs+1 → firstSight again", async () => {
    let now = 1_000_000;
    const store = new InMemoryDedupStore({ clock: () => now });
    const ttl = 604_800_000;
    expect(await store.setnx("k2", ttl)).toBe(true);
    now += ttl - 1;
    expect(await store.setnx("k2", ttl)).toBe(false);
    now += 2; // push past expiry
    expect(await store.setnx("k2", ttl)).toBe(true);
  });

  test("5. configMaxMemoryPolicy() returns 'noeviction' by default", async () => {
    const store = new InMemoryDedupStore();
    expect(await store.configMaxMemoryPolicy()).toBe("noeviction");
  });

  test("5. policy override 'allkeys-lru' simulates prod misconfig", async () => {
    const store = new InMemoryDedupStore({ policy: "allkeys-lru" });
    expect(await store.configMaxMemoryPolicy()).toBe("allkeys-lru");
  });
});

describe("checkDedup", () => {
  test("first call firstSight=true, key computed correctly", async () => {
    const store = new InMemoryDedupStore();
    const r = await checkDedup(store, {
      tenantId: "org_x",
      sessionId: "sess_y",
      eventSeq: 0,
    });
    expect(r.firstSight).toBe(true);
    expect(r.key).toBe("dedup:{org_x}:sess_y:0");
  });

  test("6. large-batch: 100 distinct seqs all firstSight; replay all duped", async () => {
    const store = new InMemoryDedupStore();
    const input = (i: number) => ({
      tenantId: "t",
      sessionId: "s",
      eventSeq: i,
    });
    for (let i = 0; i < 100; i++) {
      const r = await checkDedup(store, input(i));
      expect(r.firstSight).toBe(true);
    }
    for (let i = 0; i < 100; i++) {
      const r = await checkDedup(store, input(i));
      expect(r.firstSight).toBe(false);
    }
  });

  test("checkDedup uses default 7-day TTL", async () => {
    let now = 1_000_000;
    const store = new InMemoryDedupStore({ clock: () => now });
    const input = { tenantId: "t", sessionId: "s", eventSeq: 1 };
    const r1 = await checkDedup(store, input);
    expect(r1.firstSight).toBe(true);
    // advance 6 days 23h 59m 59s — still within 7d default
    now += 6 * 86400 * 1000 + 86399 * 1000;
    const r2 = await checkDedup(store, input);
    expect(r2.firstSight).toBe(false);
    // past 7 days
    now += 2000;
    const r3 = await checkDedup(store, input);
    expect(r3.firstSight).toBe(true);
  });
});
