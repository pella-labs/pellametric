// Stage 4 — Embed (contract 06 §4).
//
// Local-only on-device embedding. Default provider is `@xenova/transformers`
// MiniLM-L6-v2 (384d, 22MB, Apache 2.0). Cache key is `sha256(abstract)`.
//
// Cloud embedding providers (OpenAI, Voyage) run only at the central ingest
// layer, on already-abstracted text — they do NOT appear in this file.

import { createHash } from "node:crypto";

export interface EmbedRequest {
  /** The post-verification abstract. Raw prompts MUST NOT reach here. */
  abstract: string;
}

export interface EmbedResult {
  vector: number[];
  /** 384 for the default Xenova MiniLM-L6. */
  dim: number;
  /** True if served from the in-memory LRU cache. */
  cached: boolean;
}

export interface Embedder {
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

/** `sha256(abstract)` — the on-device cache key (contract 06 §4). */
export function abstractCacheKey(abstract: string): string {
  return createHash("sha256").update(abstract, "utf8").digest("hex");
}

/**
 * Tiny bounded LRU for abstract → vector. On-device collectors see a modest
 * working set (≈10k prompts/day/dev at the high end). A 5000-entry LRU is
 * plenty and keeps heap usage bounded without reaching for an external dep.
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  private readonly cap: number;
  constructor(cap = 5000) {
    this.cap = cap;
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.cap) {
      const first = this.map.keys().next().value as K | undefined;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
  get size(): number {
    return this.map.size;
  }
}

// Xenova pipeline handle typed opaquely — the dep is optional at install time.
type XenovaPipeline = (
  text: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let cachedPipeline: XenovaPipeline | null = null;
let pipelineError: Error | null = null;

async function getPipeline(modelId: string): Promise<XenovaPipeline> {
  if (cachedPipeline) return cachedPipeline;
  if (pipelineError) throw pipelineError;
  try {
    const modName = "@xenova/transformers";
    const mod = (await import(modName)) as unknown as {
      pipeline: (task: string, model: string) => Promise<XenovaPipeline>;
    };
    cachedPipeline = await mod.pipeline("feature-extraction", modelId);
    return cachedPipeline;
  } catch (err) {
    pipelineError = err instanceof Error ? err : new Error(String(err));
    throw pipelineError;
  }
}

export interface XenovaEmbedderOpts {
  model?: string;
  cache?: LRUCache<string, number[]>;
}

/** Default on-device embedder. Always local; 384-dim. */
export class XenovaEmbedder implements Embedder {
  readonly dim = 384;
  readonly model: string;
  private readonly cache: LRUCache<string, number[]>;

  constructor(opts: XenovaEmbedderOpts = {}) {
    this.model = opts.model ?? "Xenova/all-MiniLM-L6-v2";
    this.cache = opts.cache ?? new LRUCache<string, number[]>();
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const key = abstractCacheKey(req.abstract);
    const hit = this.cache.get(key);
    if (hit) return { vector: hit, dim: this.dim, cached: true };
    const pipe = await getPipeline(this.model);
    const out = await pipe(req.abstract, { pooling: "mean", normalize: true });
    if (out.data.length !== this.dim) {
      throw new Error(`XenovaEmbedder: dim ${out.data.length} != declared ${this.dim}`);
    }
    const vec = Array.from(out.data);
    this.cache.set(key, vec);
    return { vector: vec, dim: this.dim, cached: false };
  }
}

/**
 * Deterministic no-dep embedder suitable for unit tests and the E2E pipeline
 * test. Hashes the abstract into a 384-dim unit vector using a seeded PRNG.
 *
 * NOT a real semantic embedding — do not use in production. Exists so CI can
 * prove "raw prompt never reaches the embed stage" without pulling the 22MB
 * Xenova model into the test environment.
 */
export class HashingEmbedder implements Embedder {
  readonly dim = 384;
  private readonly cache: LRUCache<string, number[]>;
  constructor(cache?: LRUCache<string, number[]>) {
    this.cache = cache ?? new LRUCache<string, number[]>();
  }
  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const key = abstractCacheKey(req.abstract);
    const hit = this.cache.get(key);
    if (hit) return { vector: hit, dim: this.dim, cached: true };
    const vec = hashToUnitVector(req.abstract, this.dim);
    this.cache.set(key, vec);
    return { vector: vec, dim: this.dim, cached: false };
  }
}

function hashToUnitVector(text: string, dim: number): number[] {
  const seed = createHash("sha256").update(text, "utf8").digest();
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    // Consume 4 seed bytes per dim slot, rolling through the 32-byte seed.
    const b0 = seed[(i * 4) % 32] ?? 0;
    const b1 = seed[(i * 4 + 1) % 32] ?? 0;
    const b2 = seed[(i * 4 + 2) % 32] ?? 0;
    const b3 = seed[(i * 4 + 3) % 32] ?? 0;
    const u32 = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    // Map to [-1, 1].
    out[i] = (u32 / 0xffffffff) * 2 - 1;
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < dim; i++) out[i] = (out[i] ?? 0) / norm;
  return out;
}

/** Reset the cached Xenova pipeline — used in tests to swap models. */
export function __resetXenovaForTest(): void {
  cachedPipeline = null;
  pipelineError = null;
}
