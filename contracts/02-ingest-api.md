# 02 — Ingest API

**Status:** draft
**Owners:** Workstream C (ingest)
**Consumers:** B (collector), GitHub App (webhooks), VCS providers
**Last touched:** 2026-04-16

## Purpose

The HTTP surface that the collector and external systems hit. Three endpoint families, one auth scheme, one set of error semantics.

## Endpoints

### 1. OTLP HTTP/Protobuf — `:4318`

Native Bun OTLP receiver. Sidecar OTel Collector is OPTIONAL (only enabled via `--profile otel-collector`).

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/v1/traces` | OTLP protobuf | maps to `Event` (kind=`llm_request`/`llm_response`/`tool_call`) |
| POST | `/v1/metrics` | OTLP protobuf | maps to `Event` (kind=`session_start`/`session_end`/aggregate counters) |
| POST | `/v1/logs` | OTLP protobuf | maps to `Event` for adapter-emitted logs |

OTel resource attributes mapped per `01-event-wire.md`. Tenant/engineer identity ignored from resource attrs — server uses JWT.

### 2. Custom JSON — `:8000`

For adapters without native OTel.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/v1/events` | `{ events: Event[] }` (≤1000 per request) | zod-validated; dedup via Redis SETNX |
| POST | `/v1/heartbeat` | `{ device_id, version, adapters: AdapterStatus[] }` | every 60s; powers `bematist doctor` and dashboard collector health |
| POST | `/v1/audit/journal` | `{ entries: EgressJournalEntry[] }` | one-way mirror of the collector's local egress journal for tenant-side audit (Bill of Rights #1) |

### 3. Webhooks — `:8000`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/v1/webhooks/github` | GitHub webhook payload | HMAC-validated against per-org secret |
| POST | `/v1/webhooks/gitlab` | GitLab webhook payload | HMAC-validated |
| POST | `/v1/webhooks/bitbucket` | Bitbucket webhook payload | HMAC-validated |

Subscribed events (GitHub baseline): `pull_request`, `pull_request_review`, `workflow_run`, `push`, `check_suite`. Daily reconciliation cron does `gh pr list --state merged` for last 7 days to catch missed webhooks.

## Auth

```
Authorization: Bearer bm_<orgId>_<rand>
```

- One ingest key per `(org, environment)` pair.
- Verified by Envoy `ext_authz` (Rust) at the gateway layer in production deploys; verified inline in self-host/embedded.
- Token bucket rate limit per key in Redis: default **1000 events/sec/org**, configurable per tier.
- Webhook endpoints use HMAC, not bearer — `X-Hub-Signature-256` etc.

## Tier enforcement

- **Tier-C 403 guard (managed cloud):** ingest REJECTS any event with `tier='C'` unless `org.tier_c_managed_cloud_optin=true`. The client policy file is **not** the security boundary — the server is.
- **Forbidden fields fuzzer:** any payload from a Tier A/B source containing `rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames` → HTTP 400. CI runs an adversarial fuzzer; gate is 100%.
- **Tier-A `raw_attrs` allowlist:** enforced at write-time after redaction; non-allowlisted keys dropped with counter increment.

## Response codes

| Code | Meaning | Body |
|---|---|---|
| 202 Accepted | Buffered for write (normal path) | `{ accepted: N, deduped: M, request_id }` |
| 207 Multi-Status | Some events accepted, some rejected | `{ accepted: N, rejected: [{ index, reason }], request_id }` |
| 400 Bad Request | Schema violation OR forbidden field present | `{ error, field, code }` |
| 401 Unauthorized | Missing/invalid bearer | (no body) |
| 403 Forbidden | Tier-C without opt-in, or rate limit exhaustion of "free" budget | `{ error, code }` |
| 413 Payload Too Large | >1000 events, or >5MB body | `{ error }` |
| 429 Too Many Requests | Token bucket exhausted | `Retry-After: <s>` header |
| 500 Internal | Unexpected | `{ error, request_id }` (with Sentry breadcrumb id) |

**Idempotency:** repeated `client_event_id` returns 202 with `deduped` count incremented; never an error.

**Backpressure:** 429 is the collector's signal to slow down and rely on the egress journal. Collector retries with exponential backoff capped at 5 min.

## Performance gates

- **p99 ingest <100ms** under 8M events/day load (PRD §10).
- **24h soak (F15 / INT0):** 100 evt/sec sustained with no flakes via `@clickhouse/client` HTTP. If flaky → switch to Plan B (Go side-car over UNIX socket); must be documented and ready before Sprint 1.

## Health & observability

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | liveness — returns 200 if process up |
| `GET /readyz` | readiness — returns 200 if Postgres + ClickHouse + Redis reachable |
| `GET /metrics` | Prometheus exposition |

## Invariants

1. **Ingest is the only writer.** No path bypasses it.
2. **Server-derived identity overrides client-claimed.** Tenant/engineer come from JWT.
3. **Idempotency via Redis SETNX is authoritative.** ClickHouse `ReplacingMergeTree(ts)` is a safety net only (see `09-storage-schema.md` Changelog for why not `client_event_id`).
4. **Server-side redaction runs BEFORE write.** Even if collector already redacted (defense-in-depth), the server is authoritative — redaction rules can update without redeploying every dev's binary.
5. **No endpoint accepts un-versioned events.** Missing `schema_version` → 400.

## Open questions

- Per-tenant rate-limit defaults — is 1000 evt/sec/org enough for a 500-engineer org? (Owner: C — likely needs per-engineer sub-bucket.)
- Webhook retry storms — do we deduplicate on `(repo_id, event_id)` from the provider? (Owner: C — yes, in Redis with 7d TTL.)
- Should `/v1/events` support gzip/zstd content-encoding by default? (Owner: C — recommend yes, gate at gateway.)

## Changelog

- 2026-04-16 — initial draft.
- 2026-04-16 — Sprint-0 M0: reference `ReplacingMergeTree(ts)` instead of `(client_event_id)` in Invariants §3 — see `09-storage-schema.md` Changelog for the CH 25 UUID-version-col constraint.
- 2026-04-16 — Sprint-1 Phase 1: Bearer `dm_<orgId>_<keyId>_<secret>` is an ingest-key verified via timingSafeEqual + Postgres `ingest_keys` lookup with 60s LRU, NOT a JWT. JWT applies to dashboard sessions and Phase-4 B2B API only. See D-S1-1, D-S1-2.
- 2026-04-16 — Sprint-1 Phase 4: §Invariants #1 "Ingest is the only writer" means "writes from outside the ingest boundary". The Plan-B Go side-car (apps/ingest-sidecar/) — when CLICKHOUSE_WRITER=sidecar — is part of the ingest boundary (same deployment unit, same tenant+auth context across the UNIX socket), not an external writer. The Redis Streams WAL is the ingest-internal durability seam. See D-S1-7, D-S1-24.
- 2026-04-16 — Sprint-1 Phase 6: webhooks at /v1/webhooks/{github,gitlab,bitbucket} verified via hand-rolled HMAC (GitHub/Bitbucket) and plaintext-token+IP-allowlist (GitLab); transport dedup via dedup:webhook:<source>:<deliveryId> SETNX 7d; row dedup via git_events UNIQUE(pr_node_id). GitHub App named bematist-github per D-S1-19.
