import { describe, it, expect } from "vitest";
import { costFor, money, PRICING } from "../pricing";

describe("pricing.costFor", () => {
  it("returns 0 when all usage is 0", () => {
    expect(costFor("claude-opus-4-7", { tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0 })).toBe(0);
  });

  it("computes Opus output cost correctly ($75/M)", () => {
    const c = costFor("claude-opus-4-7", { tokensIn: 0, tokensOut: 1_000_000, tokensCacheRead: 0, tokensCacheWrite: 0 });
    expect(c).toBeCloseTo(75, 4);
  });

  it("computes Sonnet 4.6 input + cache correctly", () => {
    const c = costFor("claude-sonnet-4-6", {
      tokensIn: 1_000_000, tokensOut: 0, tokensCacheRead: 10_000_000, tokensCacheWrite: 1_000_000,
    });
    // 1M*3 + 10M*0.30 + 1M*3.75 = 3 + 3 + 3.75 = 9.75
    expect(c).toBeCloseTo(9.75, 3);
  });

  it("falls back to sonnet pricing for unknown model", () => {
    const unknown = costFor("some-future-model" as any, { tokensIn: 1_000_000, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0 });
    expect(unknown).toBeCloseTo(PRICING["claude-sonnet-4-6"].in, 3);
  });

  it("falls back for null model", () => {
    const c = costFor(null, { tokensIn: 1_000_000, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0 });
    expect(c).toBeGreaterThan(0);
  });
});

describe("pricing.money", () => {
  it("formats sub-thousand with $ and 2 decimals", () => {
    expect(money(0.123456)).toBe("$0.12");
    expect(money(10.5)).toBe("$10.50");
    expect(money(999.99)).toBe("$999.99");
  });

  it("formats >=1000 with K", () => {
    expect(money(1000)).toBe("$1.0K");
    expect(money(12345)).toBe("$12.3K");
  });
});
