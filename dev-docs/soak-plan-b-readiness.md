# Plan B readiness — `apps/ingest-sidecar/` cutover procedure

**Pair:** `dev-docs/soak-result-m2.md` (pass/fail of the F15 / INT0 soak).
**Context:** CLAUDE.md §Architecture Rules #7 — _"If 24h soak (F15 / INT0)
shows flakes → switch hot-path writer to Plan B (tiny Go side-car over UNIX
socket). Plan B must be documented and ready before Sprint 1 starts — don't
discover this in Sprint 5."_

This doc is the honest inventory of how ready Plan B actually is, and the
step-by-step cutover an operator runs if the soak fails.

---

## 1. What's in `apps/ingest-sidecar/` today

Audited at commit on the `feat-m3-soak-harness` branch.

| File | LOC | Purpose | State |
|---|---:|---|---|
| `main.go` | 72 | UNIX-socket listen loop | **Skeleton only.** Opens `/tmp/bematist-ingest-sidecar.sock`, accepts connections, closes them (no read, no insert). Header comment lists the TODOs as `go-redis/v9` consumer, `clickhouse-go/v2` Native writer, structured `slog`, Prometheus `/metrics`, SIGTERM graceful drain. |
| `go.mod` | 3 | `module github.com/pella-labs/bematist/ingest-sidecar` on `go 1.22` | Zero dependencies declared. Adding `go-redis/v9` + `clickhouse-go/v2` + `slog` requires a `go mod tidy` pass. |
| `README.md` | 63 | Scope, trip thresholds, build command | Accurate; quotes PRD §Phase 4 R2 trip thresholds (≥3 `ECONNRESET` / 100k inserts, p99 > 500 ms for > 10 min, any silent row-count drift). |

**No tests. No Dockerfile. No docker-compose entry. No wire-up in
`apps/ingest/src/clickhouse.ts`.** The flag exists
(`CLICKHOUSE_WRITER=sidecar` in `apps/ingest/src/flags.ts:25`) but
`apps/ingest/src/index.ts` hard-codes `createRealClickHouseWriter()` on boot —
the flag is read, typed, and then ignored.

Contracts recognise Plan B as inside the trust boundary:
`contracts/02-ingest-api.md` Changelog entry dated 2026-04-16 Phase 4 notes
that the side-car under `CLICKHOUSE_WRITER=sidecar` is part of the ingest
boundary (same deployment unit, same tenant+auth context across the UNIX
socket). That decision is locked; cutover only needs code, not a contract
amendment.

**Bottom line:** Plan B is a **named escape hatch with a reserved flag and a
stubbed Go process.** Calling it "ready to deploy" overstates things — a
cutover is ~1–2 days of focused engineering, not a trigger-pull. This doc
lists exactly what that engineering is.

## 2. What needs to change in the ingest to swap the writer

The seam is `apps/ingest/src/clickhouse.ts`'s `ClickHouseWriter` interface —
intentionally narrow (`insert(rows) | ping()`). Swapping writers is a
constructor choice at boot.

### 2.1 Consume the `CLICKHOUSE_WRITER` flag

`apps/ingest/src/index.ts` currently does:

```ts
const clickhouseWriter = createRealClickHouseWriter();
```

Replace with a flag-respecting branch:

```ts
const clickhouseWriter =
  flags.CLICKHOUSE_WRITER === "sidecar"
    ? createSidecarClickHouseWriter({ socketPath: process.env.BEMATIST_SIDECAR_SOCKET })
    : createRealClickHouseWriter();
```

### 2.2 Add `createSidecarClickHouseWriter`

New file `apps/ingest/src/clickhouse/sidecarWriter.ts` (not to be written
now — this doc is the design). Implements `ClickHouseWriter` by:

- Opening a UNIX-socket client against `/tmp/bematist-ingest-sidecar.sock`
  (configurable via `BEMATIST_SIDECAR_SOCKET`).
- On `insert(rows)`: serialises rows as length-prefixed
  `canonical_json` frames (same shape as `wal/append.ts` emits) and writes
  them, then awaits an `{ ok: true }` / `{ err: "..." }` ACK frame.
- On `ping()`: writes a one-byte opcode, expects a one-byte ACK within 2 s.
- Keeps one persistent connection with auto-reconnect on EPIPE.

### 2.3 Side-car Go process must actually work

`apps/ingest-sidecar/main.go` needs to grow into what its header comment
already specifies:

