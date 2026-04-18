# Perf seed — 1M events

`packages/fixtures/seed/` owns the large-scale fixture generator used by the
M2 perf gate (`tests/perf/*.k6.js`). The gate is MERGE BLOCKING per
CLAUDE.md §Key Constraints (p95 dashboard < 2s, p99 ingest < 100ms).

## Shape

- 3 orgs (`acme-small`, `bolt-mid`, `crux-large`) seeded via the control
  plane (`orgs`, `users`, `developers`).
- 100 developers (7 + 33 + 60) spread across the three orgs, one SSO subject
  each, deterministic `stable_hash`.
- 90 days × 100 events/day per dev = **900 000 events**, plus ~10% filler
  from the long-tail distributions to cross the 1 000 000-event line for the
  CLAUDE.md gate.
- Event mix: 65% `llm_request`, 15% `tool_call`, 15% `code_edit_decision`
  (80% `accept`, 15% `reject`, 5% `modify`; 7% accepted-then-reverted),
  5% `session_start/end` marker rows.
- Costs drawn from `lognormal(μ=-2.3, σ=0.9)` per-event, capped at $8 —
  mirrors real Claude/Codex cost tails. Tokens proportional via the same
  draw.

## Running

```bash
# stack up first
docker compose -f docker-compose.dev.yml up -d
bun run db:migrate:pg
bun run db:migrate:ch

# seed 1M events (~3–5 min local, ~8 min in CI)
bun run seed:perf

# sanity check
echo 'SELECT count() FROM events' | \
  curl -s 'http://localhost:8123?database=bematist' --data-binary @-
```

## Determinism

The generator uses a seeded LCG (same state as `packages/schema/scripts/seed.ts`).
Two runs produce the same UUIDs, timestamps, costs — critical for the perf
threshold to be comparable across CI runs.

## Why not extend `scripts/seed.ts`?

The small seed (8k events) is used by unit + E2E tests and must stay fast
(< 5s). A separate entry point keeps the perf seed's multi-minute runtime
out of the default dev loop while reusing the same CH client + canonical
event shape.
