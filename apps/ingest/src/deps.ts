// Module-level dependency injection seam for the ingest server.
// Sprint 1 Phase 2 defaults: empty key store (safe-fail), permissive rate
// limiter, empty in-memory OrgPolicyStore (every org → 500 ORG_POLICY_MISSING
// until seeded), and noopRedactStage for tests (the real defaultRedactionStage
// from @bematist/redact is wired below).
// Phase 4 adds `wal` (Redis Streams appender) and `clickhouseWriter` (lazy
// CH client). Both default to in-memory test doubles so unit tests don't
// need network.
// M3 follow-up #2: `redactAuditSink` wires the redaction_audit side-table
// writer (contract 08 §Invariant #4 / contract 09 §Side tables). Default is
// `noopAuditSink`; boot in index.ts swaps for a ClickHouse-backed sink.
// Tests call setDeps({ ... }) in beforeAll to stub.

import { defaultRedactionStage, type RedactStage } from "@bematist/redact";
import { permissiveRateLimiter, type RateLimiter } from "./auth/rateLimit";
import type { IngestKeyStore } from "./auth/verifyIngestKey";
import { LRUCache } from "./auth/verifyIngestKey";
import { type ClickHouseWriter, createInMemoryClickHouseWriter } from "./clickhouse";
import { type DedupStore, InMemoryDedupStore } from "./dedup/checkDedup";
import { type Flags, parseFlags } from "./flags";
import { noopAuditSink } from "./redact/auditSink";
import type { RedactionAuditSink } from "./redact/hotpath";
import { InMemoryOrgPolicyStore, type OrgPolicyStore } from "./tier/enforceTier";
import { createInMemoryWalAppender, type WalAppender } from "./wal/append";
import { createInMemoryGitEventsStore, type GitEventsStore } from "./webhooks/gitEventsStore";

/** Resolves an org slug from a webhook URL query param → internal org id. */
export interface OrgResolver {
  bySlug(slug: string): Promise<string | null>;
}

function createInMemoryOrgResolver(): OrgResolver & { seed(slug: string, id: string): void } {
  const m = new Map<string, string>();
  return {
    async bySlug(slug) {
      return m.get(slug) ?? null;
    },
    seed(slug, id) {
      m.set(slug, id);
    },
  };
}

export interface Deps {
  store: IngestKeyStore;
  rateLimiter: RateLimiter;
  cache: LRUCache;
  clock: () => number;
  orgPolicyStore: OrgPolicyStore;
  redactStage: RedactStage;
  redactAuditSink: RedactionAuditSink;
  dedupStore: DedupStore;
  wal: WalAppender;
  clickhouseWriter: ClickHouseWriter;
  flags: Flags;
  /**
   * Optional lag accessor wired by the WAL consumer at boot. Surfaced on
   * `/readyz.checks.wal_consumer_lag`. Null → consumer not wired.
   */
  walConsumerLag: (() => Promise<number>) | null;
  /** Transport dedup for webhooks (Phase 6). Separate from per-event dedupStore. */
  webhookDedup: DedupStore;
  /** Git events store (Phase 6) — backs /v1/webhooks/{github,gitlab,bitbucket}. */
  gitEventsStore: GitEventsStore;
  /** Resolves ?org=<slug> on webhook paths to an internal org id. */
  orgResolver: OrgResolver;
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
    // Real TruffleHog + Gitleaks + Presidio pipeline per contract 08. Tests
    // that want to bypass server-side redaction inject `noopRedactStage`.
    redactStage: defaultRedactionStage,
    redactAuditSink: noopAuditSink,
    // InMemoryDedupStore satisfies /readyz preflight (returns "noeviction")
    // and is swapped for a real Redis-backed impl at boot on managed stacks.
    dedupStore: new InMemoryDedupStore(),
    wal: createInMemoryWalAppender(),
    clickhouseWriter: createInMemoryClickHouseWriter(),
    flags: parseFlags(process.env as Record<string, string | undefined>),
    walConsumerLag: null,
    webhookDedup: new InMemoryDedupStore(),
    gitEventsStore: createInMemoryGitEventsStore(),
    orgResolver: createInMemoryOrgResolver(),
  };
}

export { createInMemoryOrgResolver };

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
