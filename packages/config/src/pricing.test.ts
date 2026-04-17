import { expect, test } from "bun:test";
import { isPricingStale, PRICING_PIN, pricingVersionString } from "./pricing";

test("PRICING_PIN is a non-empty SHA-ish string", () => {
  expect(PRICING_PIN).toMatch(/^[a-f0-9]{7,40}$/);
});

test("pricingVersionString is 'litellm@<sha>' shape", () => {
  expect(pricingVersionString()).toMatch(/^litellm@[a-f0-9]{7,40}$/);
});

test("isPricingStale returns false when lastProbedAt is recent", () => {
  const now = Date.now();
  expect(isPricingStale(new Date(now - 1000), now)).toBe(false);
});

test("isPricingStale returns true when lastProbedAt is > 7 days old", () => {
  const now = Date.now();
  const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
  expect(isPricingStale(eightDaysAgo, now)).toBe(true);
});

test("isPricingStale returns true when lastProbedAt is null (never probed)", () => {
  expect(isPricingStale(null, Date.now())).toBe(true);
});
