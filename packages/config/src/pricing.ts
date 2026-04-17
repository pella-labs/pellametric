/**
 * Pinned LiteLLM pricing table commit. Every event that emits cost_usd also
 * emits `pricing_version = pricingVersionString()` — per PRD D21, version
 * shifts surface a dashboard banner; never silently recomputed.
 *
 * CI tests that this SHA resolves on the LiteLLM GitHub mirror; update this
 * constant in the same PR that adopts a newer pricing table.
 */
export const PRICING_PIN = "3b2f1a7";

export function pricingVersionString(): string {
  return `litellm@${PRICING_PIN}`;
}

const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isPricingStale(lastProbedAt: Date | null, now: number = Date.now()): boolean {
  if (lastProbedAt === null) return true;
  return now - lastProbedAt.getTime() > STALE_WINDOW_MS;
}
