# 09 — Storage schema (ClickHouse + Postgres)

**Status:** draft
**Owners:** Workstream D (storage & schema)
**Consumers:** C (writes), E (reads), H (reads aggregates), G (writes redaction side log), I (reads audit_log/audit_events)
**Last touched:** 2026-04-16

## Purpose

Two databases, two roles. ClickHouse for events (append-only, columnar, partitioned, TTL-managed). Postgres for control plane (orgs, users, RLS-enforced).

This contract pins the cross-workstream tables and projections. Internal indexing decisions stay inside Workstream D unless they break a downstream query path.

## ClickHouse — events store

### Primary table — `events`

```sql
-- packages/schema/clickhouse/0001_events.sql (draft per PRD §5.3)
CREATE TABLE events (
  -- Identity & dedup
  client_event_id      UUID,
  schema_version       UInt8,
  ts                   DateTime64(3, 'UTC'),

  -- Tenant / actor (server-derived; see 01-event-wire.md)
  org_id               LowCardinality(String),
  engineer_id          String,                       -- = stable_hash(SSO_subject)
  device_id            String,

  -- Source
  source               LowCardinality(String),       -- 'claude-code', 'cursor', etc.
  source_version       LowCardinality(String),
  fidelity             Enum8('full'=1, 'estimated'=2, 'aggregate-only'=3, 'post-migration'=4),
  cost_estimated       UInt8,

  -- Tier
  tier                 Enum8('A'=1, 'B'=2, 'C'=3),

  -- Session / sequencing
  session_id           String,                        -- hashed when tier='A'
  event_seq            UInt32,
  parent_session_id    Nullable(String),

  -- OTel gen_ai.*
  gen_ai_system        LowCardinality(String),
  gen_ai_request_model LowCardinality(String),
  gen_ai_response_model LowCardinality(String),
  input_tokens         UInt32,
  output_tokens        UInt32,
  cache_read_input_tokens   UInt32,
  cache_creation_input_tokens UInt32,

  -- dev_metrics.*
  event_kind           LowCardinality(String),
  cost_usd             Float64,
  pricing_version      LowCardinality(String),
  duration_ms          UInt32,
  tool_name            LowCardinality(String),
  tool_status          LowCardinality(String),
  hunk_sha256          Nullable(String),
  file_path_hash       Nullable(String),
  edit_decision        LowCardinality(String),
  revert_within_24h    Nullable(UInt8),
  first_try_failure    Nullable(UInt8),

  -- Tier-C content (server-redacted before insert)
  prompt_text          Nullable(String),
  tool_input           Nullable(String),
  tool_output          Nullable(String),

  -- Clio output for Tier B+
  prompt_abstract      Nullable(String),
  prompt_embedding     Array(Float32),
  prompt_index         UInt32,

  -- Redaction
  redaction_count      UInt32,

  -- Outcome attribution joins
  pr_number            Nullable(UInt32),
  commit_sha           Nullable(String),
  branch               LowCardinality(Nullable(String)),

  -- Catch-all for unknown attributes (D16)
  raw_attrs            String                          -- JSON blob
)
ENGINE = ReplacingMergeTree(ts)
PARTITION BY (toYYYYMM(ts), cityHash64(org_id) % 16)
ORDER BY (org_id, ts, engineer_id)
SETTINGS index_granularity = 8192;
```

Why `ORDER BY (org_id, ts, engineer_id)`: matches 3 of 4 headline queries (org-scoped time-range scans + engineer drill-down).

Why `PARTITION BY (toYYYYMM(ts), cityHash64(org_id) % 16)`: tenant isolation — `DROP PARTITION WHERE cityHash64(org_id) % 16 = X AND toYYYYMM(ts) = Y` for GDPR erasure (D15).

Why `ReplacingMergeTree(ts)` (not `(client_event_id)`): ClickHouse 25+ rejects UUID as the version column for ReplacingMergeTree — the version col must be an integer, Date, DateTime, or DateTime64. `ts` is DateTime64(3,'UTC') and preserves "keep latest by ORDER BY key" semantics. Discovered at Sprint-0 M0 (2026-04-16); see Changelog.

