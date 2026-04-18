# F15 / INT0 — 24h Bun ↔ ClickHouse soak result (M2 tag)

**Status:** NOT YET RUN

CLAUDE.md §Testing Rules locks this gate: _"24h sustained 100 evt/sec with no
flakes, OR Plan B (Go side-car) documented and ready before Sprint 1 starts."_
Plan B readiness is captured in `dev-docs/soak-plan-b-readiness.md`.

## How to fill this in

Run the soak per `tests/soak/README.md`, then replace each placeholder below
with the real values. Commit the filled doc on the branch that records the
decision ("proceed with Bun path" or "flip to Plan B").

---

## Run metadata

| Field | Value |
|---|---|
| Operator (who kicked it off) | _TBD_ |
| Start (UTC) | _TBD_ |
| End (UTC) | _TBD_ |
| Git commit under test | _TBD_ |
| Ingest branch | _TBD_ |
| Hardware (CPU / RAM / disk / OS) | _TBD_ |
| Docker compose version | _TBD_ |
| Bun version | _TBD_ |
| `@clickhouse/client` version | _TBD_ |
| ClickHouse server version | _TBD_ |
| Bearer minted from | `bun run seed:perf` @ _commit_ |
| `run_id` (from summary JSON) | _TBD_ |

## Headline result

- [ ] **PASS** — success rate ≥ 99.99%, zero silent drops, p99 ≤ 500 ms, < 3 `ECONNRESET` total
- [ ] **FAIL** — at least one gate tripped (list which below)

## Summary JSON (paste from `tests/soak/out/summary-<runId>.json`)

```json
{
  "runId": "TBD",
  "gate": "TBD"
}
```

## Bucket timeline highlights

Paste the 3–5 most interesting per-minute rows from
`tests/soak/out/buckets-<runId>.jsonl` (spikes, p99 outliers, memory jumps):

```jsonl
TBD
```

## Anomalies

Free-form: anything the summary JSON doesn't capture cleanly. Examples:
host-level CPU spikes, ClickHouse `system.errors` entries, Redis `MEMORY_USAGE`
trajectory, oom-kills, ingest restart events, disk backpressure.

- _TBD_

## Decision

One of:

- [ ] **Proceed with Bun `@clickhouse/client`.** F15 / INT0 cleared. No code
      change; keep `CLICKHOUSE_WRITER` unset (default real writer).
- [ ] **Flip to Plan B** (`apps/ingest-sidecar/`). Follow the 3-step cutover
      in `dev-docs/soak-plan-b-readiness.md`. Link the follow-up PR that
      (a) completes the side-car TODOs, (b) wires the env switch in
      `apps/ingest/src/clickhouse.ts` / `realWriter.ts`, (c) re-runs the soak
      on the side-car path.

## Appendix — files produced by the run

- `tests/soak/out/summary-<runId>.json` — the JSON above
- `tests/soak/out/buckets-<runId>.jsonl` — one per-minute row
- `tests/soak/out/failures-<runId>.jsonl` — one row per failed request
- `tests/soak/out/run-<runId>.log` — teed stdout/stderr from `run.sh`
