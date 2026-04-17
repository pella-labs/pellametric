# bematist-ingest-sidecar (Plan B)

**Status:** skeleton (Sprint-1 Phase 4). Owner: **Workstream D — Jorge**.

This is the **Plan-B ClickHouse writer** for Bematist ingest. It exists so we
have a ready-to-deploy escape hatch if the Bun `@clickhouse/client` path flakes
during production load.

## What it is

A small Go process that:

1. Reads from Redis Stream `events_wal` (same WAL the Bun ingest writes).
2. Performs ClickHouse inserts via `clickhouse-go/v2` (Native protocol, not HTTP).
3. ACKs the stream entry on success.

It is **part of the ingest boundary**: it runs in the same deployment unit as
the Bun ingest, accepts `canonical_json` rows already authenticated + tier-
enforced by Bun, and does not cross the trust perimeter. Contract 02
§Invariants #1 ("ingest is the only writer") still holds — the side-car is
ingest, not an external writer.

See `contracts/02-ingest-api.md` Changelog entry dated **2026-04-16 Phase 4**.

## When it swaps in

Flip `CLICKHOUSE_WRITER=sidecar` in the ingest deployment env. The Bun ingest
then forwards canonical rows over the UNIX socket
`/tmp/bematist-ingest-sidecar.sock`. No code change in the ingest server; the
dependency seam lives in `apps/ingest/src/clickhouse.ts`.

## Trip thresholds (PRD §Phase 4 R2)

The Plan-B side-car replaces the Bun `@clickhouse/client` writer if any of the
following are observed in a sustained window:

1. **≥ 3 `ECONNRESET` or idle-socket races per 100k inserts** for > 10 minutes.
   (Diagnostic: `keep_alive_idle_socket_ttl_ms=2000` is the first mitigation;
   if that's not enough, the side-car uses the Native protocol which avoids
   HTTP keep-alive altogether.)
2. **p99 insert latency > 500ms for > 10 minutes** on a steady-state workload.
3. **Any silent data-loss signal**, e.g. ClickHouse row-count drift vs WAL
   `xlen` on a daily reconciliation.

The soak test that gates this decision is `F15 / INT0` — 24h sustained 100
evt/sec with no flakes. See `CLAUDE.md` §Architecture Rules #7.

## Build

```bash
cd apps/ingest-sidecar
go build -o ../../dist/bematist-ingest-sidecar ./...
```

No tests yet — see TODOs in `main.go`. Do not wire into `docker-compose.yml`
until Jorge signs off.

## Related decisions

- **D-S1-7** — Redis Streams WAL as the ingest-internal durability seam.
- **D-S1-24** — Plan-B swap is an internal writer move, not a boundary breach.
- **CLAUDE.md** §Architecture Rules #7 — single-writer pattern + Plan-B
  readiness requirement.
