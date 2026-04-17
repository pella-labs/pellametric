# D2-01 Primer: Embed provider abstraction

**Workstream:** H-AI · **Date:** 2026-04-17 · **Contract:** `contracts/05-embed-provider.md` · **Blocks:** D2-05, D2-06, D2-07

## Goal

`packages/embed` exposes a single `EmbedProvider` interface with a resolver chain: OpenAI (default on managed cloud / BYO key) → Voyage-3 (premium BYO) → Ollama `nomic-embed-text` (local) → `@xenova/transformers` MiniLM-L6 (bundled fallback). No caching in this ticket — that's D2-05.

## Deliverables

- [ ] `packages/embed/src/types.ts` — `EmbedRequest`, `EmbedResult`, `EmbedProvider` per contract 05 §Provider interface.
- [ ] `packages/embed/src/providers/openai.ts` — `text-embedding-3-small` @ 512d Matryoshka. Uses `OPENAI_API_KEY`. `embed()` + `embedBatch()` + `health()`.
- [ ] `packages/embed/src/providers/voyage.ts` — `voyage-3` @ 1024d. Uses `VOYAGE_API_KEY`. Same shape.
- [ ] `packages/embed/src/providers/ollama.ts` — `nomic-embed-text` @ 768d via `http://localhost:11434/api/embeddings`. No API key.
- [ ] `packages/embed/src/providers/xenova.ts` — bundled MiniLM-L6 @ 384d via `@xenova/transformers`. Lazy-load.
- [ ] `packages/embed/src/resolve.ts` — `resolveProvider()` walks the chain per contract 05 §Default chain. Respects `EMBEDDING_PROVIDER` env override.
- [ ] `packages/embed/src/index.ts` — re-export types + resolver.

## Tests

- Each provider: mocked HTTP happy path, error fallback, dim assertion (`vector.length === provider.dim`).
- Resolver: explicit override, default chain, `health()` failure falls through.
- Air-gapped safety: resolver refuses to pick `openai`/`voyage` when `BEMATIST_AIR_GAPPED=1`.
- Zero network in test suite — MSW or fetch stubs.

## Invariants (per contract 05)

- Providers do NOT redact (Clio does that upstream).
- Cache key includes `provider.id + model + dim` — but cache lives in D2-05.
- `vector.length === provider.dim` at every return.
- Air-gapped resolvers refuse cloud providers.

## Branch / PR

```bash
git switch -c D2-01-embed-providers-jorge
# implement, test
bun run lint && bun run typecheck && bun run test
git push -u origin D2-01-embed-providers-jorge
gh pr create --base main --title "feat(embed): provider abstraction + 4-tier resolver chain (D2-01)" --body "Refs #3"
```

## Dependencies

- Contract 05 (authoritative shape)
- Node deps: `openai`, `@xenova/transformers` (bundled), `undici` for Ollama HTTP
- No D1 blockers — can start immediately

## Time estimate

~5–6 h. 4 provider files (~100 LOC each) + resolver + tests.

## After this ticket

- D2-05 wires Redis L1 + Postgres L2 cache around this.
- D2-06 uses `embedBatch()` with OpenAI Batch API for nightly cluster recompute.
- D2-07 Twin Finder uses live `embed()` against the resolved provider.
