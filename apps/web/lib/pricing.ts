// Published per-1M pricing (USD). Used for dollar display only.
export const PRICING: Record<string, { in: number; out: number; cr: number; cw: number }> = {
  "claude-opus-4-7":          { in: 15, out: 75, cr: 1.50, cw: 18.75 },
  "claude-opus-4-5-20251101": { in: 15, out: 75, cr: 1.50, cw: 18.75 },
  "claude-opus-4-6":          { in: 15, out: 75, cr: 1.50, cw: 18.75 },
  "claude-sonnet-4-6":        { in: 3,  out: 15, cr: 0.30, cw: 3.75 },
  "claude-sonnet-4-20250514": { in: 3,  out: 15, cr: 0.30, cw: 3.75 },
  "claude-haiku-4-5-20251001":{ in: 0.80, out: 4, cr: 0.08, cw: 1.00 },
  "codex":                    { in: 1.25, out: 10, cr: 0.125, cw: 0 },
};

export function costFor(model: string | null, u: { tokensIn: number; tokensOut: number; tokensCacheRead: number; tokensCacheWrite: number }) {
  const p = PRICING[model ?? ""] ?? PRICING["claude-sonnet-4-6"];
  return (
    (u.tokensIn / 1e6) * p.in +
    (u.tokensOut / 1e6) * p.out +
    (u.tokensCacheRead / 1e6) * p.cr +
    (u.tokensCacheWrite / 1e6) * p.cw
  );
}

export function money(x: number) {
  if (x >= 1000) return `$${(x / 1000).toFixed(1)}K`;
  return `$${x.toFixed(2)}`;
}
