# Bun ↔ ClickHouse soak harness (F15 / INT0)

Gates the Bun `@clickhouse/client` writer per CLAUDE.md §Testing Rules. Must
sustain **100 evt/s for 24 hours with no flakes** or we flip to Plan B
(`apps/ingest-sidecar/`). See `dev-docs/soak-plan-b-readiness.md` for the
cutover procedure.

## Pre-flight

```bash
docker compose -f docker-compose.dev.yml up -d
bun run db:migrate:pg && bun run db:migrate:ch
bun run seed:perf                     # mints tests/perf/.ingest-bearer
(cd apps/ingest && bun run dev:live)  # separate shell
```

## Smoke (6-minute mini-soak)

```bash
bun run tests/soak/ingest-clickhouse-soak.ts --hours=0.1 --rate=10
```

Exits 0 on success; writes `tests/soak/out/{summary,buckets,failures}-*.{json,jsonl}`.

## Real 24-hour run

```bash
tests/soak/run.sh            # full 24h, 100 evt/s, batch=10
```

Run under `tmux` / `screen` / `nohup` on dedicated hardware. Capture the final
summary JSON in `dev-docs/soak-result-m2.md`.

## Gate thresholds (match Plan B trip thresholds)

| Signal | Trip |
|---|---|
| Success rate | < 99.99% |
| `ECONNRESET` total | ≥ 3 |
| p99 request latency | > 500 ms |
| CH row-count drift vs accepted | abs > max(100, 0.1% of accepted) |

Any trip → flip to Plan B.
