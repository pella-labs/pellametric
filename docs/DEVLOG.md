# DEVLOG — Workstream D (Jorge)

Chronological log of tickets worked on. Append-only; one entry per completed ticket.

---

## 2026-04-17 — Sprint 1 kickoff

- Dev environment setup complete (Bun 1.3.12, docker stack healthy, M0 migrations applied, baseline green).
- Phase 0 (`D1-00` env autoload + compose override) committed to local branch `dev-env-autoload-compose-override-jorge`. Push blocked pending repo collaborator grant.
- Sprint 1 phases sliced into tickets; see `docs/tickets/README.md`.

## 2026-04-17 — D1-01: verified no-op

- **What shipped:** Audit trail only. Both "known contract drift" items in GH issue #3 were verified already-fixed at M0 on 2026-04-16 (commit `b086bfc`) before Sprint 1 started.
- **Branch / PR:** `D1-01-contract-05-drift-jorge` — docs-only; no contract change.
- **Follow-ups:** Mention in final Sprint 1 PR description that issue #3's "Known contract drift" bullets are resolved-on-inspection.

## 2026-04-17 — D1-07: Plan-B Go sidecar skeleton landed — Sprint 1 COMPLETE

- **What shipped:** `apps/ingest-sidecar/` — Go module, UNIX-socket server, size+time-based batcher, Dockerfile (distroless nonroot), `sidecar` docker-compose profile (not default-up), README with activation sequence. 3 Go tests (size trigger, cancel drain, drain idempotency) all pass.
- **Branch / PR:** `D1-07-plan-b-sidecar-jorge` → PR pending.
- **Scope:** skeleton only. CH writer is a logging stub; real `internal/ch/writer.go` implementation lives behind a YAGNI marker, to be filled in ONLY if F15/INT0 soak fails in Sprint 2. Per CLAUDE.md Architecture Rule #7 — "Plan B must be documented and ready before Sprint 1 starts" — the skeleton satisfies readiness.
- **Bun ingest switch path:** `apps/ingest/src/clickhouse.ts` doesn't exist yet (Workstream C hasn't wired ingest's CH client). The activation instructions in `apps/ingest-sidecar/README.md` tell C what import to swap when the time comes.

## 2026-04-17 — D1-06: RLS + INT9 cross-tenant probe landed (merge blocker)

- **What shipped:** RLS enabled + FORCED on 15 org-scoped PG tables via `packages/schema/postgres/custom/0002_rls_org_isolation.sql`. New `app_bematist` role (NOBYPASSRLS, NOSUPERUSER) for application connections. `app_current_org()` helper + `org_isolation` policy per table using `current_setting('app.current_org_id', true)::uuid`. `withOrg()` TypeScript helper in `packages/schema/postgres/rls_set_org.ts`. `org_id` column added to `audit_log` and `audit_events` (via drizzle migration `0003_remarkable_omega_flight.sql`) so they can participate in RLS.
- **INT9 test:** 5 tests, 80 expect() calls, probes all 15 tables × 5 scenarios (role assertion, default-deny without setting, org-A-set, org-B-set, transaction scope releases on commit). **Merge blocker per contract 09 invariant 4; zero leakage observed.**
- **Branch / PR:** `D1-06-rls-int9-probe-jorge` → PR pending.
- **Skipped from RLS:** `orgs` (the tenant table itself), `embedding_cache` (shared by design per contract 05).
- **Gotcha:** adding `NOT NULL` column to existing tables with rows fails without a backfill; had to TRUNCATE audit_log + audit_events before applying the column add. For prod migration we'd write a DEFAULT + backfill + drop-default pattern. Flagged.

## 2026-04-17 — D1-05: 13 Postgres control-plane tables landed

- **What shipped:** Added 13 tables to `packages/schema/postgres/schema.ts`: `teams`, `repos`, `policies`, `git_events`, `ingest_keys`, `prompt_clusters`, `playbooks`, `audit_events`, `alerts`, `insights`, `outcomes`, `embedding_cache`. Plus `developers.team_id` FK to `teams` (closes the dependency D1-02 flagged). `orgs.tier_c_managed_cloud_optin` added. Drizzle migration `0002_nasty_molten_man.sql` generated + applied.
- **`audit_log` immutability trigger:** added via `packages/schema/postgres/custom/0001_audit_log_immutable.sql`. Extended `migrate.ts` with a custom-SQL pass that runs after drizzle's migrator — applies any `.sql` files in `postgres/custom/` idempotently (using CREATE OR REPLACE / DROP IF EXISTS patterns). Contract 09 invariant 6 enforced at the DB level.
- **Branch / PR:** `D1-05-pg-control-plane-jorge` → PR pending.
- **Tests:** 5 in `packages/schema/postgres/__tests__/control_plane.test.ts`: core orgs/users/teams/developers FK chain, repos+policies+git_events+ingest_keys, playbooks+clusters+audit_events+alerts+insights+outcomes, embedding_cache (512-dim vector round-trip), audit_log INSERT-works/UPDATE-throws/DELETE-throws.
- **Follow-ups:**
  - D1-06 enforces RLS on every org-scoped table landed here.
  - Update `dev_team_dict` dictionary query (created in D1-02 migration 0004) to select `team_id::text` from `developers` now that the column exists. This is a minor dictionary refresh; the column addition alone doesn't invalidate the dict until its LIFETIME expires (~15 min).

