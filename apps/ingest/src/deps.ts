// Module-level dependency injection seam for the ingest server.
// Sprint 1 Phase 2 defaults: empty key store (safe-fail), permissive rate
// limiter, empty in-memory OrgPolicyStore (every org → 500 ORG_POLICY_MISSING
// until seeded), and noopRedactStage (real pipeline lands Sprint 2).
// Tests call setDeps({ ... }) in beforeAll to stub.

import { noopRedactStage, type RedactStage } from "@bematist/redact";
import { permissiveRateLimiter, type RateLimiter } from "./auth/rateLimit";
import type { IngestKeyStore } from "./auth/verifyIngestKey";
import { LRUCache } from "./auth/verifyIngestKey";
import { InMemoryOrgPolicyStore, type OrgPolicyStore } from "./tier/enforceTier";

export interface Deps {
  store: IngestKeyStore;
  rateLimiter: RateLimiter;
  cache: LRUCache;
  clock: () => number;
  orgPolicyStore: OrgPolicyStore;
  redactStage: RedactStage;
}

function makeDefaultDeps(): Deps {
  const emptyStore: IngestKeyStore = {
    async get() {
      return null;
    },
  };
  return {
    store: emptyStore,
    rateLimiter: permissiveRateLimiter(),
    cache: new LRUCache({ max: 1000, ttlMs: 60_000 }),
    clock: () => Date.now(),
    // Empty policy store — get() returns null for every org until seeded.
    // Tests seed via setDeps({ orgPolicyStore: store }).
    orgPolicyStore: new InMemoryOrgPolicyStore(),
    redactStage: noopRedactStage,
  };
}

// Intentionally mutable: swapped by setDeps() in tests and boot wiring.
let _deps: Deps = makeDefaultDeps();

export function getDeps(): Deps {
  return _deps;
}

export function setDeps(patch: Partial<Deps>): void {
  _deps = { ..._deps, ...patch };
}

export function resetDeps(): void {
  _deps = makeDefaultDeps();
}