1. Accept UNIX-socket connections; read length-prefixed frames.
2. Batch and insert via `clickhouse-go/v2` Native protocol
   (`clickhouse.OpenDB` with a `Conn` using the native 9000 port, NOT the
   HTTP 8123 path — that's the whole point of Plan B).
3. ACK each frame (or the whole batch, whichever the wire format decides).
4. `slog`-structured logs; Prometheus `/metrics` on `:9464`.
5. SIGTERM graceful drain: stop accepting, finish in-flight inserts, close
   socket, exit.

The README's `Build` instructions are accurate (`go build -o
../../dist/bematist-ingest-sidecar ./...`) but produce an empty loop today.

### 2.4 Deployment plumbing

- `Dockerfile.ingest-sidecar` (new) — `golang:1.22-alpine` build stage →
  `gcr.io/distroless/static` runtime. No dynamic deps.
- `docker-compose.yml` (main, not dev) — add a service that shares a
  volume mount (`/run/bematist`) with the ingest container so the UNIX
  socket is reachable across both. Dev compose stays HTTP-only.
- `.github/workflows/release.yml` — publish the side-car image alongside
  `apps/ingest`. Same SLSA attestation / cosign signature cadence as the
  rest of the images.

## 3. Environment variables to add

Naming follows CLAUDE.md §Environment Variables conventions (`BEMATIST_*`
for collector, unprefixed for server vars). The side-car is a server-side
concern, but it lives inside the ingest trust boundary, so it gets the
`BEMATIST_` prefix to match the other ingest-internal vars (`BEMATIST_ORG`,
`BEMATIST_TOKEN`, etc.) that already use it.

| Var | Default | Purpose |
|---|---|---|
| `CLICKHOUSE_WRITER` | `client` | Already defined. Flip to `sidecar` to activate Plan B. |
| `BEMATIST_SIDECAR_SOCKET` | `/tmp/bematist-ingest-sidecar.sock` | UNIX socket path the ingest connects to and the side-car listens on. |
| `BEMATIST_SIDECAR_METRICS_ADDR` | `:9464` | Prometheus scrape endpoint exposed by the side-car. |
| `BEMATIST_SIDECAR_MAX_BATCH` | `1000` | Upper bound on rows per CH insert; mirrors the WAL consumer's `batchMaxRows`. |
| `BEMATIST_SIDECAR_CH_NATIVE_ADDR` | `clickhouse:9000` | Native-protocol ClickHouse endpoint (port 9000, not 8123). Different from `CLICKHOUSE_URL` because the HTTP endpoint is the thing we're escaping. |

`.env.example` update required once the side-car is wired.

## 4. Known unknowns — what we only learn when we try

Honest list; pretending otherwise would be worse than documenting.

1. **Wire format.** The skeleton doesn't pick one. Candidates: length-prefixed
   JSONEachRow bytes (simplest, matches `@clickhouse/client`), MessagePack
   (smaller), or CH Native protocol rows (fastest, but the side-car becomes
   more than a thin shim). JSON is the safest first cut.
2. **Batching strategy.** Whether to batch on the ingest side (send a single
   frame per WAL-consumer batch) or the side-car side (accept per-row frames
   and batch internally). Ingest-side batching is cheaper (fewer UNIX-socket
   round-trips) but couples the two more tightly. Start with ingest-side.
3. **Back-pressure.** If ClickHouse lags, the side-car's in-memory queue grows.
   Needs a bounded channel + an explicit `{ err: "backpressure" }` ACK so the
   ingest can retry the WAL entry instead of ACKing. This is the single most
   failure-mode-sensitive choice in the design.
4. **Socket resilience.** UNIX-socket EPIPE on side-car restart — the ingest
   writer must reconnect without losing the in-flight batch. Redis Streams WAL
   is the durability backstop (rows re-read on the next XREADGROUP), but only
   if the ingest didn't XACK prematurely. The writer contract needs to NOT ACK
   the WAL entry until the side-car confirms.
5. **`clickhouse-go/v2` vs `@clickhouse/client`.** The whole premise is that
   the Native-protocol client avoids the keep-alive / idle-socket races the
   HTTP client is prone to. If `clickhouse-go` has its own analogous issues
   on our load shape, Plan B doesn't help and we're back to "fix the HTTP
   client." The soak that follows the cutover has to re-run to prove the
   swap actually fixes the flake.
6. **Metrics parity.** `/readyz` today reads the writer's `ping()` result.
   The side-car ping must return "CH reachable via Native protocol" not just
   "UNIX socket alive," or we'll mask CH outages.

## 5. Three-step cutover

This is the "pull the trigger" sequence, assuming §2 and §3 have landed in a
prior PR (they have not — that's item 7's follow-up PR, scoped out of this
branch).

### Step 1 — Deploy side-car alongside ingest

```bash
# Local
CLICKHOUSE_WRITER=sidecar \
BEMATIST_SIDECAR_CH_NATIVE_ADDR=localhost:9000 \
docker compose -f docker-compose.yml up bematist-ingest bematist-ingest-sidecar

# Prod (pseudo; real steps depend on Helm chart / Terraform)
helm upgrade bematist ./charts/bematist \
  --set ingest.clickhouseWriter=sidecar \
  --set ingestSidecar.enabled=true
```

Verify: `docker compose logs bematist-ingest-sidecar` shows
`listening on /run/bematist/bematist-ingest-sidecar.sock` and a steady
ClickHouse Native-protocol handshake log line.

### Step 2 — Flip the env var on the ingest

The ingest boot log must show:

```
runtime adapters wired (bun.redis dedup, node-redis lua+streams, SIDECAR UNIX socket)
```

not the HTTP-client line. If it still says `@clickhouse/client`, the
`createSidecarClickHouseWriter` branch wasn't wired (§2.1).

### Step 3 — Verify and monitor

- `curl http://localhost:8000/readyz` → 200 with `clickhouse: true`.
- Post one event via the smoke script:
  `(cd apps/ingest && bun run smoke)` — must show `smoke: OK` with
  `cost_usd_rollup > 0`.
- Re-run the soak on the side-car path:
  `CLICKHOUSE_WRITER=sidecar tests/soak/run.sh`.
- Monitor `bematist-ingest-sidecar`'s `/metrics` for `inserts_total`,
  `insert_errors_total`, `insert_duration_seconds{quantile="0.99"}`.
- Roll back by unsetting `CLICKHOUSE_WRITER` (defaults to `client`) and
  restarting the ingest container. The Redis Streams WAL protects against
  data loss across the flip — unACKed entries re-read on next startup.

## 6. Honest state summary

Plan B is ready as a **design and a named seam**, not as a drop-in binary.
Today's skeleton proves the socket path and the trust-boundary framing; it
does not perform a single ClickHouse insert. If the 24-hour soak passes,
this doc stays a reference. If it fails, the follow-up PR described in §2
is ~1–2 days of focused work before the 3-step cutover in §5 applies. That
timeline beats the alternative ("discover this in Sprint 5") by enough that
the skeleton-plus-doc posture is defensible per CLAUDE.md §Architecture
Rules #7.
