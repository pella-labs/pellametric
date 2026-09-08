// Insights revamp (P7): DB-driven pricing via model_pricing table.
// Cost is computed at read time. Stored centi-cents per million tokens.
// 1 centi-cent = $0.0001. 1 USD = 10,000 centi-cents.
//
// Server-only: imports drizzle/postgres-js which can't be bundled for the
// client. Client surfaces use lib/pricing.ts (the in-memory PRICING map).

import { db } from "@/lib/db";
import { modelPricing } from "@/lib/db/schema";
import { and, desc, eq, isNull, lte, or, gt } from "drizzle-orm";

export type PricingRow = typeof modelPricing.$inferSelect;

export type TokenUsage = {
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
};

/** Returns the active pricing row for `model` at instant `at`, or null. */
export async function priceFor(model: string, at: Date): Promise<PricingRow | null> {
  const rows = await db
    .select()
    .from(modelPricing)
    .where(
      and(
        eq(modelPricing.model, model),
        lte(modelPricing.effectiveFrom, at),
        or(isNull(modelPricing.effectiveTo), gt(modelPricing.effectiveTo, at)),
      ),
    )
    .orderBy(desc(modelPricing.effectiveFrom))
    .limit(1);
  return rows[0] ?? null;
}

/** Computes total centi-cents from token usage using the row's per-Mtok rates. */
export function applyPricing(row: PricingRow, u: TokenUsage): number {
  return (
    (u.tokensIn / 1_000_000) * row.inputCentiPerMtok +
    (u.tokensOut / 1_000_000) * row.outputCentiPerMtok +
    (u.tokensCacheRead / 1_000_000) * row.cacheReadCentiPerMtok +
    (u.tokensCacheWrite / 1_000_000) * row.cacheWriteCentiPerMtok
  );
}

/**
 * Computes cost in centi-cents for a token bundle at instant `at`.
 * Throws if model is unknown — caller decides how to surface "unpriced".
 */
export async function costFromTokens(
  args: TokenUsage & { model: string; at: Date },
): Promise<number> {
  const row = await priceFor(args.model, args.at);
  if (!row) throw new Error(`unknown model pricing: ${args.model}`);
  return applyPricing(row, args);
}

export function centiCentsToUsd(centi: number): number {
  return centi / 10_000;
}
