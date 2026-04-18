import { describe, expect, test } from "bun:test";
import { COOLDOWN_WINDOW_MS, checkCooldown } from "./cooldown";

const NOW = new Date("2026-04-17T12:00:00.000Z");

describe("checkCooldown", () => {
  test("never activated → elapsed=true, 0 remaining", () => {
    expect(checkCooldown(null, NOW)).toEqual({
      elapsed: true,
      remainingMs: 0,
      previousActivationAt: null,
    });
  });

  test("activated 7d+1ms ago → elapsed=true", () => {
    const at = new Date(NOW.getTime() - COOLDOWN_WINDOW_MS - 1);
    const r = checkCooldown(at, NOW);
    expect(r.elapsed).toBe(true);
    expect(r.remainingMs).toBe(0);
  });

  test("activated exactly 7d ago → elapsed=true (boundary inclusive)", () => {
    const at = new Date(NOW.getTime() - COOLDOWN_WINDOW_MS);
    expect(checkCooldown(at, NOW).elapsed).toBe(true);
  });

  test("activated 6d ago → elapsed=false, remainingMs ≈ 1d", () => {
    const at = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000);
    const r = checkCooldown(at, NOW);
    expect(r.elapsed).toBe(false);
    expect(r.remainingMs).toBe(24 * 60 * 60 * 1000);
  });

  test("activated 1ms ago → elapsed=false, remainingMs ≈ window-1", () => {
    const at = new Date(NOW.getTime() - 1);
    const r = checkCooldown(at, NOW);
    expect(r.elapsed).toBe(false);
    expect(r.remainingMs).toBe(COOLDOWN_WINDOW_MS - 1);
  });

  test("custom windowMs honored", () => {
    const at = new Date(NOW.getTime() - 1000);
    expect(checkCooldown(at, NOW, 500).elapsed).toBe(true);
    expect(checkCooldown(at, NOW, 5000).elapsed).toBe(false);
  });
});
