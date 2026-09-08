#!/usr/bin/env bun
// One-shot pricing seed for model_pricing. Idempotent.
// Usage: bun run --cwd apps/web scripts/seed-pricing.ts

import { seedPricing } from "@/lib/db/seed-pricing";

async function main() {
  const result = await seedPricing();
  console.log(`pricing seed: inserted=${result.inserted} skipped=${result.skipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