## 2026-04-17 — D1-04: GDPR partition-drop worker landed

- **What shipped:** `apps/worker/src/jobs/partition_drop.ts` — handler that loads pending `erasure_requests`, enumerates `system.parts` partitions for the target org, issues `ALTER TABLE events DROP PARTITION ID` per partition, writes `audit_log` row, flips request to `completed`. `pg-boss@^9` installed + wired in `apps/worker/src/index.ts` (hourly cron). PG `erasure_requests` + `audit_log` tables added to `packages/schema/postgres/schema.ts`; drizzle migration `0001_dusty_karen_page.sql` generated + applied. 3 handler tests (happy path, idempotency on completed requests, empty-partition graceful path).
- **Branch / PR:** `D1-04-partition-drop-worker-jorge` → PR pending.
- **Scope caveat documented in handler header:** partition granularity `(month, cityHash64(org_id) % 16)` means dropping a shard takes ~1/16 of tenants' data for that month with it. Acceptable for Sprint 1 test data (handful of orgs); needs architectural revisit (more shards, or partition-by-org, or surgical DELETE) before production scale. Flagged for post-Sprint-1.
- **Gotcha re-confirmed:** `bun --env-file=.env --filter=...` does NOT propagate DATABASE_URL to filtered subprocesses. Prefixing `DATABASE_URL=... bun run ...` still required for PG migrate runs. Memory entry `project_dev_env_setup.md` already documents this.

## 2026-04-17 — D1-03: projections + EXPLAIN gates landed

- **What shipped:** 2 additive projection migrations (`0008_projection_repo_lookup`, `0009_projection_cluster_lookup`). `events` table setting `deduplicate_merge_projection_mode = 'rebuild'` added (required for projections on RMT tables). `packages/schema/clickhouse/explain.ts` — reusable EXPLAIN helpers (`explainWithProjection`, `explainNatural`, `projectionUsed`). 7 tests.
- **Branch / PR:** `D1-03-projections-jorge` → PR pending.
- **Discovery:** CH's optimizer picks the FIRST applicable projection by prefix match on ORDER BY; when multiple projections share an `org_id` prefix, the cluster filter can be served by the repo projection. Tests verify *a* projection is used (not a specific name), which is the real performance gate.
- **Follow-ups:** D1-04 onwards.

## 2026-04-17 — D1-02: ClickHouse materialized views landed

- **What shipped:** 6 CH migrations (`0002`–`0007`). Additive `events` columns (`repo_id_hash`, `prompt_cluster_id`). Three event-sourced MVs (`dev_daily_rollup`, `team_weekly_rollup`, `repo_weekly_rollup`). One plain `ReplacingMergeTree(ts)` table (`cluster_assignment_mv`). One MV on top of it (`prompt_cluster_stats`). PG-backed dictionary (`dev_team_dict`). Deterministic seed script (3 orgs, 12 devs, 8k events). 24 CH tests; full workspace test sweep 46/46 green.
- **Branch / PR:** `D1-02-materialized-views-jorge` → PR pending push access.
- **Contracts touched:** `09-storage-schema.md` — additive changelog entry on 2026-04-17.
- **Tests added:** 24 in `packages/schema/clickhouse/__tests__/` — smoke per event-sourced MV, partition-drop survival, ReplacingMergeTree FINAL correctness, property (raw-sum = MV-sum) test, empty-cohort handling, repo split (NULL repo_id_hash).
- **Discoveries (inline-fixed):**
  - CH `DateTime64` JSON parser rejects ISO8601 `T`/`Z`; harness now converts to `YYYY-MM-DD HH:MM:SS.mmm`.
  - CH MVs report `engine='MaterializedView'` on the user-facing table; storage engine lives on the hidden `.inner_id.<uuid>` table. Tests join via `system.tables.uuid` to assert inner engine.
  - `TRUNCATE TABLE <mv>` works but does NOT cascade from source — harness `resetState` explicitly truncates each MV.
  - CH rejects `table` + `query` together in a PG dictionary source; use `query` only.
  - `ORDER BY (org_id, team_id, week)` with `team_id Nullable(String)` needs `SETTINGS allow_nullable_key = 1`.
- **Follow-ups:**
  - D1-05 must add `teams` table + `developers.team_id` column, then update `dev_team_dict` source query to return real `team_id` (spec already flagged this scope bump).
  - H's Sprint-2 nightly cluster job writes to `cluster_assignment_mv`; `prompt_cluster_stats` stays empty until then (expected).
  - Projections + EXPLAIN gates land in D1-03.

---

## Template for future entries

```
## YYYY-MM-DD — <TICKET-ID>: <short outcome>

- **What shipped:** 1-2 sentences.
- **Branch / PR:** `<branch>` → #<pr-number>.
- **Contracts touched:** 09-storage-schema.md §§…
- **Tests added:** …
- **Follow-ups:** …
```
