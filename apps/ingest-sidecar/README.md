# Plan-B Ingest Sidecar

Alternate ClickHouse writer over a UNIX socket. Activated **only** if the 24h Bun→CH soak (F15 / INT0) shows flakes via `@clickhouse/client` HTTP — contract 09 §Plan B. Skeleton ships in Sprint 1 per CLAUDE.md Architecture Rule #7 so the swap is a one-line change instead of a multi-day rewrite.

## When to activate

- 24-hour soak at 100 evt/sec against Bun → CH HTTP shows any of:
  - p99 insert latency breach (>100ms target per contract 02)
  - Transient `@clickhouse/client` connection errors or retries > 0
  - Any backpressure that causes ingest to 429 collectors

If soak passes, **do not activate**. Keep this skeleton on ice.

## Build

```bash
cd apps/ingest-sidecar
go build ./cmd/sidecar
./sidecar   # listens on /tmp/devmetrics-sidecar.sock by default
```

Docker (distroless, nonroot):

```bash
docker build -t bematist/ingest-sidecar .
docker run --rm -v /tmp:/tmp bematist/ingest-sidecar
```

Or via the `sidecar` compose profile (not default-up):

```bash
docker compose -f docker-compose.dev.yml --profile sidecar up ingest-sidecar
```

## Protocol

Newline-delimited JSON over UNIX socket. Each line is one `Event` (see `contracts/01-event-wire.md`). File permission `0600`, owned by the process — no bearer auth on the socket.

## Activation in Bun ingest

The switch to sidecar is a **single import change** in `apps/ingest/src/clickhouse.ts`. The current default is `@clickhouse/client` HTTP; the sidecar path is commented out with a `TODO(F15)` marker. When activating:

1. Verify sidecar container is healthy (`docker ps | grep sidecar`).
2. Verify socket file permissions (0600, process-owned).
3. Uncomment the socket-writer import in `apps/ingest/src/clickhouse.ts`.
4. Comment out the HTTP writer.
5. Deploy ingest; traffic flows through the socket.
6. Redis SETNX remains the authoritative dedup (contract 09 invariant 2) — unchanged.

## Perf targets

- p99 insert latency < 50 ms for 1000-event batches.
- 100 evt/sec sustained for ≥30 min on the seed fixture before promoting to production.

## Tests

```bash
go test ./...
```

Three tests land with the skeleton:
- Size-based batch trigger (3 adds → flush).
- Cancel-based batch drain (uncommitted events flushed on `ctx.Done()`).
- Drain idempotency (second drain returns empty).

The CH writer stub in `main.go` logs rather than writes to CH; the real writer implementation lives in `internal/ch/writer.go` (to be filled in at activation time, not now — YAGNI).

## Why Go

- `github.com/ClickHouse/clickhouse-go/v2` is the mature CH driver, battle-tested under load.
- Single static binary; distroless image ~15 MB.
- Concurrency model matches the batch-and-flush pattern well.

## License

Apache 2.0, same as the rest of the repo.
