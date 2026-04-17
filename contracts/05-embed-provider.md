# 05 — Embed provider

**Status:** draft
**Owners:** Workstream H (scoring & AI)
**Consumers:** G (Clio pipeline embed stage), C (ingest, server-side embed call), Twin Finder, nightly cluster job
**Last touched:** 2026-04-16

## Purpose

`packages/embed` abstracts the embedding model behind one interface so callers don't bake in OpenAI vs. Voyage vs. Ollama. Air-gapped customers swap providers without code changes; managed cloud uses defaults; self-host BYO API keys.

## Provider interface

```ts
// packages/embed/index.ts (draft)
export interface EmbedRequest {
  /** Pre-redacted, pre-abstracted text. Provider does NOT redact. */
  text: string;
  /** Caller hint for cache namespacing — e.g. "prompt-cluster", "twin-finder". */
  purpose: "prompt-cluster" | "twin-finder" | "ad-hoc";
}

export interface EmbedResult {
  /** Embedding vector in the dimension the provider declares. */
  vector: Float32Array;
  /** Provider id at call time (for audit). */
  provider: string;
  /** Model id at call time. */
  model: string;
  /** Dimension of `vector`. */
  dim: number;
  /** Whether this came from cache (Redis L1 or Postgres L2). */
  cached: boolean;
  /** Latency ms (network for live, ~0 for cached). */
  latency_ms: number;
}

export interface EmbedProvider {
  readonly id: "openai" | "voyage" | "ollama-nomic" | "xenova";
  readonly model: string;
  readonly dim: number;            // 512 (openai 3-small Matryoshka), 1024 (voyage-3), 768 (nomic), 384 (xenova)
  readonly maxBatch: number;
  readonly maxInputTokens: number;
  readonly costPerMillionTokens?: number; // null for local

  embed(req: EmbedRequest): Promise<EmbedResult>;
  embedBatch(reqs: EmbedRequest[]): Promise<EmbedResult[]>;

  /** Returns true if this provider is reachable RIGHT NOW.
   *  Used by fallback chain and `bematist doctor`. */
  health(): Promise<{ ok: boolean; reason?: string }>;
}
```

## Default chain (resolution order)

1. **`EMBEDDING_PROVIDER` env var** — explicit override; if set and reachable, used.
2. **Managed cloud:** `openai` with `text-embedding-3-small` @ 512d Matryoshka. We pay.
3. **Self-host with `OPENAI_API_KEY` set:** `openai` (BYO key).
4. **Self-host with `VOYAGE_API_KEY` set + opt-in:** `voyage` (premium upgrade).
5. **Air-gapped fallback A:** Ollama with `nomic-embed-text` if `ollama` daemon detected on `localhost:11434`.
6. **Air-gapped fallback B:** bundled `@xenova/transformers` MiniLM-L6 (22MB, 384-dim, lazy-loaded).

The resolver lives in `packages/embed/resolve.ts`. `bematist doctor` reports the resolved provider for each call site.

## Cache (two layers)

```ts
// packages/embed/cache.ts (draft)
export interface EmbedCache {
  /** Key: sha256(text + provider.id + provider.model + provider.dim). */
  get(key: string): Promise<EmbedResult | null>;
  set(key: string, result: EmbedResult, ttlSeconds?: number): Promise<void>;
}
```

- **L1: Redis LRU**, default 100k entries, TTL 7d. Hot path.
- **L2: Postgres `embedding_cache` table**, indefinite (until vacuumed). Survives Redis flush.
- Combined hit rate target on real coding prompts: **~80%** (per CLAUDE.md AI Rules).

Cache key includes `provider.id + model + dim` so swapping providers does NOT silently return stale vectors of the wrong dimension.

## Batch & nightly

- **Live (Twin Finder, ad-hoc dashboard queries):** `embed()` single-call against the resolved provider. Cache-first.
- **Nightly cluster recompute:** uses `OpenAI Batch API` (50% discount) when provider is `openai`. Other providers fall back to `embedBatch()` chunked at `provider.maxBatch`. Job lives in `apps/worker/jobs/cluster_recompute.ts`.

## Postgres `embedding_cache` table (canonical)

```sql
-- packages/schema/postgres/embedding_cache.sql (draft)
CREATE TABLE embedding_cache (
  cache_key   TEXT PRIMARY KEY,           -- sha256(text + provider.id + model + dim)
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  vector      FLOAT4[] NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX embedding_cache_last_hit_at_idx ON embedding_cache (last_hit_at);
```

Vacuum policy: drop entries with `last_hit_at < now() - interval '90 days'` weekly.

## Cost guardrails

- Per-org hard cap: `EMBEDDING_BUDGET_USD_PER_DAY` (env), default $20/org/day on managed cloud.
- Soft alert at 50%; hard stop at 100% (returns cached-only; live calls 429).
- Solo / embedded: no cap (BYO key, BYO bill).

## Invariants

1. **Providers do NOT redact.** Inputs are already redacted+abstracted by Clio (`06-clio-pipeline.md`). If a provider receives raw PII, that's a Clio bug — fix Clio, not the provider.
2. **No prompt text leaves the tenant boundary unless the provider is explicitly cloud-typed AND the org has consented.** Air-gapped configs MUST resolve to `ollama-nomic` or `xenova` and `health()` MUST refuse to call OpenAI/Voyage.
3. **Cache key includes `provider.id + model + dim`.** Swapping providers never returns wrong-dim vectors.
4. **`vector.length === provider.dim`** at every return.
5. **Provider health is checked, not assumed.** Resolver pings `health()` on startup and every 60s; falls down the chain on failure with a logged warning.
6. **Nightly cluster job uses Batch API for cost** when provider is `openai`. Twin Finder hits live API for latency.

## Open questions

- Should we ship a `voyage-3.5` upgrade path now or wait? (Owner: H — wait; only swap when a customer asks.)
- Do we cache MiniLM (Xenova) results in Postgres, or only in Redis? (Owner: H — Postgres too; the model is local but the inference cost is CPU-bound and worth caching.)
- Per-engineer budget sub-cap? (Owner: H — not v1; org-level only.)

## Changelog

- 2026-04-16 — initial draft
