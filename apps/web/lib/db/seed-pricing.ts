// Pricing seed (Phase 1, P7).
// centi-cents per Mtok: $1 = 10000 centi-cents.
// Anthropic (Oct 2025): Sonnet $3 / $15, Opus $15 / $75, Haiku $0.80 / $4
// OpenAI    (Oct 2025): gpt-4o $2.50 / $10, gpt-4-turbo $10 / $30, o1 $15 / $60, o1-mini $3 / $12

import { db } from "@/lib/db";
import { modelPricing } from "@/lib/db/schema";

export const PRICING_SEED = [
  { model: "claude-sonnet-4-5",  inputCentiPerMtok: 30000,  outputCentiPerMtok: 150000, cacheReadCentiPerMtok: 3000,  cacheWriteCentiPerMtok: 37500 },
  { model: "claude-sonnet-4-6",  inputCentiPerMtok: 30000,  outputCentiPerMtok: 150000, cacheReadCentiPerMtok: 3000,  cacheWriteCentiPerMtok: 37500 },
  { model: "claude-opus-4-6",    inputCentiPerMtok: 150000, outputCentiPerMtok: 750000, cacheReadCentiPerMtok: 15000, cacheWriteCentiPerMtok: 187500 },
  { model: "claude-opus-4-7",    inputCentiPerMtok: 150000, outputCentiPerMtok: 750000, cacheReadCentiPerMtok: 15000, cacheWriteCentiPerMtok: 187500 },
  { model: "claude-haiku-4-5",   inputCentiPerMtok: 8000,   outputCentiPerMtok: 40000,  cacheReadCentiPerMtok: 800,   cacheWriteCentiPerMtok: 10000 },
  { model: "gpt-4o",             inputCentiPerMtok: 25000,  outputCentiPerMtok: 100000, cacheReadCentiPerMtok: 12500, cacheWriteCentiPerMtok: 0 },
  { model: "gpt-4-turbo",        inputCentiPerMtok: 100000, outputCentiPerMtok: 300000, cacheReadCentiPerMtok: 0,     cacheWriteCentiPerMtok: 0 },
  { model: "o1",                 inputCentiPerMtok: 150000, outputCentiPerMtok: 600000, cacheReadCentiPerMtok: 75000, cacheWriteCentiPerMtok: 0 },
  { model: "o1-mini",            inputCentiPerMtok: 30000,  outputCentiPerMtok: 120000, cacheReadCentiPerMtok: 15000, cacheWriteCentiPerMtok: 0 },
] as const;

const EFFECTIVE_FROM = new Date("2025-01-01T00:00:00Z");

/** Idempotent: inserts any seed rows whose (model, effectiveFrom) is absent. */
export async function seedPricing(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const row of PRICING_SEED) {
    const result = await db
      .insert(modelPricing)
      .values({ ...row, effectiveFrom: EFFECTIVE_FROM })
      .onConflictDoNothing()
      .returning({ id: modelPricing.id });
    if (result.length > 0) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}
