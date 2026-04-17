# Bematist — Contracts

> **Read this first.** These contracts are a **guide, not a lock.** They exist so 4 people can build in parallel without colliding at the seams. If a contract turns out to be wrong, change it — just ping the consumers in the PR. The goal is unblocking work, not freezing the design.
>
> What IS locked: PRD decisions D1–D31 (`dev-docs/PRD.md`) and the rules in `CLAUDE.md`. Contracts must respect those; everything else is negotiable.

## What lives here

One file per seam between workstreams. A "seam" is anywhere code from one workstream calls or reads data produced by another. Internal module boundaries inside a single workstream do **not** belong here — owners decide those.

| File | Seam | Owners |
|---|---|---|
| `01-event-wire.md` | Collector → Ingest payload | B + C |
| `02-ingest-api.md` | HTTP endpoints (OTLP / custom JSON / webhooks) | C + B |
| `03-adapter-sdk.md` | IDE adapter interface | B |
| `04-scoring-io.md` | Scoring inputs/outputs | H |
| `05-embed-provider.md` | Embedding provider abstraction | H |
| `06-clio-pipeline.md` | On-device prompt pipeline + `PromptRecord` | G + B |
| `07-manager-api.md` | Next.js Server Actions + Route Handlers + SSE for the dashboard | E + C |
| `08-redaction.md` | Server-side redaction contract | G |
| `09-storage-schema.md` | ClickHouse + Postgres tables read by multiple workstreams | D |

## How to add a contract

1. New seam emerges → open PR adding `contracts/NN-name.md` with the next number.
2. Use the template below.
3. Link it from this README's table.

## How to change a contract

- **Additive** (new optional field, new endpoint, new enum value with sensible default): one reviewer from a consuming workstream approves. Merge.
- **Breaking** (rename, removed field, semantic shift): list every consumer in the PR description, get one approval per consumer, ship the new field alongside the old where possible, then remove the old in a follow-up. Bump the Changelog.
- **Either way:** append a Changelog line. Don't silently mutate.

If you find yourself wanting to make a breaking change in a hurry, the right move is usually to add the new field as additive, ship, then schedule the removal — not to break the wire mid-sprint.

## When to skip the contract

If something is genuinely internal to one workstream — even if it touches two files in different packages — the owner can keep it in their head or in a code comment. Contracts are for cross-workstream seams.

If you're not sure whether a thing is a seam: ask. The cost of one extra contract file is low; the cost of two devs disagreeing about an undocumented interface mid-sprint is high.

## File format (template)

```markdown
# NN — <name>

**Status:** draft | active | deprecated
**Owners:** <workstream(s)>
**Consumers:** <workstream(s) that read or call this>
**Last touched:** <YYYY-MM-DD>

## Purpose

One paragraph: what this seam exists to enable.

## Schema

TypeScript / zod / SQL / OpenAPI snippet — whatever's most natural. Keep it minimal; link out for the long version.

## Invariants

Bullet list of things that MUST hold. These are the load-bearing rules; if you change one, it's a breaking change.

## Open questions

What we haven't decided yet. Mark with owner if known.

## Changelog

- YYYY-MM-DD — what changed and why
```

## Versioning philosophy

Contracts are versioned by Changelog, not by filename. We don't ship `01-event-wire-v2.md` — we edit `01-event-wire.md` and bump the Changelog. The exceptions are user-facing metric versions (`ai_leverage_v1` → `v2`) where the suffix lives in the metric name itself per CLAUDE.md "Metric versioning mandatory" rule. Contracts about those metrics still use the changelog pattern.

## What contracts are NOT

- They are not a substitute for code review.
- They are not a substitute for talking to each other.
- They are not exhaustive specs — they cover the seam, not every detail.
- They are not the locked PRD — that's `dev-docs/PRD.md`. If a contract conflicts with the PRD, the PRD wins; fix the contract.
