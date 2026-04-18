import { describe, expect, test } from "bun:test";
import { Rng } from "./rng";

describe("Rng", () => {
  test("deterministic with same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test("differs across seeds", () => {
    const a = new Rng(1).next();
    const b = new Rng(2).next();
    expect(a).not.toBe(b);
  });

  test("int(max) is in [0, max)", () => {
    const r = new Rng();
    for (let i = 0; i < 1_000; i++) {
      const v = r.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  test("uuid is v4-shaped", () => {
    const r = new Rng();
    for (let i = 0; i < 50; i++) {
      const u = r.uuid();
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  test("lognormal stays positive and respects cap", () => {
    const r = new Rng();
    for (let i = 0; i < 500; i++) {
      const v = r.lognormal(-2, 1, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  test("normal is approximately mean-0, var-1 over 5k draws", () => {
    const r = new Rng(7);
    let sum = 0;
    let sumSq = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      const v = r.normal();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(Math.abs(variance - 1)).toBeLessThan(0.15);
  });
});
