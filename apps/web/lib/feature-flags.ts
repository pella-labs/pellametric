// Phase 4 T4.18 — feature flag for split-route insights UI.
// Stays off until Phase 8 cutover. Reads at request time; never cache.

export function insightsRevampEnabled(): boolean {
  const v = process.env.PELLAMETRIC_INSIGHTS_REVAMP_UI ?? "";
  return v === "1" || v.toLowerCase() === "true";
}