`ReplacingMergeTree(ts)` is a safety net only. **Authoritative idempotency is Redis SETNX at ingest** (D14) — async ReplacingMergeTree replacement leaks duplicate spend into live dashboards if relied upon.

### Projections (additive — don't change ORDER BY)

```sql
ALTER TABLE events ADD PROJECTION repo_lookup (
  SELECT *
  ORDER BY (org_id, repo_id_hash, ts)
);

ALTER TABLE events ADD PROJECTION cluster_lookup (
  SELECT *
  ORDER BY (org_id, cluster_id, ts)
);
```

### Materialized views

| MV name | Aggregates | Read use case |
|---|---|---|
| `dev_daily_rollup` | per (org, engineer, day) — token totals, cost, accepted edits, sessions | Per-engineer dashboards, scoring inputs |
| `team_weekly_rollup` | per (org, team, week) — same fields summed | Team 2×2, weekly digest |
| `prompt_cluster_stats` | per (org, cluster_id, week) — counts, contributing engineers, avg cost | Cluster pages |
| `repo_weekly_rollup` | per (org, repo_id_hash, week) | Repo pages, outcome attribution |
| `cluster_assignment_mv` | per (org, session_id, prompt_index) → cluster_id | Twin Finder, playbook adoption |

**Read paths use MVs, not raw `events`, where possible.** New queries always run `EXPLAIN` and verify projection use.

### Side tables

