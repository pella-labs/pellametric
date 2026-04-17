# PRD: Sprint 1 — Ingest + Server-Side Privacy (Workstream C + G-backend)

> **Scope:** GitHub issue [pella-labs/bematist#2](https://github.com/pella-labs/bematist/issues/2).
> **Owner:** Walid.
> **Branch:** `2-workstream-c-g-backend-ingest-server-side-privacy-sprint-1-fan-out-walid` — six phased commits land on this branch; a single PR opens against `main` at M1.
> **Status:** LOCKED for execution. Ambiguities resolved inline; no open questions.
> **Parent docs:** `CLAUDE.md` (locked rules), `dev-docs/PRD.md` (D1–D32 decisions), `contracts/01-event-wire.md`, `contracts/02-ingest-api.md`, `contracts/08-redaction.md`, `contracts/09-storage-schema.md`.

---

## Executive Summary

Sprint 1 turns the Sprint-0 ingest skeleton (`apps/ingest` with zod-validated `POST /v1/events`, console-only sink, prefix-only Bearer stub) into a production-shaped writer — authed, deduped, tier-enforced, durably buffered, OTLP-capable, and webhook-ingestive — without breaking the "ingest is the only writer" invariant or leaking a single forbidden field from a Tier-A/B source.

**Delivery shape:** one PR against `main`, six sequential phases of commits on the feature branch. Each phase is its own reviewable unit with tests that must pass before the next begins; the whole branch opens a single PR at M1. Phases land in strict dependency order: **auth → tier enforcement → Redis SETNX dedup → ClickHouse write path (via Redis Streams WAL) → OTLP HTTP receiver → webhooks + GitHub App**. Every phase is size **M** except the CH write path (L) and OTLP receiver (L). Each phase leaves the branch green on CI (lint, typecheck, unit, forbidden-field fuzzer) so the reviewer of the eventual single PR can walk the phased commits cleanly.

Three architectural pins the research ratified: **(1)** Better Auth is *not* on the ingest hot path — the `dm_<orgId>_<rand>` bearer is a raw ingest-key verified via `timingSafeEqual` against a `sha256(secret)` stored in Postgres `ingest_keys` with a 60-second LRU cache; **(2)** ClickHouse writes go through a Redis Streams WAL (not in-memory batching) so a Bun crash doesn't silently eat events; **(3)** webhook dedup runs at two layers — transport (`SETNX` on `X-GitHub-Delivery`) **and** row (`UNIQUE (pr_node_id)` in Postgres `git_events`) — because the daily reconciliation cron will otherwise double-ingest anything GitHub replays during the cron window.

The 24-hour F15/INT0 soak test is the Sprint-2 gate, not a Sprint-1 gate. Sprint 1 ships the Plan-B Go side-car *skeleton* (coord: Jorge) so the swap is a one-line ingress change if the soak trips any of three named thresholds.

---

## Brief

> Produce a PRD for Walid's Sprint 1 fan-out of GitHub issue #2 (Workstream C + G-backend). Scope: six Sprint 1 deliverables in `apps/ingest` on branch `2-workstream-c-g-backend-ingest-server-side-privacy-sprint-1-fan-out-walid`: (1) real JWT + `ingest_keys` lookup replacing the prefix-only Bearer stub in `apps/ingest/src/auth.ts` + Redis token-bucket rate limit (1000 evt/sec/org default); (2) tier enforcement — Tier-C 403 guard gated on `org.tier_c_managed_cloud_optin`, forbidden-field fuzzer (100% rejection CI gate: rawPrompt/prompt_text/messages/toolArgs/toolOutputs/fileContents/diffs/filePaths/ticketIds/emails/realNames from Tier A/B), Tier-A raw_attrs allowlist at write-time; (3) Redis SETNX dedup keyed on (tenant_id, session_id, event_seq) with 7-day TTL; (4) ClickHouse write path via `@clickhouse/client` HTTP to `bematist.events` with batch insert — F15/INT0 24h 100 evt/sec soak is the Sprint-2 gate, Plan B Go side-car coord; (5) OTLP HTTP/Protobuf receiver on :4318 mapping per `contracts/01-event-wire.md` OTel section; (6) webhooks `POST /v1/webhooks/{github,gitlab,bitbucket}` HMAC-validated + GitHub App with reconciliation cron. Brownfield addition to a locked project. Naming is `@bematist/*` not `@devmetrics/*`. Revision mode: one locked PRD suitable to drive the six implementation PRs sequentially on this branch.

---

## Assumptions

Every default the team chose to unblock itself. Each is flagged `(assumed)` so they're easy to revisit later.

| # | Assumption | Rationale |
|---|---|---|
| A1 | **Sprint 1 runs under a single ingest replica.** Multi-replica rate-limit correctness is already designed-for (Redis Lua atomicity), but we don't operationally run more than one replica until Sprint 3 perf gates. | Avoids stampede-herd scenarios in the soak window; matches Sprint-0 dev reality. |
| A2 | **Postgres `ingest_keys`, `policies`, `git_events`, `signed_config_nonces` tables are owned by Jorge (Workstream D) but Sprint 1 can't wait.** Walid seeds draft Drizzle migrations in `packages/schema/postgres/migrations/` marked `SPRINT1_DRAFT_NEEDS_JORGE_REVIEW` in the PR description. Jorge's pass ratifies or renames columns before M1 merges to `main`. | D-seed landed only `orgs`, `users`, `developers`. Sprint-1 cannot produce a working auth flow without `ingest_keys`. Coordinating via contract changelog, not waiting. |
| A3 | **Two Redis clients per ingest process:** `Bun.redis` (native, Redis 7.2+, 7.9× faster, no cluster) for `SET NX PX` + simple commands; `@redis/client` v4 for Lua `EVALSHA` + future cluster. | R3 research: `Bun.redis` doesn't expose EVALSHA cleanly and blocks cluster; node-redis is the hybrid-safe path. |
| A4 | **No server-side redaction in Sprint 1** — that's Sprint 2 (deliverables 7–9 in the issue). Sprint 1 ships the *scaffolding* that Sprint 2 plugs into: a `RedactStage` interface + an always-pass-through no-op implementation behind a feature flag. | Keeps Sprint 1 phases small; preserves the hot-path shape so Sprint 2 is a drop-in, not a rewrite. |
| A5 | **Bun version pinned to ≥ 1.3.4** in `package.json` `engines` + CI preflight. Three `http.Agent` keep-alive bugs under older Bun silently degrade `@clickhouse/client` to connection-per-insert. | R2 research: Bun 1.3.4 release fixed all three. Current repo root `engines.bun` = `">=1.2.0"` — needs bump in Phase 1. |
| A6 | **`@clickhouse/client` pinned to ≥ 1.18.2** with `keep_alive.idle_socket_ttl = 2000` (server default 3000ms − 1s). | Version 1.18.2 emits explicit warning on ttl mismatch; version currently pinned in `packages/schema/package.json` is `^1.7.0` — needs bump. |
| A7 | **The OTLP HTTP receiver lives inside the Bun ingest process on `:4318`, NOT in the docker-compose `otel-collector` sidecar profile.** The sidecar is optional per PRD Arch Rule #5; Sprint 1 ships the native receiver. | Docker-compose `otel-collector` profile exposes :4318 too — this is a port collision *only if both are enabled*. We disable the sidecar in `docker-compose.dev.yml` default profile; it remains available via `--profile otel-collector` for users who want the pre-digestion pattern. |
| A8 | **GitHub App name is `bematist-github`**, not the legacy `devmetrics-github` spelling in `contracts/02-ingest-api.md` and the issue body. | R5 research: rename is safe; GitHub is pivoting to `client_id` as stable identity; only breakage is hard-coded slug URLs. |
| A9 | **One PR, six phased commits on the branch.** All Sprint-1 work stays on this feature branch; a single PR opens against `main` at M1 containing the six phased commits in dependency order. | User explicit: "we will do all work required of me in this issue on this branch"; "we can do 6 phases" but "I want 1 PR". |
| A10 | **Test coverage minimum per WORKSTREAMS.md:** C ≥ 20, G-backend part of G ≥ 10. Sprint 1 delivers 25+ tests on the ingest surface + Sprint-2 redaction scaffolding tests as carry-over. Privacy adversarial gate is a Sprint-2 MERGE BLOCKER, not Sprint-1. | PRD §10 Phase 1 minimums. |
| A11 | **Scale target for Sprint 1 perf is "works at dev-scale (10 evt/sec), headroom for 100 evt/sec soak in Sprint 2".** No Sprint-1 perf gate. This is an explicit deferral of `contracts/02-ingest-api.md` §Performance gates (p99 ingest <100ms) to M2; contract-02 is NOT amended. Sprint-1 ingest is not expected to meet the p99<100ms line until Jorge's CH tuning + Sebastian's k6 rig land in M2. | INT11 p95/p99 gates are M2 blockers, not M1. |
| A12 | **No time estimates.** Sprint 1 has 6 phases in one PR; M1 at Day 12 (WORKSTREAMS.md). This PRD sizes by S/M/L bands only. | Coding-agent velocity is variable; user said "we are ready to do sprint 1 entirely right away". |

---

## Current State (Revision mode)

What exists in the repo as of branch checkout:

- **`apps/ingest/`** — Bun server with `/healthz`, `/readyz`, `POST /v1/events`. 11 passing tests in `server.test.ts`. Zod-validates against `@bematist/schema` `EventSchema`. Console-only sink. Prefix-only Bearer stub in `auth.ts` (returns hard-coded `org_dev` / `eng_dev`). Readiness checks TCP-ping PG + Redis, HTTP-ping CH.
- **`packages/schema/`** — `src/event.ts` zod `Event`. Postgres: `orgs`, `users`, `developers` Drizzle tables + one migration `0000_premium_shaman.sql`. ClickHouse: one migration `0001_events.sql`. No `ingest_keys`, `policies`, `git_events`, `audit_log`, `outcomes`, `signed_config_nonces` yet.
- **`packages/redact/`, `packages/otel/`, `packages/api/`** — directories exist (from Sprint-0 skeleton) but are empty / placeholder.
- **`docker-compose.dev.yml`** — PG 5433 (timescale/timescaledb:latest-pg16), CH 8123+9000 (clickhouse-server:25.8-alpine, DB `bematist`), Redis 6379 (redis:7-alpine), optional `otel-collector` sidecar.
- **Root `package.json`** — `engines.bun` pinned to `">=1.2.0"` (needs bump to 1.3.4+ — see A5).
- **Contracts** — `contracts/01`–`09` exist, mostly drafts. Known drift: `@devmetrics/*` example imports in `contracts/02-ingest-api.md` (fix via additive changelog line when touching that file).
- **Auth plane** — no Better Auth installed yet. `ingest_keys` row minting path does not exist; no admin surface. Sprint 1 ships the *verifier*; the *minter* is dashboard-side (Sandesh / Sprint 2+).

---

## Research Brief (Loop 0, synthesized)

Five parallel researchers covered the five biggest unknown-unknowns. Abbreviated findings — full research transcripts preserved in conversation history.

### R1 — OTLP HTTP/Protobuf decoding in Bun

- **Use `@bufbuild/protobuf` + vendored `opentelemetry-proto` + `buf generate` in CI.** Bun v1 is explicitly supported; static TS codegen; native BigInt; no runtime `.proto` loading. Fallback: `@opentelemetry/otlp-transformer` (ships pre-generated protobufjs artifacts) — worth it only if a bufbuild correctness issue surfaces against a real exporter.
- **Accept both `application/x-protobuf` and `application/json`.** JSON-only is a non-starter — OTel SDKs default to protobuf; Collector `otlphttp` exporter is protobuf-only as of writing ([open-telemetry/opentelemetry-collector#6945](https://github.com/open-telemetry/opentelemetry-collector/issues/6945)).
- **Proto3-JSON gotchas:** traceId/spanId are hex strings (not base64 — OTel override); enums are ints only; keys are lowerCamelCase; int64 as string-or-number; ignore unknown fields.
- **Bun body-parsing:** `req.arrayBuffer()` works; 128MB default max; `DecompressionStream` native for gzip. Reject zstd (not in OTLP/HTTP spec).
- **Don't hand-roll varint parsing.** `ResourceSpans → ScopeSpans → Span` + recursive `KeyValue.AnyValue` is three-level nesting; every OTel exporter delegates.

### R2 — `@clickhouse/client` on Bun soak behaviour

- **Pin Bun ≥ 1.3.4** — three `http.Agent` keep-alive bugs fixed there (property-name mismatch, `Connection: keep-alive` not honored, case-sensitive response-header parse). Under earlier Bun, silent degradation to connection-per-insert will kill the soak.
- **Pin `@clickhouse/client` ≥ 1.18.2** — explicit warning on `keep_alive.idle_socket_ttl` vs server `keep_alive_timeout` mismatch; earlier versions eat `ECONNRESET` silently ([clickhouse-js#150](https://github.com/ClickHouse/clickhouse-js/issues/150), [#202](https://github.com/ClickHouse/clickhouse-js/issues/202)).
- **Client-side batching beats `async_insert=1`.** Flush on `size ≥ 1000` OR `age ≥ 500ms`. We control the one ingest process; server-side async-insert is for swarms of uncoordinated writers.
- **Durable buffer = Redis Streams.** In-memory batches vanish on crash — CH `Buffer` engine is "fire-and-forget" (CH#14976 open since 2020); `wait_for_async_insert=1` only confirms server-side, not Bun-side. Use `XADD events_wal * ...` at ingress, consumer-group drains → batch → `insert()` → ACK after HTTP 200. PostHog/Tinybird both use Kafka or internal Gatherer for the same reason.
- **Plan B trip signals** (soak gate, not Sprint 1): `ECONNRESET` rate > 0.1%, OR p99 insert > 500ms for 30 consecutive minutes, OR Bun RSS growth > +50MB/h with no drop after GC.

### R3 — Redis client + atomic token bucket

- **Use `Bun.redis`** for hot-path `SET NX PX`. Bun 1.2.9+ native, 7.9× faster than ioredis, requires Redis 7.2+. Does not support Redis Cluster or first-class `EVALSHA`.
- **Use `@redis/client` v4 (node-redis)** for Lua `EVALSHA` — works on Bun (Bun 1.2.9 switched its internal deps from ioredis to node-redis; upstream-blessed). Two clients per replica: native for SETNX, node-redis for Lua.
- **Dedup key:** `dedup:{tenant_id}:{session_id}:{event_seq}` — hash-tag braces around `{tenant_id}` co-locate keys for eventual Redis Cluster. Value `"1"`, `SET NX PX 604800000` (7 days).
- **Token bucket:** `rl:{org_id}:{device_id}`, capacity 1000, refill 1000/s, `PEXPIRE 60000` per call. Lua uses `redis.call('TIME')` internally (single clock source; replica-safe). `SCRIPT LOAD` once; cache SHA1; retry on `NOSCRIPT` with `EVAL`.
- **Memory budget:** ~100 bytes/key at Redis 7.2. `8M evt/day × 7d ≈ 56M keys × 100B ≈ 5.6GB` for dedup + small token-bucket overhead → **budget 8GB Redis RSS**. `maxmemory-policy noeviction` — an evicted dedup key = duplicate spend on the live dashboard, exactly the failure mode PRD §D14 rejects CH-dedup over.
- **Why not skip Redis and use CH `ReplacingMergeTree`?** Async merges leak duplicate spend into live dashboards between merges; `OPTIMIZE FINAL` is slow and locks. The PRD already litigated this — R3 confirms.

### R4 — JWT / Better Auth / Ed25519

- **Better Auth 1.5 *does* ship an API Key plugin** (org-owned tokens, Redis secondary storage, per-key rate limits), but the docs make no claim of `timingSafeEqual` + its 10s expiry-cleanup cooldown signals "not designed for per-event hot paths at 1000 evt/sec/org". **Keep Better Auth on the dashboard session tier only.**
- **Ingest hot path verifier:** `timingSafeEqual(sha256(presented), row.key_sha256)` + Postgres lookup cached in an in-process LRU (1000 entries, 60s TTL). Bun's `node:crypto.timingSafeEqual` is native + constant-time.
- **PRD Arch Rule #8 ambiguity resolved:** "tenant/engineer identity server-derived from JWT" means *dashboard + Phase-4 B2B API path*, not collector ingest. Collector path is ingest-key → Postgres row → `(tenant_id, engineer_id?)`. **Amend `contracts/02-ingest-api.md` §Auth** with an additive changelog line.
- **Ed25519 for signed-config:** Bun's native `crypto.subtle.verify({ name: "Ed25519" }, ...)` ([Bun PR #1971](https://github.com/oven-sh/bun/pull/1971)). Fallback `@noble/ed25519` v3.1.0 behind a capability check.
- **Signed config payload:** `{ configJson, issuedAt, notBefore, notAfter, nonce, keyId }`. Verifier checks `now ∈ [notBefore, notAfter]` with ±5min skew tolerance; persists `nonce` in `signed_config_nonces` for replay protection. `notAfter - issuedAt = 7d` enforces PRD D20 cooldown.
- **Revocation:** 60s LRU staleness acceptable for MVP; Redis pub/sub `ingest_key:revoke` channel is Sprint-2 upgrade.

### R5 — GitHub App / webhooks

- **Hand-roll HMAC verifier per platform** (~40 lines each). Length-guard, `Buffer.from(..., 'hex')` both sides, `timingSafeEqual`. Never compare strings directly — Bun's `crypto.timingSafeEqual` throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` on length mismatch, and attacker-controlled headers can be any length.
- **Skip `@octokit/webhooks` dispatcher under Bun** — open `KeyObject` + `node:crypto` edge issues ([Bun#2036](https://github.com/oven-sh/bun/issues/2036), [webhooks.js#593](https://github.com/octokit/webhooks.js/issues/593)). Use `@octokit/auth-app` for App JWT minting + token caching only.
- **Raw body preservation non-negotiable** — capture the `arrayBuffer()` before any JSON parse; HMAC breaks on whitespace/reformatting.
- **Transport dedup:** `SETNX dedup:gh:<X-GitHub-Delivery> EX 604800` (7d, matches GitHub's 3d replay window + 4d safety). Duplicates return HTTP 200 OK, not 409.
- **Row-level dedup** (the edge case): daily reconciliation cron uses a synthetic key, webhook uses `delivery_id` — both pass transport `SETNX`, both attempt row write. Fix: Postgres `git_events (pr_node_id UNIQUE)`. Upsert collision guarantees exactly-once at the row layer.
- **Reconciliation via GraphQL, not REST.** `search(query: "org:X is:pr is:merged merged:>=2026-04-09", type: ISSUE, first: 100)` + cursor pagination. ~10× cheaper than REST enumeration; 5000 pts/hr budget is comfortable. Installation token with `pull_requests:read + contents:read` reads `pull_request_review` history — no PAT needed.
- **GitLab:** `X-Gitlab-Token` is plain-text secret (not HMAC — feature request open since 2016). Must `timingSafeEqual` header bytes + source-IP allowlist for defense-in-depth.
- **Bitbucket:** `X-Hub-Signature: sha256=<hex>` — single header, no `-256` suffix; HMAC-SHA256 of exact raw body bytes.
- **Arch Rule #1 is internally consistent.** Webhooks deliver *to* ingest; ingest writes. Collector is one source; webhook is another; both funnel to the same single writer.

### Cross-researcher red flags (unknown unknowns surfaced)

1. **Port-collision latent bug:** docker-compose dev `otel-collector` sidecar exposes `:4318`; so does our Sprint-1 native OTLP receiver. If both run, bind fails silently on the second one. **Fix:** disable sidecar in default profile (already in compose via `profiles: [otel-collector]`); document in ingest README.
2. **Keep-alive silent degradation** (R2) — CI must assert Bun version ≥ 1.3.4 and `@clickhouse/client` ≥ 1.18.2. Otherwise soak fails mysteriously.
3. **Reconciliation double-write** (R5) — the subtle one. Two dedup layers are non-optional.
4. **`maxmemory-policy noeviction`** (R3) — if someone defaults Redis to `allkeys-lru`, a duplicate webhook arriving 6 days later evicts our dedup key and we double-bill. Ship a Redis preflight check in `/readyz`.
5. **Forbidden-field drift** (my own analysis) — contract-01 §Invariant #4 lists 11 fields (`rawPrompt, prompt_text, messages, toolArgs, toolOutputs, fileContents, diffs, filePaths, ticketIds, emails, realNames`); contract-08 §Forbidden-field rejection lists **12** (adds `prompt`). The PRD aligns to the contract-08 superset (12 entries) and Phase 2 lands an additive-changelog line on `contracts/01-event-wire.md` §Invariant #4 adding `prompt`. Single-source constant `FORBIDDEN_FIELDS` imported by ingest validator AND CI fuzzer AND Clio pipeline. A field added in only one place is a silent Tier-A leak.
6. **Tier-A `raw_attrs` allowlist drift** (CLAUDE.md C10 vs contract 01 §Invariant 5) — the allowlist lives in `packages/redact/tier_a_allowlist.ts` per contract 08. Sprint 1 imports that constant (even though the allowlist-filter stage runs in Sprint 2's redact pipeline); exporting it early prevents a Sprint-2 fork.

---

## Constraints

| Constraint | Value | Source |
|---|---|---|
| Domain & use case | Multi-source AI-engineering telemetry ingest + compliance-grade privacy posture | brief, CLAUDE.md |
| Scale target day 1 | Sprint-1 dev scale; 100 evt/sec sustained soak is M2 gate; 10k devs / 8M evt/day is Phase-1 ceiling | CLAUDE.md §Key Constraints |
| Privacy default tier | B (counters + redacted envelopes) | D7 |
| Retention defaults | Tier-C 30d, Tier-B 90d, Tier-A 90d via partition drop | D7, challenger C1 |
| GDPR erasure SLA | 7 days (Sprint 1 does not ship the erasure *worker*; it ships the ingest-side invariants the worker depends on) | CLAUDE.md |
| Budget — external services | Redis 8GB RSS; ClickHouse as-is; Postgres as-is; no new paid SaaS | A3, R3 |
| Licensing | Apache 2.0 for this code (ingest + schema + redact skeleton live in the Apache-2.0 half, not the BSL half) | CLAUDE.md §Key Constraints |
| Reliability target | "Production-quality error handling; no data loss on Bun crash once Redis Streams WAL lands" | default-and-annotate |
| Test minimums | C ≥ 20; G-backend within G ≥ 10 by sprint end | WORKSTREAMS.md |
| Team & skills | TypeScript + Bun + Zod + Drizzle. Jorge (Workstream D) owns DB schema; coord via contract changelog. | WORKSTREAMS.md |
| Evaluation criteria | All 6 deliverables pass their acceptance criteria; forbidden-field fuzzer hits 100% rejection; privacy adversarial gate stays a *Sprint-2* MERGE BLOCKER (Sprint 1 ships the plumbing) | issue #2 |
| Timeline | No time estimate per skill rules; M1 at WORKSTREAMS.md Day 12; sizing bands only | skill rules, A12 |

---

## Innovations (CORE / STRETCH / CUT)

This is an infrastructure fan-out, not a greenfield product — innovation mostly means "the tactical wins that stop us from re-doing this in Sprint 2". Research surfaced four candidates:

| # | Innovation | Category | Rationale |
|---|---|---|---|
| I1 | **Single-source forbidden-field list** as an exported `const FORBIDDEN_FIELDS` in `packages/schema` imported by validator + CI fuzzer + Clio pipeline. | CORE | Prevents silent Tier-A leak from drift (red flag #5). Lands in Phase 2 (tier enforcement). |
| I2 | **Redis Streams WAL** in front of ClickHouse instead of in-memory batching. | CORE | Data-loss fix (R2). Turns the soak from "hope Bun doesn't crash" into "ACK-after-CH-200 durability by construction". Lands in Phase 4. |
| I3 | **Unified `RedactStage` interface with no-op implementation in Sprint 1**, Sprint-2 plugs in TruffleHog/Gitleaks/Presidio without rewriting the hot path. | CORE | Sprint 2 becomes additive; keeps Sprint-1 phases small. Lands in Phase 2. |
| I4 | **Row-level `UNIQUE(pr_node_id)` on `git_events`** as the last-layer webhook dedup. | CORE | Reconciliation × replay edge case (red flag #3). Lands in Phase 6. |
| I5 | **Property-based fuzzer** using `@bematist/schema` `EventSchema` + `fast-check` to mutate forbidden fields into every slot. | STRETCH | Classic property tests catch 80% of what we care about; `fast-check` is small and popular. Lands in Phase 2 if time; otherwise Sprint 2. |
| I6 | **Plan-B Go side-car *skeleton* commit in Phase 4** (even though the swap trigger is a Sprint-2 decision). | CUT for Sprint-1, carry to Sprint-2 kickoff. | Jorge owns Plan B. Follow-up at Sprint-2 kickoff; Sprint-1 only documents the trip-thresholds (already done in §Research Brief R2). |

**Every CORE innovation is attached to a specific phase in the Phased Plan.**

---

## Architecture

The Sprint-1 ingest has **two pipeline shapes** — collector events (`/v1/events`, `/v1/{traces,metrics,logs}`) run the full hot-path; webhooks (`/v1/webhooks/*`) run a shorter VCS-provider pipeline. They share auth, rate-limit, and raw-body capture; they diverge at decode.

### Collector event pipeline (full)

```
request arrives on /v1/events or /v1/{traces,metrics,logs}
  ├─ [A] auth — verify `Bearer dm_<orgId>_<rand>` → (tenantId, engineerId?, tier)
  ├─ [B] rate-limit — Redis Lua token-bucket `rl:{org_id}:{device_id}`
  ├─ [C] body read — raw bytes (ArrayBuffer)
  ├─ [D] decode — OTLP protobuf | OTLP-JSON | custom JSON → raw event object
  ├─ [E] tier enforce — forbidden-field reject (recursive scan of raw JSON, pre-zod)
                         + Tier-C 403 (org policy check)
  ├─ [F] shape validate — zod `EventSchema`
  ├─ [F.1] Tier-A raw_attrs allowlist — post-zod, behind `ENFORCE_TIER_A_ALLOWLIST` (Sprint 1 no-op)
  ├─ [G] dedup — `SET dedup:{tenant}:{session}:{seq} NX PX 7d`
  ├─ [H] redact-stage — no-op in Sprint 1 (Sprint 2 plugs in TruffleHog/Gitleaks/Presidio)
  ├─ [I] WAL append — `XADD events_wal * batch ...`
  └─ 202/207/403/400 response — idempotent; duplicate `client_event_id` returns 202 with `deduped++`
```

### Webhook pipeline (short)

```
request arrives on /v1/webhooks/{github,gitlab,bitbucket}
  ├─ [A-webhook] HMAC verify — source-specific header + raw body
  ├─ [B] rate-limit — per-source bucket (separate from collector buckets)
  ├─ [C] raw body — preserved before any JSON parse
  ├─ [G-webhook] transport SETNX dedup — `dedup:webhook:{source}:{delivery_id}` 7d
  ├─ [PG] git_events upsert — `INSERT ... ON CONFLICT (pr_node_id) DO UPDATE`
  └─ 200 on dedup-hit; 200 on write; 401 on bad signature
```

**Webhooks NEVER run `enforceTier`.** They do not carry a `tier` field; their payloads are VCS provider documents, not collector Events. A Phase 6 test asserts `enforceTier` is never invoked on the webhook handler path.

A background consumer drains the Redis Stream `events_wal`, batches to 1k rows or 500ms, inserts to ClickHouse via `@clickhouse/client`, and ACKs the Stream on HTTP 200. Webhooks get their own write path to Postgres `git_events` (row-level unique on `pr_node_id`), and the Sprint-1 GitHub App skeleton has a daily GraphQL reconciliation cron.

### A. Auth primitive

**Decision:** raw ingest-key verifier. Better Auth NOT on the ingest hot path.

```ts
// apps/ingest/src/auth/verifyIngestKey.ts
import { timingSafeEqual, createHash } from "node:crypto";
import { LRUCache } from "lru-cache";

// Bearer format: dm_<orgId>_<rand>. orgId prefix speeds the PG lookup (indexed column).
const CACHE = new LRUCache<string, IngestKeyRow>({ max: 1000, ttl: 60_000 });

export async function verifyBearer(header: string | null, pg: PgPool): Promise<AuthContext | null> {
  const parsed = parseBearer(header);            // returns { raw, orgId } or null
  if (!parsed) return null;
  const presentedHash = createHash("sha256").update(parsed.raw).digest();

  const cached = CACHE.get(parsed.raw);
  const row = cached ?? (await pg.query(
    "SELECT id, org_id, engineer_id, key_sha256, tier_default, revoked_at FROM ingest_keys WHERE org_id = $1 AND id = $2 LIMIT 1",
    [parsed.orgId, parsed.keyId],
  )).rows[0];
  if (!row || row.revoked_at) return null;

  const stored = Buffer.from(row.key_sha256, "hex");
  if (presentedHash.length !== stored.length) return null;  // guard before timingSafeEqual
  if (!timingSafeEqual(presentedHash, stored)) return null;

  if (!cached) CACHE.set(parsed.raw, row);
  return { tenantId: row.org_id, engineerId: row.engineer_id, tier: row.tier_default };
}
```

**Draft migration** (seeded by Walid, marked `SPRINT1_DRAFT_NEEDS_JORGE_REVIEW`):

```sql
-- packages/schema/postgres/migrations/0001_sprint1_auth.sql
CREATE TABLE ingest_keys (
  id          text        PRIMARY KEY,                  -- format: dm_<orgId>_<rand> last segment
  org_id      uuid        NOT NULL REFERENCES orgs(id),
  engineer_id uuid        REFERENCES developers(id),    -- nullable = org-wide service key
  name        text        NOT NULL,
  key_sha256  text        NOT NULL,                      -- hex-encoded SHA-256 of raw secret
  tier_default char(1)    NOT NULL DEFAULT 'B',          -- A|B|C; overridable per-event
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX ingest_keys_org_idx ON ingest_keys (org_id);
ALTER TABLE ingest_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON ingest_keys
  USING (org_id::text = current_setting('app.current_org_id', TRUE));
```

**Contract amendment (Phase 1):** additive changelog line in `contracts/02-ingest-api.md` clarifying "Bearer dm_…" is an ingest-key (Postgres lookup), not a JWT; JWT path applies to dashboard + Phase-4 B2B API.

### B. Redis primitives

Two clients per ingest process:

- **`Bun.redis`** for `SET NX PX` (dedup), `HEARTBEAT` writes, simple `GET/SET`. Connection string from `REDIS_URL`.
- **`@redis/client` (node-redis v4)** for `EVALSHA` (token bucket). Same connection string.

**Connection lifecycle.** Both clients are singletons created in `apps/ingest/src/redis.ts` at boot and registered with a shared shutdown registry. On `SIGTERM`: (1) stop accepting new HTTP; (2) flush WAL consumer (Phase 4); (3) `@redis/client.quit()`; (4) `Bun.redis` is fire-and-forget at process exit (no explicit close API). On connection error during request-serving, handlers return 503 `{code: 'REDIS_UNAVAILABLE'}` and `/readyz` flips to not-ready until auto-reconnect succeeds. Both clients use a reconnect backoff equivalent to `retries => Math.min(retries * 100, 3000)` ms.

**Dedup:**

```ts
const key = `dedup:{${tenantId}}:${sessionId}:${eventSeq}`;
const result = await Bun.redis.set(key, "1", "NX", "PX", 604_800_000); // 7d
return result === "OK";   // true = first sight; false = duplicate
```

**Token bucket:** Lua script loaded once at boot via `SCRIPT LOAD`; SHA cached in `process.env.TOKEN_BUCKET_SHA`. Script is **R3's canonical variant** (uses `redis.call('TIME')` internally):

```lua
-- packages/redact/scripts/token_bucket.lua  (co-owned with C)
local t    = redis.call('TIME')
local now  = t[1]*1000 + math.floor(t[2]/1000)
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local h    = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tok  = tonumber(h[1]) or cap
local ts   = tonumber(h[2]) or now
tok = math.min(cap, tok + (now - ts) * rate / 1000)
if tok < cost then
  redis.call('HMSET', KEYS[1], 'tokens', tok, 'ts', now)
  redis.call('PEXPIRE', KEYS[1], 60000)
  return {0, tok, math.ceil((cost - tok) * 1000 / rate)}
end
tok = tok - cost
redis.call('HMSET', KEYS[1], 'tokens', tok, 'ts', now)
redis.call('PEXPIRE', KEYS[1], 60000)
return {1, tok, 0}
```

**Preflight** in `/readyz`: verify `CONFIG GET maxmemory-policy` returns `noeviction`. If not, return 503 with `reason: "redis-eviction-policy"`. A Redis operator setting `allkeys-lru` would silently break dedup for any webhook that replays ≥6 days later.

### C. ClickHouse write path via Redis Streams WAL

The novel architectural choice for Sprint 1: ingest doesn't write to ClickHouse synchronously on the request path.

```
POST /v1/events
  └─ (A–G) auth, validate, dedup
      └─ XADD events_wal * tenant_id=... json=<canonicalized row>
           └─ response 202
                                              ┌─ consumer ─┐
 Bun worker (same process, different thread)  ──→ XREADGROUP → batch(1k/500ms)
                                              └→ @clickhouse/client.insert(...)
                                                    └→ XACK events_wal on HTTP 200
                                                    └→ retry on 5xx (exponential backoff, 5 attempts)
                                                    └→ on repeated failure: XCLAIM to dead-letter group
```

**Config knobs** (all in `apps/ingest/src/clickhouse.ts`):
- `keep_alive.idle_socket_ttl = 2000` (server default 3000 − 1s).
- `request_timeout = 30000`; `compression.request = true`; `compression.response = true`.
- `max_open_connections = 10` (Sprint 1 single-replica; revisit for M2).
- `format: 'JSONEachRow'`.

**Batch flush policy:** Sprint-1 hard-codes `{ maxRows: 1000, maxAgeMs: 500 }`. Surfaced via env var in Sprint 2.

**Dead-letter group:** failed batches land on `events_wal_dead`. Daily cron alerts if group-lag > 0.

**Plan B coord (Jorge):** Phase 4 lands a stub commit at `apps/ingest-sidecar/` (Go + `go.mod` + `main.go` with Redis Streams consumer + ClickHouse Go driver + UNIX-socket HTTP endpoint). Not wired into docker-compose; not the active consumer. The swap at Sprint 2 is a one-line env flag in `apps/ingest`: `CLICKHOUSE_WRITER=sidecar` routes the consumer to the side-car UNIX socket instead of direct `@clickhouse/client`.

**Arch Rule #1 compatibility.** "Ingest is the only writer" means no path from *outside the ingest boundary* writes to CH. The Go side-car — when enabled — is architecturally *part of* ingest: same deployment unit, same tenant boundary, same auth context across the UNIX socket. The Redis Stream is the ingest-internal durability seam; whether a Bun worker or a Go side-car drains it is an implementation detail behind the same boundary. Phase 4 lands an additive-changelog line on `contracts/02-ingest-api.md` §Invariants #1 making this explicit.

### D. OTLP HTTP receiver

Ports: `:4318` inside Bun ingest (separate from `:8000` which hosts `/v1/events` + webhooks).

```ts
// apps/ingest/src/otlp/server.ts
import { ExportTraceServiceRequest } from "@bematist/otel/gen/trace_service_pb";  // bufbuild-generated
import { mapOtlpToEvents } from "@bematist/otel/map";

async function handleTraces(req: Request, auth: AuthContext): Promise<Response> {
  const ct = req.headers.get("content-type") ?? "";
  const raw = await req.arrayBuffer();
  const payload =
    ct.startsWith("application/x-protobuf")
      ? ExportTraceServiceRequest.fromBinary(new Uint8Array(raw))
      : mapProto3JsonToSpans(await readBodyAsJson(raw, req.headers));
  const events = mapOtlpToEvents(payload, auth);   // → Event[]
  return ingestEvents(events, auth);                // same downstream as /v1/events
}
```

**Package layout:**
- `packages/otel/` owns the generated protobuf bindings + mapping code. `buf generate` in CI uses `buf.gen.yaml` against the vendored submodule at `packages/otel/vendor/opentelemetry-proto/`.
- `apps/ingest/src/otlp/` owns the HTTP handlers + content-type dispatch.

**Ingress isolation:** `:4318` is its own `Bun.serve({ port: 4318, fetch: otlpHandler })`; only accepts `POST /v1/traces`, `/v1/metrics`, `/v1/logs`. `GET /` and anything else → 404.

**Resource attributes:** per contract 01 §OTel-mapping, ignore collector-claimed `service.namespace` for tenant identity. `service.instance.id` is advisory; `device.id` is cross-checked against the device registry (Postgres `developers.device_ids[]` — out of Sprint-1 scope; Sprint 1 passes `device_id` through without validation, flagged in the migration changelog).

### E. Webhook family

Three platforms, one internal shape:

```ts
type WebhookDelivery = {
  source: "github" | "gitlab" | "bitbucket";
  deliveryId: string;    // X-GitHub-Delivery UUID, GitLab event UUID, Bitbucket X-Request-UUID
  event: string;         // pull_request, push, workflow_run, ...
  rawBody: Uint8Array;
  signature: string;     // raw header value; verifier-specific interpretation
};
```

**Verifier interface:**

```ts
// apps/ingest/src/webhooks/verify.ts
export interface WebhookVerifier {
  verify(delivery: WebhookDelivery, secret: Buffer): boolean;  // true if authentic
}
export const verifiers: Record<WebhookDelivery["source"], WebhookVerifier> = {
  github:    githubHmacSha256,           // X-Hub-Signature-256: sha256=<hex>
  gitlab:    gitlabPlaintext,             // X-Gitlab-Token: <secret>  + source-IP allowlist
  bitbucket: bitbucketHmacSha256,         // X-Hub-Signature: sha256=<hex>  (no -256 suffix!)
};
```

Each verifier is ~40 lines; all use length-guarded `timingSafeEqual`. GitLab adds a source-IP allowlist (configured per org in `policies`).

**Dedup at two layers:**
- Transport: `SETNX dedup:webhook:{source}:{deliveryId} 1 EX 604800`. Duplicate → HTTP 200 immediately.
- Row: `UNIQUE (pr_node_id)` on `git_events`. Reconciliation × webhook collision absorbed by ON CONFLICT upsert.

**GitHub App:**
- Name: **`bematist-github`** (A8).
- `@octokit/auth-app` for App-JWT minting + installation-token cache. No `@octokit/webhooks` dispatcher.
- Permissions: `pull_requests:read`, `contents:read`, `checks:read`, `metadata:read`. Subscribed events: `pull_request`, `pull_request_review`, `push`, `workflow_run`, `check_suite` (matching contract 02).
- Reconciliation cron: `schedule: daily at 03:00 UTC` runs:
  ```graphql
  query($cursor: String) {
    search(query: "org:<ORG> is:pr is:merged merged:>=2026-04-09", type: ISSUE, first: 100, after: $cursor) {
      nodes { ... on PullRequest { number repository { name } mergeCommit { oid } mergedAt } }
      pageInfo { endCursor hasNextPage }
    }
  }
  ```
  Paginate; upsert on `(org_id, repo_id, pr_number)` — row-level `pr_node_id` UNIQUE absorbs collision with webhook arrivals.
- Search-API 1000-result ceiling mitigated by partitioning: `merged:YYYY-MM-DD..YYYY-MM-DD` per day for the 7-day window → max 1000 × 7 = 7000 PRs catchable.

**Draft migration** (`git_events`, marked `SPRINT1_DRAFT_NEEDS_JORGE_REVIEW`):

```sql
CREATE TABLE git_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES orgs(id),
  source        text        NOT NULL,                      -- github | gitlab | bitbucket
  event_kind    text        NOT NULL,                      -- pull_request.closed, push, ...
  pr_node_id    text        UNIQUE,                         -- nullable (push events have no PR node)
  repo_id       text        NOT NULL,
  pr_number     integer,
  commit_sha    text,
  merged_at     timestamptz,
  payload       jsonb       NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX git_events_org_received_idx ON git_events (org_id, received_at DESC);
ALTER TABLE git_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON git_events USING (org_id::text = current_setting('app.current_org_id', TRUE));
```

### F. Tier enforcement

Three sub-stages in one `enforceTier(rawEvent, auth, orgPolicy)` function:

1. **Forbidden-field reject (pre-zod):** if event is Tier A or B AND any of `FORBIDDEN_FIELDS` is present **at any depth via recursive key-name scan of the raw JSON object, including nested `raw_attrs`** → return `{reject: 400, field, code: "FORBIDDEN_FIELD"}`. The `FORBIDDEN_FIELDS` constant lives in `packages/schema/src/invariants.ts` (new file, I1) and is imported by the ingest validator, the Sprint-1 CI fuzzer, and the Sprint-2 Clio pipeline. **Twelve entries** per contract-08: `rawPrompt, prompt, prompt_text, messages, toolArgs, toolOutputs, fileContents, diffs, filePaths, ticketIds, emails, realNames`.
2. **Tier-C 403 guard:** if event is Tier C AND `!orgPolicy.tier_c_managed_cloud_optin` → return `{reject: 403, code: "TIER_C_NOT_OPTED_IN"}`. `orgPolicy` is loaded from Postgres `policies` at auth time, cached 60s.
3. **Tier-A `raw_attrs` allowlist (post-zod, pre-WAL):** Sprint-1 exports `TIER_A_RAW_ATTRS_ALLOWLIST` from `packages/redact/src/tier_a_allowlist.ts` (matching contract 08 §Tier-A allowlist). Sprint-1 applies it as a no-op pass-through and logs what *would* be dropped, behind a feature flag `ENFORCE_TIER_A_ALLOWLIST=0`. Sprint 2 flips the flag. This preserves the hot-path shape now and delivers the allowlist *without* gating Sprint-1 on Sprint-2 redaction work.

**Ordering note.** Forbidden-field reject operates on the raw JSON object (post-`JSON.parse`, pre-zod) to avoid leaking a zod partial-parse of a payload we're about to reject — and to catch forbidden fields nested inside `raw_attrs` that zod's permissive `z.record(z.string(), z.unknown())` would silently allow through. Tier-A `raw_attrs` allowlist (sub-stage 3) runs POST-zod because it needs the validated `raw_attrs` shape. Tier-C 403 runs pre-zod (cheap org-policy lookup, no schema work needed).

**`policies` draft migration:**

```sql
CREATE TABLE policies (
  org_id                        uuid  PRIMARY KEY REFERENCES orgs(id),
  tier_c_managed_cloud_optin    boolean NOT NULL DEFAULT FALSE,
  tier_default                  char(1) NOT NULL DEFAULT 'B',
  presidio_recognizers_extra    jsonb,
  trufflehog_rules_disabled     jsonb,
  raw_attrs_allowlist_extra     jsonb,
  webhook_source_ip_allowlist   inet[],
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON policies USING (org_id::text = current_setting('app.current_org_id', TRUE));
```

**Forbidden-field fuzzer (CI gate):** property-based test with `fast-check` in `packages/schema/src/invariants.fuzz.test.ts`. For every `FORBIDDEN_FIELDS` entry × every Tier A/B `source`, arbitrary-generate an `Event` with the field injected at a random depth, expect `enforceTier` to return `reject: 400`. 100% rejection is the CI gate.

### G. Cross-cutting: feature flags, logging, readyz

- **Feature flags** via `process.env`: `ENFORCE_TIER_A_ALLOWLIST`, `WAL_CONSUMER_ENABLED`, `OTLP_RECEIVER_ENABLED`, `WEBHOOKS_ENABLED`, `CLICKHOUSE_WRITER={client|sidecar}`. All default OFF in Sprint 1 tests; `docker-compose.dev.yml` sets them ON for dev.
- **Flag coherence matrix (asserted at boot).** `OTLP_RECEIVER_ENABLED=1` REQUIRES `WAL_CONSUMER_ENABLED=1` (OTLP events XADD to the WAL; a disabled consumer would cause Redis memory to climb and everything to 503 silently). `WEBHOOKS_ENABLED` is independent (webhooks write to PG `git_events`, not the WAL). If an incoherent combination is set, ingest refuses to start: exit code 2, structured log `{code: 'FLAG_INCOHERENT', details}`. Dev compose sets everything ON.
- **Structured logging** via `pino` (already a dep). Fields: `request_id`, `tenant_id`, `engineer_id`, `event_kind`, `size_bytes`, `decision` (accept/reject/dedup), `reject_code`. Never log `prompt_text`, `tool_input`, `tool_output`, `raw_attrs` — even at Tier C. Enforced via a `pino` redact config listing those fields.
- **`/readyz` upgrades** (Phase 4): preflight `redis CONFIG GET maxmemory-policy` = `noeviction`; ping `pg SELECT 1`; HTTP `ch /ping`; return 503 with the failing check named.

**`/readyz` composite contract (final M1 shape).** Returns 200 iff ALL of:

1. Postgres `SELECT 1` ≤ 2s
2. ClickHouse `/ping` 200 ≤ 2s
3. `Bun.redis` `PING` → `PONG`
4. Redis `CONFIG GET maxmemory-policy` = `"noeviction"`
5. `FORBIDDEN_FIELDS` loaded, length === 12 (Phase 2+)
6. Lua token-bucket script SHA cached in process (Phase 1+)
7. WAL consumer group exists AND consumer-lag ≤ 10 000 messages (Phase 4+)

On failure, body is `{status: "not-ready", failing: [...]}` naming the specific check. `/healthz` remains a liveness-only 200 for process-up.

### Infrastructure implications

- **Bun version pin:** root `package.json` `engines.bun: ">=1.3.4"` bumped in Phase 1. CI adds `bun --version` assertion.
- **Dependency pins:** `@clickhouse/client: ^1.18.2` (bump from `^1.7.0` in `packages/schema/package.json`); `@bufbuild/protobuf: ^2.x`; `@octokit/auth-app: ^7.x`; `lru-cache: ^11.x`; `fast-check: ^4.x` (devDep); `@redis/client: ^4.7.x`. `Bun.redis` is a runtime, no dep.
- **Docker-compose:** unchanged. Default `profiles` keeps sidecar disabled so port 4318 is free.
- **Redis config hardening (dev compose):** add `--maxmemory 2gb --maxmemory-policy noeviction` to the redis command in `docker-compose.dev.yml`. Prod compose already pins.
- **CI:** new gates in `.github/workflows/ci.yml` — `bun run test:fuzzer` (forbidden-field property tests); `bun run test:auth` (LRU staleness + revocation integration); Bun-version assertion.

### Compliance & Security surface

Sprint 1 touches these compliance contracts without claiming them done:

- **GDPR Art. 17 (erasure)** — not Sprint-1 work, but Sprint-1 migrations must be partition-drop-compatible. `git_events` is partitioned by `(org_id_hash % 16, received_at:YYYYMM)` analog to ClickHouse events (Jorge review needed).
- **SOC 2 CC7.2 (audit log)** — `audit_log` rows land on every admin action (revoke an ingest key, flip Tier-C opt-in, register a signed config). Sprint-1 does NOT write `audit_log` rows — ingest has no admin surface that mints or revokes keys. The `audit_log` schema + dashboard-driven lifecycle is Sandesh/Sprint-2+. Sprint-1 only *reads* `ingest_keys.revoked_at` to fail auth post-revoke.
- **PRD §D20 signed-config validator** — Sprint-1 ships the verifier *library* (`packages/config/src/verifySignedConfig.ts` using `crypto.subtle.verify` with Ed25519), **not** the end-to-end admin flip flow. Tests prove verify+reject on tampered payloads, wrong key, expired window, replayed nonce.
- **Works-council compat (DE/FR/IT)** — Tier B default + forbidden-field fuzzer at 100% is the load-bearing Sprint-1 output that unblocks Sandesh's Workstream-I compliance templates.

---

## Stress Test Results

Failure modes × impact × mitigation × "designed in Sprint 1?":

| # | Failure | Impact | Mitigation | Sprint-1 covers? |
|---|---|---|---|---|
| 1 | Redis down | All `POST /v1/events` fail fast with 503 | `/readyz` fails closed; collector retries with egress-journal backoff (Workstream B side) | ✅ |
| 2 | Redis eviction flips to `allkeys-lru` silently | Dedup breaks 7d later → duplicate spend on live dashboard | `/readyz` preflight `CONFIG GET maxmemory-policy` | ✅ |
| 3 | ClickHouse unreachable | WAL consumer stalls; Bun keeps accepting writes into Redis Streams | Alert on consumer-lag > 1min; back-pressure kicks in when Redis memory hits 80% (rate-limit tighter) | ✅ (alert), Sprint-2 (back-pressure) |
| 4 | Bun ingest crash mid-batch | Zero events lost — WAL is durable; restart re-reads from consumer group offset | Redis Streams consumer group semantics | ✅ |
| 5 | JWT / ingest-key leaked | 60s LRU staleness post-revoke | `revoked_at` column + LRU bust on revoke (Sprint-2: Redis pub/sub for sub-second) | ✅ for 60s SLA; Sprint-2 for sub-second |
| 6 | Webhook replay (GitHub redelivery) | Double-ingest if dedup misses | Transport `SETNX` + row `UNIQUE(pr_node_id)` | ✅ |
| 7 | Reconciliation cron overlaps live webhook | Double-ingest | Row `UNIQUE(pr_node_id)` ON CONFLICT upsert | ✅ |
| 8 | HMAC secret leak (GitLab plaintext token) | Attacker can forge | Source-IP allowlist in `policies`; rotation on compromise; TLS-only endpoint | ✅ |
| 9 | Forbidden field from Tier A/B source (including nested in `raw_attrs`) | Tier-A leak; compliance violation; customer trust damage | Validator reject + CI fuzzer at 100%; single-source `FORBIDDEN_FIELDS` constant (12 entries); **recursive key-name scan, not top-level only**; nested fuzzer variants in Phase 2 test | ✅ |
| 10 | Tier-C event without opt-in | Managed-cloud Tier-C privacy boundary breach | 403 guard keyed on `policies.tier_c_managed_cloud_optin` | ✅ |
| 11 | Clock skew between signer and verifier on signed config | Legitimate flip rejected, or stale flip accepted | `±5min` tolerance on `notBefore/notAfter`; nonce table for replay | ✅ (lib only; E2E flow Sprint 2+) |
| 12 | OTLP large body DoS | Bun OOM | 128MB default `maxRequestBodySize`; tighten to 16MB for OTLP (spans batch rarely exceed) | ✅ |
| 13 | Bun < 1.3.4 silent keep-alive degradation | Soak fails mysteriously at Sprint-2 gate | `engines.bun: ">=1.3.4"` + CI version assertion | ✅ |
| 14 | Client sends zstd | No library path; silent accept-then-fail | 415 Unsupported Media Type on `Content-Encoding: zstd`; gzip allowed | ✅ |
| 15 | ingest `/v1/events` accepts a 1001-event batch mid-validation | Hit the 1000-limit before zod pass | Pre-validate count → 413 before zod work | ✅ (already in Sprint-0 server) |
| 16 | Admin bulk-revoke flood | LRU stampede invalidation | 60s staleness absorbs the flood; no action | ✅ |
| 17 | Postgres `policies` row missing for an org | Every event from that org rejects as Tier-C | Default row inserted on `orgs` create (trigger); ingest fails closed with 500 if row missing (flag misconfig) | ✅ |
| 18 | Reconciliation GraphQL rate-limit exhaustion | Daily cron fails silently | 5000 pts/hr budget ≫ 7000 PRs × ~1 pt; alert on `rateLimit.remaining < 500` mid-run | ✅ |
| 19 | Top-level-only forbidden-field scan misses `raw_attrs.prompt_text` | Tier-A leak via passthrough blob | Recursive scan in §F.1; nested-fuzzer variants in Phase 2 | ✅ |

### Security

- **TLS everywhere** — docker-compose dev uses HTTP; prod compose + self-host install docs enforce TLS on `:4318` and `:8000`. Out of Sprint-1 scope (Sebastian / Foundation).
- **Cert pinning** — out of Sprint-1 scope (collector-side, Workstream B, David).
- **`ulimit -c 0` + `RLIMIT_CORE=0`** — CLAUDE.md requirement. Added to `Dockerfile` entrypoint + `apps/ingest/src/index.ts` startup banner that prints the effective `RLIMIT_CORE`. Flagged in Phase 1.
- **Secrets hygiene** — `ingest_keys.key_sha256` never raw; webhook HMAC secrets stored in `policies.webhook_secrets` (jsonb encrypted-at-rest via pgcrypto; encryption handled by Jorge's secrets story). Sprint-1 reads them in-the-clear for now and flags "TODO: pgcrypto wrap (Jorge, Sprint 2)".
- **Pino redact config** forbidding `prompt_text`, `tool_input`, `tool_output`, `raw_attrs`, `Authorization` header. Every log line scrubbed.

### Cost analysis

Sprint 1 adds no external paid-tier services. Infrastructure cost delta is Redis RSS headroom (already 8GB planned). Dev-scale ClickHouse is local; managed CH starts Phase 2. GitHub API quota is comfortable for the reconciliation cron (~7k PRs × 1 pt/day ≪ 120k pts/day budget).

---

## Phased Plan (one PR, six sequential phases)

The branch `2-workstream-c-g-backend-ingest-server-side-privacy-sprint-1-fan-out-walid` carries six phased commits. One PR opens against `main` at M1 containing all six in order. Each phase is its own commit (or small commit cluster) with its own tests — the reviewer of the eventual PR walks them as a narrative. Every phase must pass CI (lint, typecheck, unit, Bun-version assert, forbidden-field fuzzer after Phase 2) before the next begins. If a phase needs a follow-up fix discovered during the next phase, that fix lands as a new commit (not an amend) on the branch; the single PR carries the full narrative.

**Cross-cutting concerns** (pino redact config, shutdown lifecycle, `/readyz` composite, flag coherence) are implemented incrementally inside Phases 1–4 rather than as a dedicated Phase 0. Each phase's final commit must pass a `scripts/checks/cross-cutting.ts` script that asserts the cross-cutting surface is in sync with the phase's newly added endpoints (e.g., after Phase 4, `/readyz` includes the WAL-lag check; after Phase 2, pino redact includes `FORBIDDEN_FIELDS`).

### Phase 1 — Real ingest-key auth + rate limit + Bun/CH pin bumps

**Goal:** replace the prefix-only stub with a real verifier, wire Redis token-bucket rate-limit, raise Bun and `@clickhouse/client` version floors.

**Depends on:** nothing (first in sequence). Produces `Assumption A5`, `A6` bumps.

**Size:** M.

**Innovations included:** none (tactical hardening).

**Requirements**

- [ ] Bump `engines.bun` to `">=1.3.4"` in root `package.json`.
- [ ] Bump `@clickhouse/client` to `^1.18.2` in `packages/schema/package.json`.
- [ ] CI workflow assertion `bun --version | awk '{split($0,a,".") …}'` fails if < 1.3.4.
- [ ] New file `apps/ingest/src/auth/verifyIngestKey.ts` implementing the verifier above.
- [ ] New file `apps/ingest/src/auth/rateLimit.ts` loading `token_bucket.lua`, `SCRIPT LOAD` at startup, exporting `consume(orgId, deviceId, cost=1) → {allowed, remaining, retryAfterMs}`.
- [ ] `apps/ingest/src/server.ts` — swap `verifyBearer` stub with the new verifier; add `consume()` call between auth and zod validate; 429 with `Retry-After` header on throttle.
- [ ] Delete the Sprint-0 stub body in `auth.ts`, keep file as a re-export for the new impl (preserves import paths in `server.test.ts`).
- [ ] Draft Drizzle migration `packages/schema/postgres/migrations/0001_sprint1_auth.sql` (marked `SPRINT1_DRAFT_NEEDS_JORGE_REVIEW`) creating `ingest_keys`.
- [ ] `apps/ingest/src/index.ts` — print `RLIMIT_CORE` effective value at boot; error-log if > 0.
- [ ] `contracts/02-ingest-api.md` additive changelog line clarifying Bearer ingest-key vs JWT.
- [ ] `apps/ingest/src/index.ts` — call `process.setrlimit?.('core', {soft: 0, hard: 0})` where supported; print startup banner with effective `RLIMIT_CORE`; error-log if > 0. Dockerfile wrapping (`ulimit -c 0` in entrypoint) is Sebastian/Foundation territory — open a follow-up commit tagging Sebastian if the ingest Dockerfile is owned there; do not block Phase 1.

**Tests (≥ 8):**

1. Valid Bearer → 202.
2. Malformed Bearer → 401.
3. Unknown `orgId` prefix → 401.
4. Correct key but `revoked_at` set → 401.
5. Correct key but wrong `key_sha256` → 401 (timing-safe path).
6. `timingSafeEqual` called on equal-length buffers only (mock `node:crypto` + assert).
7. LRU cache hit: second call within 60s doesn't re-query PG (spy on PG client).
8. Rate-limit allow: 100 requests at cost=1 succeed.
9. Rate-limit deny: 1001st request in 1s returns 429 with `Retry-After`.
10. `SCRIPT LOAD` runs once at boot; subsequent calls use `EVALSHA`.
11. `NOSCRIPT` retry: simulate Redis flush; `EVAL` fallback succeeds.
12. `engines.bun` check — test reads root `package.json` and asserts `>=1.3.4`.
13. `RLIMIT_CORE` startup banner emitted; `process.setrlimit?.('core', ...)` called on platforms that support it; log line contains `rlimit_core` key.

**Acceptance:**

- CI passes on Bun 1.3.4 + 1.3.5 (matrix); fails on Bun 1.3.3.
- New migration passes `drizzle-kit` validate.
- `contracts/02-ingest-api.md` Changelog has new line, diff reviewed.

### Phase 2 — Tier enforcement + forbidden-field fuzzer + RedactStage interface

**Goal:** land the tier boundary that makes ingest trustworthy. Ship the CI fuzzer. Scaffold the Sprint-2 redact hook.

**Depends on:** Phase 1 (auth context carries `tier`).

**Size:** M.

**Innovations:** I1 (single-source `FORBIDDEN_FIELDS`), I3 (`RedactStage` interface).

**Requirements**

- [ ] New file `packages/schema/src/invariants.ts` exporting `FORBIDDEN_FIELDS: readonly string[]` (matching contract 01 §Invariant 4).
- [ ] New file `packages/redact/src/tier_a_allowlist.ts` exporting `TIER_A_RAW_ATTRS_ALLOWLIST: ReadonlySet<string>` (matching contract 08).
- [ ] New file `apps/ingest/src/tier/enforceTier.ts` implementing the three sub-stages.
- [ ] New file `packages/redact/src/stage.ts` defining `RedactStage` interface + `noopRedactStage` default export.
- [ ] Draft migration `packages/schema/postgres/migrations/0002_sprint1_policies.sql` creating `policies` (marked SPRINT1_DRAFT) PLUS a PL/pgSQL trigger `orgs_insert_default_policy()` firing `AFTER INSERT ON orgs` that inserts a default `policies` row (`tier_c_managed_cloud_optin=false`, `tier_default='B'`).
- [ ] `contracts/01-event-wire.md` §Invariant #4 additive-changelog line adding `prompt` to the forbidden-field list (aligns contract-01 with contract-08 at 12 entries).
- [ ] `packages/schema/src/event.ts` header comment noting `redaction_count` is a raw counter, not a D13-versioned metric (D13 applies to displayed/derived metrics only).
- [ ] `apps/ingest/src/server.ts` — insert `enforceTier()` between auth and dedup; load `orgPolicy` via a 60s cache.
- [ ] New file `packages/schema/src/invariants.fuzz.test.ts` using `fast-check` — arbitrary-inject each `FORBIDDEN_FIELDS` entry into every schema slot at random depth, assert reject.
- [ ] Feature flag `ENFORCE_TIER_A_ALLOWLIST` (default off) gating sub-stage 3.
- [ ] `apps/ingest/src/logger.ts` — add `pino` redact config excluding the forbidden fields + `Authorization` header.

**Tests (≥ 10):**

1. Tier-B event with `prompt_text` field → 400 `{field: "prompt_text", code: "FORBIDDEN_FIELD"}`.
2. Tier-C event with `prompt_text` when `tier_c_managed_cloud_optin=true` → 202 (field allowed in Tier C).
3. Tier-C event when `tier_c_managed_cloud_optin=false` → 403 `{code: "TIER_C_NOT_OPTED_IN"}`.
4. Tier-A event with `raw_attrs.foo=1` and `ENFORCE_TIER_A_ALLOWLIST=1` → `foo` dropped, `redactor_count+=0` (no-op path in Sprint 1), counter log entry written.
5. Tier-A event with `raw_attrs.device.id=X` → allowed through (on the allowlist).
6. `noopRedactStage` passes input through unchanged.
7. `RedactStage` interface type-checks a mock impl.
8. Fuzzer: every (`FORBIDDEN_FIELDS × Tier-A|B source`) combination → reject. 100% over 1000 iterations.
9. Missing `policies` row → 500 with `{code: "ORG_POLICY_MISSING"}` and audit-log entry.
10. Pino redact: log a forbidden field value, assert it's `[Redacted]` in the emitted line.
11. `/readyz` verifies `enforceTier` loads and `FORBIDDEN_FIELDS` has exactly 12 entries matching `contracts/08-redaction.md` §Forbidden-field rejection.
12. Contract-parity test: `FORBIDDEN_FIELDS` exported from `@bematist/schema` equals the regex-extracted list from `contracts/01-event-wire.md` §Invariant #4 (after Phase 2 contract-01 changelog).
13. Nested forbidden-field reject: Tier-B event `{raw_attrs: {prompt_text: "secret"}}` → 400 `FORBIDDEN_FIELD` (recursive scan).
14. Non-forbidden nesting allowed: Tier-A event `{raw_attrs: {device: {ip: "1.2.3.4"}}}` passes tier reject (allowlist drop happens later at §F.1).
15. Ordering proof: payload with `prompt_text` AND zod-invalid extra fields returns 400 `FORBIDDEN_FIELD` — NOT a zod error (proves pre-zod ordering).
16. `policies` trigger: insert a new `orgs` row; assert matching `policies` row exists with defaults (`tier_c_managed_cloud_optin=false`, `tier_default='B'`).

**Acceptance:**

- Fuzzer 100% reject rate across 1000 iterations per (field × source), **including nested-in-`raw_attrs` variants**.
- `FORBIDDEN_FIELDS` constant diffs exactly the contract-08 list (12 entries); contract-01 changelog line lands in the same Phase-2 commit cluster.
- `pino` redact log test passes under `LOG_LEVEL=debug`.
- `ENFORCE_TIER_A_ALLOWLIST=1` test path doesn't break Sprint-1 no-op (feature-flag off by default).
- `orgs` insert trigger fires and produces matching `policies` row.

### Phase 3 — Redis SETNX dedup (Bun.redis primary path)

**Goal:** authoritative idempotency.

**Depends on:** Phase 2 (tier enforcement runs first — don't waste a SETNX slot on a 400-reject event).

**Size:** M.

**Innovations:** none (tactical).

**Requirements**

- [ ] New file `apps/ingest/src/dedup/checkDedup.ts` — `Bun.redis.set(key, "1", "NX", "PX", 604_800_000)`.
- [ ] Key format `dedup:{${tenantId}}:${sessionId}:${eventSeq}` — braces mandatory (hash tag).
- [ ] Integration into `server.ts` `handleEvents`: per-event dedup check; duplicates contribute to `deduped` response count, do not abort the batch.
- [ ] `/readyz` preflight: `Bun.redis.send("CONFIG", ["GET", "maxmemory-policy"])` returns `"noeviction"`.

**Tests (≥ 6):**

1. First-sight event → SETNX returns `"OK"`, event accepted, `deduped=0` in response.
2. Duplicate same `(tenant, session, seq)` → SETNX returns `null`, `deduped=1`.
3. Partial batch: 3 new + 2 dup → response `{accepted: 5, deduped: 2}` (accepted counts the new only; dedup is tracked separately; matches contract 02 §response codes).
4. Hash-tag key format asserted: `/^dedup:\{[^}]+\}:[^:]+:\d+$/`.
5. Key TTL set to ~7d (PTTL asserted within ±1s).
6. `/readyz` fails with `reason: "redis-eviction-policy"` when `maxmemory-policy=allkeys-lru`.
7. Dedup does not run for Tier-A-rejected events (asserted via call-order spy).
8. Redis unavailable → server returns 503, no dedup run.

**Acceptance:**

- Contract 02 §Response codes matched exactly for dedup accounting.
- `/readyz` under `maxmemory-policy=allkeys-lru` fails closed.

### Phase 4 — ClickHouse write path via Redis Streams WAL + consumer

**Goal:** durable write path, crash-safe.

**Depends on:** Phase 3 (only non-duplicate events enter the WAL).

**Size:** L.

**Innovations:** I2 (Redis Streams WAL).

**Requirements**

- [ ] New file `apps/ingest/src/wal/append.ts` — `XADD events_wal * tenant_id=... json=<canonical>`.
- [ ] New file `apps/ingest/src/wal/consumer.ts` — `XGROUP CREATE events_wal ingest-consumer $ MKSTREAM` (idempotent); loop: `XREADGROUP GROUP ingest-consumer c1 COUNT 1000 BLOCK 500 STREAMS events_wal >`; call `@clickhouse/client.insert` with `JSONEachRow`; `XACK` on HTTP 200; retry 5× with exponential backoff; on repeated failure `XCLAIM` to `events_wal_dead`.
- [ ] `apps/ingest/src/clickhouse.ts` — `createClient({ keep_alive: { idle_socket_ttl: 2000 }, compression: { request: true, response: true }, max_open_connections: 10, request_timeout: 30000, database: 'bematist' })`.
- [ ] WAL consumer bootstrapped in `apps/ingest/src/index.ts` after HTTP server start; graceful shutdown on SIGTERM drains pending `XREADGROUP` + acks.
- [ ] `/readyz` adds CH `/ping` + WAL consumer lag metric (`XLEN - XINFO GROUPS pel-count`).
- [ ] Feature flag `WAL_CONSUMER_ENABLED=1` (default on; tests run with it off and assert WAL-append-only behaviour).
- [ ] `apps/ingest-sidecar/` — skeleton Go module with `go.mod`, `main.go` containing a 30-line Redis Streams reader → no-op logger. Not compiled into `docker-compose`. Commit with label `PLAN_B_SKELETON` in commit message body (Jorge to consume in Sprint 2).
- [ ] `contracts/02-ingest-api.md` §Invariants #1 additive-changelog line clarifying "writer" means "ingest boundary" and the Plan-B side-car is within it.
- [ ] Flag coherence enforcer in `apps/ingest/src/flags.ts` — validates at boot; `OTLP_RECEIVER_ENABLED=1 && WAL_CONSUMER_ENABLED=0` → exit 2.

**Tests (≥ 10):**

1. `XADD` produces a message with expected fields.
2. Consumer `XREADGROUP` receives appended message.
3. CH insert called with `{ table: 'events', values: [row], format: 'JSONEachRow' }`.
4. `XACK` runs on CH 200.
5. CH 500 → no `XACK`, message re-delivered on next poll.
6. 5 consecutive failures → `XCLAIM` to dead-letter group.
7. Graceful shutdown: in-flight batch flushes, ack, consumer exits.
8. Batch flush on `maxRows=1000` (test with `maxRows=3`).
9. Batch flush on `maxAgeMs=500` (fake-timer test with `maxAgeMs=50`).
10. WAL append but consumer disabled → CH never called, events sit in stream.
11. Stream restart after crash: consumer resumes from last-acked offset.
12. CH `keep_alive.idle_socket_ttl` set to 2000 asserted in client config.
13. `Bun.version` assertion: test prints `Bun.version` >= 1.3.4 (belt-and-suspenders with CI env check).
14. `SIGTERM` drains WAL consumer AND closes `@redis/client` gracefully; ingest exit code = 0 within 5s.
15. Flag coherence: boot with `OTLP_RECEIVER_ENABLED=1 WAL_CONSUMER_ENABLED=0` → process exits with code 2 within 500ms and emits `{code: 'FLAG_INCOHERENT'}` log.

**Acceptance:**

- Consumer processes 1000 events end-to-end in a single-process integration test.
- Graceful shutdown loses zero events.
- Plan-B skeleton commit exists (stub directory committed on this branch).
- Dev-scale smoke: `curl POST /v1/events` with 10 events → row count in `bematist.events` = 10.

### Phase 5 — OTLP HTTP/Protobuf + JSON receiver on :4318

**Goal:** accept OTel-native traffic.

**Depends on:** Phase 4 (receiver funnels into the same WAL).

**Size:** L.

**Innovations:** none.

**Requirements**

- [ ] `packages/otel/vendor/opentelemetry-proto/` — git submodule or vendored-copy of https://github.com/open-telemetry/opentelemetry-proto.
- [ ] `packages/otel/buf.gen.yaml` — buf codegen config producing `@bufbuild/protobuf` TS output.
- [ ] CI workflow step `buf generate` run before unit tests; generated files committed to repo (not regenerated at build; avoids `protoc` in runtime path).
- [ ] New files `packages/otel/src/gen/**` (generated TS).
- [ ] New file `packages/otel/src/map.ts` — `mapOtlpTraces(req: ExportTraceServiceRequest, auth): Event[]`, same for metrics + logs.
- [ ] New file `apps/ingest/src/otlp/server.ts` — `Bun.serve({ port: 4318, fetch: otlpHandler })`; handlers for `/v1/traces`, `/v1/metrics`, `/v1/logs`; content-type dispatch.
- [ ] Proto3-JSON decoder: `mapProto3JsonToSpans` honours hex traceId/spanId + lowerCamelCase.
- [ ] `Content-Encoding: gzip` via Bun `DecompressionStream`; `zstd` → 415.
- [ ] `maxRequestBodySize: 16 * 1024 * 1024` on OTLP `Bun.serve`.
- [ ] OTLP responses per spec: 200 with `ExportTraceServiceResponse { partial_success }` — Sprint 1 returns empty partial-success (no retryable rejections until Sprint 2 redact).
- [ ] `apps/ingest/src/index.ts` starts both servers (`:8000` and `:4318`) with shared auth + WAL.
- [ ] Feature flag `OTLP_RECEIVER_ENABLED` default on.
- [ ] docker-compose.dev.yml — default profile omits `otel-collector` sidecar; comment explains port collision.

**Tests (≥ 10):**

1. Protobuf `ExportTraceServiceRequest` with 1 span → 1 Event row in CH.
2. JSON `ExportTraceServiceRequest` same payload → identical Event row.
3. Unknown content-type → 415.
4. zstd encoding → 415.
5. Oversized body (>16MB) → 413.
6. Hex `traceId` / `spanId` passed through correctly (not base64-decoded).
7. `gen_ai.system = "anthropic"` resource attribute maps to `gen_ai_system` column.
8. `service.namespace` from OTel resource is NOT trusted for tenant identity (auth-derived wins).
9. `DecompressionStream` gzip decode round-trip.
10. OTLP response shape matches OTel spec.
11. `port 4318` collision with docker-compose sidecar: doc-test inspects compose file for `profiles:[otel-collector]` presence on the sidecar.
12. Missing bearer → 401 on OTLP path too (auth shared).
13. Rate-limit applies to OTLP path (100 evt at cost=1 ok; 1001st throttles).

**Acceptance:**

- `buf generate` runs in CI and generated files are up-to-date (CI fails if submodule SHA changed but `src/gen/` didn't).
- OTel Collector conformance fixture for traces: Claude Code exported trace → decoded → CH row matches expected shape.

### Phase 6 — Webhooks (GitHub/GitLab/Bitbucket) + GitHub App + reconciliation cron

**Goal:** VCS events flow in.

**Depends on:** Phase 4 (uses the auth + rate-limit scaffolding; writes to Postgres `git_events`, not WAL).

**Size:** L.

**Innovations:** I4 (row-level `UNIQUE(pr_node_id)`).

**Requirements**

- [ ] New directory `apps/ingest/src/webhooks/` with `verify.ts`, `github.ts`, `gitlab.ts`, `bitbucket.ts`.
- [ ] HMAC verifiers with length guard + `timingSafeEqual`.
- [ ] GitLab verifier adds source-IP check against `policies.webhook_source_ip_allowlist`.
- [ ] Raw-body preservation in `apps/ingest/src/server.ts`: capture `arrayBuffer()` BEFORE JSON parse for webhook paths.
- [ ] `POST /v1/webhooks/{github,gitlab,bitbucket}` handlers: verify → transport SETNX dedup → parse → `INSERT INTO git_events ON CONFLICT (pr_node_id) DO UPDATE`.
- [ ] Draft migration `packages/schema/postgres/migrations/0003_sprint1_git_events.sql` creating `git_events` (marked SPRINT1_DRAFT).
- [ ] New directory `apps/ingest/src/github-app/` — `app.ts` (`@octokit/auth-app` setup), `reconcile.ts` (GraphQL search with day-partitioned pagination).
- [ ] Cron mechanism: Sprint-1 uses a simple in-process `setInterval` with jitter, flagged `TODO: move to PgBoss cron (Jorge, Sprint-2)`. Daily at 03:00 UTC with ±5min jitter.
- [ ] GitHub App name: `bematist-github`. README doc updated to reflect.
- [ ] `.env.example` additions: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`.

**Tests (≥ 12):**

1. Valid GitHub `pull_request.closed` → HMAC verified → row in `git_events`.
2. Wrong HMAC → 401.
3. HMAC length mismatch (attacker sends 100-byte header) → 401 without throwing.
4. Raw body preserved: whitespace-reformatted body fails HMAC.
5. GitLab plaintext token match + source-IP in allowlist → accept.
6. GitLab plaintext token match + source-IP NOT in allowlist → 401.
7. Bitbucket `X-Hub-Signature` (note: no `-256`) HMAC-SHA256 verify.
8. Transport dedup: same `X-GitHub-Delivery` twice → second returns 200, no second row write.
9. Row-level collision: reconciliation cron synthetic key arrives after webhook with same `pr_node_id` → `ON CONFLICT` upsert, single row.
10. GraphQL reconciliation: mocked response pagination yields 3 pages, 250 PRs parsed, inserted.
11. GraphQL 1000-cap: date-partitioned query hits ceiling → warning logged, next day partitions.
12. Cron runs at ~03:00 UTC (fake-timer test).
13. `@octokit/auth-app` mints installation token; cached; reused on subsequent requests.
14. Unknown event type from GitHub → logged + stored in `git_events.payload` jsonb, row `pr_node_id` NULL (for push events).
15. `enforceTier` is NEVER invoked on `/v1/webhooks/*` handlers: call-order spy asserts zero calls across all three webhook sources (webhooks carry no `tier` field; they flow through the short pipeline defined in §Architecture).

**Acceptance:**

- Integration test: simulate GitHub delivery → webhook accepted → GraphQL cron overlaps → single `git_events` row.
- Plan-B sidecar skeleton commit referenced.
- `bematist-github` App named; `devmetrics-github` appears nowhere in code (only in a `contracts/02-ingest-api.md` changelog noting the rename).

---

## Phase Dependency Map

```
       Phase 1 — auth + rate limit + Bun/CH pins
              │  (auth context carries tier)
              ▼
       Phase 2 — tier enforcement + fuzzer + RedactStage
              │  (only non-rejected events enter dedup)
              ▼
       Phase 3 — Redis SETNX dedup
              │  (only first-sight events enter WAL)
              ▼
       Phase 4 — CH write path via Redis Streams WAL + Plan-B skeleton
              │  (shared WAL serves /v1/events AND /v1/{traces,metrics,logs})
              ├─────────────────────────────┐
              ▼                             ▼
       Phase 5 — OTLP receiver        Phase 6 — Webhooks + GitHub App
                                       (writes to PG git_events, not WAL)
              \                             /
               ──────────── M1 ─────────────
              single PR opens against main; six commits walk the narrative
```

Phase 5 and Phase 6 are independent after Phase 4; review-order them whichever way reads best. They still land on the branch sequentially (no parallel commits on a single branch).

---

## MVP Validation Checklist

Every brief requirement → Phase → tests. If any row is missing its phase, that's a gap and must be patched before execution.

| Brief requirement | Phase | Tests | Acceptance |
|---|---|---|---|
| Real JWT + `ingest_keys` lookup replacing prefix-only Bearer stub | Phase 1 | Phase 1 tests 1–8 | Stub deleted; LRU + timing-safe equality verified |
| Redis token-bucket rate limit 1000 evt/sec/org default | Phase 1 | Phase 1 tests 9–11 | 1001st req/s returns 429; Lua script loaded once |
| Tier-C 403 guard gated on `org.tier_c_managed_cloud_optin` | Phase 2 | Phase 2 tests 2–3 | 403 when opt-in false; 202 when true |
| Forbidden-field fuzzer 100% rejection CI gate (11 fields × Tier A/B) | Phase 2 | Phase 2 test 8 (`fast-check` property) | `test:fuzzer` script fails CI on any leak |
| Tier-A `raw_attrs` allowlist at write-time | Phase 2 | Phase 2 tests 4–5 | Feature flag lands; no-op in Sprint 1, plugged in Sprint 2 |
| Redis SETNX dedup keyed on `(tenant_id, session_id, event_seq)` 7-d TTL | Phase 3 | Phase 3 tests 1–5 | `deduped` counter accurate; hash-tag braces present |
| ClickHouse write path via `@clickhouse/client` HTTP batch insert | Phase 4 | Phase 4 tests 1–9 | Consumer inserts batches of 1k/500ms; zero data loss on crash |
| F15/INT0 24h 100 evt/sec soak Plan B coord | Phase 4 | Phase 4 test 13 | `apps/ingest-sidecar/` skeleton committed; Jorge tagged |
| OTLP HTTP/Protobuf receiver :4318 mapping contract 01 | Phase 5 | Phase 5 tests 1–11 | Protobuf + JSON both decode; hex IDs; gzip supported |
| Webhooks `{github,gitlab,bitbucket}` HMAC validated | Phase 6 | Phase 6 tests 1–7 | Length-guarded timing-safe; raw body preserved |
| GitHub App with reconciliation cron | Phase 6 | Phase 6 tests 10–13 | GraphQL `search` paginates; `pr_node_id UNIQUE` absorbs overlap |

---

## Rollback strategy

Single PR at M1 means the granularity of a post-merge revert is "the whole PR". Within the branch (before M1), `git revert <phase-N-commit>` is a clean option because commits are sequential and additive.

- **Pre-M1 (branch-internal):** if Phase N bug is found during Phase N+1 or N+2, revert Phase N on the branch, re-land a fixed Phase N', continue the chain.
- **Post-M1 (after single PR merged to `main`):** revert the whole merge commit; open a fix branch; re-land corrected phases in a new PR. Do NOT cherry-pick individual phase reverts from `main` — the phases share imports (Phase 3 imports `FORBIDDEN_FIELDS` from Phase 2; Phase 5/6 import the WAL module from Phase 4). Partial reverts will compile-fail.
- **Runtime-only mitigation:** most post-M1 bugs can be turned off without reverting code via feature flags:
  - `WAL_CONSUMER_ENABLED=0` stops CH writes; events queue in Redis Streams until the fix lands.
  - `OTLP_RECEIVER_ENABLED=0` closes `:4318` (collector falls back to `/v1/events`).
  - `WEBHOOKS_ENABLED=0` returns 503 on webhook paths (GitHub retries with backoff; reconciliation cron catches up).
  - `ENFORCE_TIER_A_ALLOWLIST=0` is Sprint-1 default (no behavioural change).
- **`git_events` drift:** if Jorge's review renames a column after Phase 6 lands, follow-up commit on the branch rebases both the migration and the upsert SQL; the single PR absorbs it.

## Risks & Non-Goals

### Risks

| Rank | Risk | Mitigation | Fallback |
|---|---|---|---|
| 1 | Jorge hasn't ratified `ingest_keys`/`policies`/`git_events` draft migrations before Phase 1 commits land | Draft migrations marked `SPRINT1_DRAFT`; Jorge reviews in a dedicated check-in; additive changelog on each phase commit | If Jorge's review renames columns, follow-up commit on this branch rebasing the migrations (S); the single PR absorbs the fix-ups as subsequent commits |
| 2 | Bun 1.3.4 has a regression that breaks `bun test` on our CI matrix | Pin to a specific patch (e.g. 1.3.4, not `>=1.3.4`); matrix-test 1.3.4 + 1.3.5 | Pin to 1.3.4 only; defer 1.3.5 until bug is confirmed fixed upstream |
| 3 | `@bufbuild/protobuf` decodes a real Claude-Code OTLP export incorrectly (proto3-JSON quirk) | Phase 5 test against captured Claude-Code export fixture | Fall back to `@opentelemetry/otlp-transformer` pre-generated artifacts; Phase 5 ships an adapter |
| 4 | Redis Streams WAL adds complexity; WAL consumer bug loses events during graceful shutdown | Phase 4 test 7 (graceful shutdown drains); integration test with signal injection | If WAL proves flaky in dev, fall back to direct client-side batching with a local JSONL buffer file; add Plan-C to Sprint-2 gate |
| 5 | Reconciliation GraphQL search 1000-result ceiling trips on large customer (10k+ PRs/week) | Day-partitioned search; warning at 80% of ceiling | Sprint 2 switches to per-repo listing (`node.repository.pullRequests(merged)`) |
| 6 | `maxmemory-policy` drift in prod Redis | Readyz preflight fails the pod | Auto-remediation: `CONFIG SET maxmemory-policy noeviction` on startup if operator-allowed (out-of-scope for Sprint 1) |
| 7 | Forbidden-field constant list drifts between contract 01, contract 08, and `packages/schema/invariants.ts` | Single-source constant; CI parity tests regex-extract both contracts and compare; Phase 2 lands contract-01 changelog line adding `prompt` | Contract change requires matching PR |
| 8 | ClickHouse schema drift (additive column) while WAL has in-flight messages | Consumer inserts rows missing the new column; CH silently defaults them | Sprint-1 policy: `ALTER TABLE` is additive-only on the `events` table during this sprint (no drops, no renames); consumer stamps `schema_version` into each batch via Event wire field; alert on `schema_version != current_schema_version`. Jorge owns the ALTER; Walid owns the schema_version stamp. | Sprint-2 adds a proper schema-version fence in the consumer that refuses mismatched batches. |

### Non-goals (explicit, inherited from PRD §2.3)

- Server-side redaction execution (Sprint 2, deliverable 7 in issue).
- Ed25519 signed-config admin flip end-to-end flow (Sprint 2+, deliverable 8 in issue; Sprint 1 ships the verifier library only).
- Privacy adversarial gate INT10 pass (Sprint 2 MERGE BLOCKER, deliverable 9 in issue).
- Better Auth session for dashboard (Sandesh / Workstream E).
- GDPR erasure worker (Jorge / Workstream D).
- TLS / cert pinning / SLSA release signing (Sebastian / Workstream F).
- Collector-side adapter emission (David / Workstream B) — Sprint 1 ingest is tested against zod fixtures, not live collectors.
- Perf gates p95 < 2s, p99 < 100ms (M2 blocker, not M1).
- Frontend work of any kind.

---

## Appendix: Decision Log

| ID | Decision | One-line rationale |
|---|---|---|
| D-S1-1 | Ingest-key auth is NOT Better Auth; it's `timingSafeEqual` + Postgres `ingest_keys` + 60s LRU | R4: Better Auth API-key plugin not designed for 1000 evt/s hot paths; DB lookup per request with LRU is p99<100ms-compatible |
| D-S1-2 | Amend `contracts/02-ingest-api.md` §Auth to split ingest-key path from JWT path | Resolves PRD Arch Rule #8 ambiguity; JWT applies to dashboard + Phase-4 B2B only |
| D-S1-3 | Two Redis clients per ingest replica: `Bun.redis` (SETNX) + `@redis/client` (Lua EVALSHA) | R3: Bun.redis is 7.9× faster but blocks EVALSHA + Cluster; hybrid is the pragmatic path |
| D-S1-4 | Dedup key `dedup:{tenant}:{session}:{seq}` with hash-tag braces | R3: Cluster-safe co-location without rekeying later |
| D-S1-5 | Lua token bucket uses `redis.call('TIME')` inside script | R3: single clock source; replica-safe; cap+refill in one atomic EVALSHA |
| D-S1-6 | Redis `maxmemory-policy noeviction` MANDATORY | R3: eviction of a dedup key = duplicate spend on live dashboard; readyz preflight gates |
| D-S1-7 | CH write path via Redis Streams WAL, not in-memory batch | R2: Bun crash otherwise loses batch; PostHog/Tinybird both use durable buffer |
| D-S1-8 | Client-side batching (1k/500ms), NOT CH `async_insert=1` | R2: we control one ingest process; server-async-insert is for uncoordinated swarms |
| D-S1-9 | Bun ≥ 1.3.4 pinned + CI asserted | R2: three keep-alive bugs fixed in 1.3.4; earlier silent degradation breaks soak |
| D-S1-10 | `@clickhouse/client` ≥ 1.18.2 pinned | R2: explicit warning on ttl mismatch; earlier eats ECONNRESET silently |
| D-S1-11 | `keep_alive.idle_socket_ttl = 2000` (server default 3000 − 1s) | R2 + clickhouse-js#150 |
| D-S1-12 | OTLP decode via `@bufbuild/protobuf` + vendored `opentelemetry-proto` + `buf generate` CI | R1: Bun-supported, static codegen, native BigInt, no runtime `.proto` load |
| D-S1-13 | Accept both `application/x-protobuf` and `application/json` on OTLP | R1: Claude Code + Collector default to protobuf; JSON-only is a non-starter |
| D-S1-14 | OTLP on `:4318` inside Bun ingest, NOT docker-compose sidecar by default | A7: avoid port collision; sidecar remains opt-in via `--profile otel-collector` |
| D-S1-15 | Webhook HMAC verifiers hand-rolled (~40 lines each); skip `@octokit/webhooks` dispatcher | R5: Bun `KeyObject` edge issues + `@octokit/webhooks` Bun-compat not maintained |
| D-S1-16 | `@octokit/auth-app` for App-JWT + token cache only | R5: that part works on Bun; token-cache is the sole ergonomic win |
| D-S1-17 | Two-layer webhook dedup: transport `SETNX` on `delivery_id` + row `UNIQUE(pr_node_id)` | R5: single-layer dedup breaks under reconciliation × webhook overlap |
| D-S1-18 | Reconciliation via GraphQL `search` (not REST), day-partitioned if >1000 results | R5: 10× cheaper; 5000 pts/hr budget comfortable |
| D-S1-19 | GitHub App named `bematist-github`, not legacy `devmetrics-github` | R5 + A8: rename safe; GitHub pivoting to `client_id` for stable identity |
| D-S1-20 | Ed25519 via Bun `crypto.subtle.verify({ name: "Ed25519" })`; `@noble/ed25519` 3.1.0 fallback | R4: Bun native WebCrypto supports Ed25519; no dep needed on hot path |
| D-S1-21 | Signed-config replay defense via `signed_config_nonces` PG table | R4: NTP clock skew untrustworthy; nonce + `notBefore/notAfter` + ±5min tolerance is contract |
| D-S1-22 | All Sprint-1 DB schema is `SPRINT1_DRAFT_NEEDS_JORGE_REVIEW` | A2: Walid cannot wait on Jorge; coord via contract changelog |
| D-S1-23 | One PR; six phased commits on feature branch; single PR opens against `main` at M1 | A9: user explicit — "we can do 6 phases" but "I want 1 PR" |
| D-S1-24 | `apps/ingest-sidecar/` Plan-B skeleton committed during Phase 4 | Preserve Sprint-2 swap optionality; avoid discovering Plan B in Sprint 5 |
| D-S1-25 | Single-source `FORBIDDEN_FIELDS` in `packages/schema/src/invariants.ts`; contract-01 list asserted by test | Red flag #5: drift risk is a Tier-A leak |
| D-S1-26 | `RedactStage` interface + `noopRedactStage` in Sprint 1 | I3: Sprint-2 plugs in TruffleHog/Gitleaks/Presidio as additive impl; hot path shape frozen now |
| D-S1-27 | Feature flag `ENFORCE_TIER_A_ALLOWLIST` defaults off in Sprint 1 (no-op stage) | Preserve contract 08 §allowlist semantic ownership without gating Sprint-1 on Sprint-2 |
| D-S1-28 | Plan-B trip thresholds: `ECONNRESET > 0.1%`, p99 insert > 500ms for 30min, RSS +50MB/h | R2: concrete, measurable; surfaced in Sprint-2 soak doc |
| D-S1-29 | Forbidden-field reject uses **recursive key-name scan** of the raw JSON (including nested `raw_attrs`), NOT top-level-only. Runs pre-zod. | Loop-5 Challenger patch #14 (BLOCKER): top-level-only scan misses `raw_attrs.prompt_text` → Tier-A leak. |
| D-S1-30 | `FORBIDDEN_FIELDS` is **12 entries** (contract-08 superset including `prompt`); Phase 2 lands additive changelog on contract-01 §Invariant #4 to align. | Loop-5 Challenger patch #3 (BLOCKER): contract-01 (11) vs contract-08 (12) drift. |
| D-S1-31 | `enforceTier` runs **before** zod; pipeline diagram corrected. Tier-A `raw_attrs` allowlist runs post-zod. | Loop-5 Challenger patch #7 (BLOCKER): pipeline-diagram / §F contradiction; pre-zod is correct. |
| D-S1-32 | Webhooks do NOT run `enforceTier`; separate short pipeline documented. Phase 6 test asserts `enforceTier` call count = 0 on webhook paths. | Loop-5 Challenger patch #2 (HIGH): webhooks have no `tier` field. |
| D-S1-33 | `audit_log` is NOT written by Sprint-1 ingest. Schema + lifecycle owned by Sandesh/dashboard, Sprint-2+. Sprint-1 only reads `ingest_keys.revoked_at`. | Loop-5 Challenger patch #1 (HIGH): prior PRD claimed writes without schema ownership. |
| D-S1-34 | `OTLP_RECEIVER_ENABLED=1` requires `WAL_CONSUMER_ENABLED=1`; incoherent flag combo → exit 2 at boot. | Loop-5 Challenger patch #8 (HIGH): Redis fill-up failure mode. |
| D-S1-35 | `/readyz` composite contract locked: 7 checks (PG, CH, Bun.redis, eviction policy, FORBIDDEN_FIELDS length, Lua SHA, WAL lag). | Loop-5 Challenger patch #6 (MED): cross-phase `/readyz` story now defined. |
| D-S1-36 | Single-PR rollback strategy: pre-M1 = revert-on-branch; post-M1 = revert whole merge + feature flags as runtime mitigation; never partial-phase revert post-M1 (phases share imports). | Loop-5 Challenger patch #12 (MED): missing rollback story. |
| D-S1-37 | CH `events` table `ALTER` is additive-only during Sprint 1; consumer stamps `schema_version`; Sprint-2 adds a consumer-side fence. | Loop-5 Challenger patch #11 (MED): schema-drift mid-WAL. |