| Table | Purpose | Retention |
|---|---|---|
| `events_raw` | Full event JSON for debugging when `schema_version` is unknown (D16) | 30d |
| `redaction_audit` | Per-event redaction `markers[]` from `08-redaction.md` | 30d, separate from main events |
| `egress_journal_mirror` | Server-side mirror of collector egress journals (Bill of Rights #1) | tier-aligned |

### Retention (CRITICAL — D7 + challenger C1)

- **Tier A (90d):** partition drop worker (D7). **NEVER TTL.** TTL is a leak vector for Tier A.
- **Tier B (90d):** TTL is fine.
- **Tier C (30d):** TTL is fine.
- **Aggregates (MVs):** retained indefinitely with `HMAC(engineer_id, tenant_salt)` pseudonymization (GDPR Art. 17(3)(e) carve-out).

Partition-drop worker runs daily. **Erasure SLA: 7 days** (`bematist erase --user --org` triggers immediate drop, audit-logged).

## Postgres — control plane

### RLS rule (universal)

**RLS enforced on every org-scoped table. App code may NOT bypass RLS without explicit `SET ROLE`.** The adversarial cross-tenant probe (INT9) is a merge blocker — must return 0 rows.

```sql
-- Pattern applied to every org-scoped table
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON <table_name>
  USING (org_id = current_setting('app.current_org_id')::text);
```

The ingest server sets `app.current_org_id` from the JWT before any query.

### Tables (canonical list — internals owned by D)

| Table | Owners (read/write) | Notes |
|---|---|---|
| `orgs` | admin write, all read | Tier-C opt-in flag lives here |
| `users` | Better Auth | SSO subject mapping |
| `developers` | C (via SSO sync) | `engineer_id = stable_hash(SSO_subject)` |
| `repos` | C (via webhook) | `repo_id_hash` mirror to ClickHouse |
| `policies` | admin write | per-org redaction overrides, tier defaults |
| `git_events` | C (denormalized to CH on write) | Phase-1 GitHub App lands here first |
| `ingest_keys` | admin write | `dm_<orgId>_<rand>` records |
| `prompt_clusters` | H (nightly cluster job writes centroids) | E reads for cluster pages |
| `playbooks` | E (write via Promote-to-Playbook flow) | D31 source of Team Impact signal |
| `audit_log` | C, E, G, I write; auditor read | Immutable; reveal gestures + admin actions |
| `audit_events` | E write per manager view (D30) | Powers IC daily digest of "who looked at me" |
| `erasure_requests` | E write (user-triggered), D process | 7-d SLA tracking |
| `alerts` | C (anomaly detector writes) | E reads for SSE channel |
| `insights` | H (Insight Engine writes weekly) | E reads for digest |
| `outcomes` | C (webhook + trailer parser writes) | Per-PR / per-commit / per-test outcome rows |
| `embedding_cache` | H read/write | See `05-embed-provider.md` |

### Drizzle migrations

- Live in `packages/schema/postgres/`.
- Run via `bun run db:migrate:pg`.
- Up + down for every migration; `down` tested in CI.

### Per-table contracts that cross workstreams

- **`audit_log`** — append-only. NEVER UPDATE or DELETE. Schema: `(id, ts, actor_user_id, action, target_type, target_id, reason, metadata_json)`. Retention: indefinite.
- **`audit_events`** (D30) — per manager-view row. Schema: `(id, ts, actor_user_id, target_engineer_id_hash, surface, session_id_hash)`. Triggers IC daily digest.
- **`erasure_requests`** — schema: `(id, ts, requester_user_id, target_engineer_id, target_org_id, status, completed_at, partition_dropped)`. The 7-d SLA worker watches this.
- **`outcomes`** — schema: `(id, ts, org_id, engineer_id, kind, pr_number, commit_sha, session_id, ai_assisted)`. Joined with ClickHouse `events` on `(commit_sha, hunk_sha256)` per `04-scoring-io.md` outcome attribution.

## ClickHouse ↔ Postgres join surfaces

Some queries need both. Pattern: **denormalize at write time, never JOIN across DBs at read time.**

- `repo_id_hash` mirrored from PG `repos` to CH `events` columns (`repo_id_hash`, `branch`, `pr_number`, `commit_sha`).
- `engineer_id` is the same string in both DBs.
- `org_id` is the same string in both DBs (low-cardinality enum in CH).
- Tier-C opt-in flag mirrored from PG `orgs.tier_c_managed_cloud_optin` to ingest's in-process cache (60s TTL).

## Plan B — Go side-car (F15 / INT0)

If the 24h Bun↔ClickHouse soak shows flakes via `@clickhouse/client` HTTP, switch hot-path writer to a Go side-car over UNIX socket. **Plan B must be documented and ready before Sprint 1 starts** — don't discover this in Sprint 5. Lives in `apps/ingest-sidecar/` (Go), called via UNIX socket from Bun ingest.

## Invariants

1. **Ingest is the only writer to ClickHouse.** No path bypasses.
2. **Redis SETNX is authoritative for idempotency.** ReplacingMergeTree is a safety net.
3. **Partition drop, NEVER TTL, for Tier A retention.** Challenger C1 BLOCKER fix.
4. **RLS on every org-scoped Postgres table.** Cross-tenant probe = 0 rows.
5. **No JOINs across CH and PG.** Denormalize at write.
6. **`audit_log` is append-only.** No UPDATE, no DELETE, ever.
7. **GDPR erasure = `DROP PARTITION` + `audit_log` row + email confirmation.** 7-d SLA. Atomic.
8. **Schema migrations require down + up + CI test.** Drizzle down must succeed against a real PG instance.
9. **Aggregates retained indefinitely use `HMAC(engineer_id, tenant_salt)`.** Salt per tenant, rotated never (rotation = re-hash all aggregates = breaks longitudinal). Document the trade-off in `legal/templates/`.

## Open questions

- ClickHouse `cluster_id` column — populate at write (requires synchronous embed call) or lazily via MV after nightly cluster job? (Owner: D + H — lazily; live cluster lookup uses `cluster_assignment_mv`.)
- `repo_id_hash` definition — `sha256(repo_full_name)` or HMAC with tenant_salt? (Owner: D — HMAC; cross-tenant repo collision otherwise observable.)
- Plan B Go side-car — start writing in Sprint 0 alongside Bun client, or wait for soak to fail? (Owner: D — write the skeleton in Sprint 0 so the swap is one-line if needed; don't perfect it.)

## Changelog

- 2026-04-16 — initial draft.
- 2026-04-16 — Sprint-0 M0: switch `events` engine to `ReplacingMergeTree(ts)` (was `(client_event_id)`). Additive — the discriminator changed but ORDER BY key is unchanged and Redis SETNX remains the authoritative dedup. Reason: ClickHouse 25+ rejects UUID as the version column for ReplacingMergeTree (must be integer/Date/DateTime/DateTime64). Confirmed via failing `0001_events.sql` apply in D-seed.
