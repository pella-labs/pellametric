# M2 demo — collector → ingest → ClickHouse → dashboard (USE_FIXTURES=0)

Purpose: a reviewer can copy these commands top-to-bottom on a fresh checkout
and see one real event traverse the full Wave-1 stack, end with a
`USE_FIXTURES=0` dashboard query reading real ClickHouse rows.

Owner: A17 (Wave-2 E2E). Cross-references the integration test at
`apps/web/integration-tests/use-fixtures-0.test.ts` and the live smoke at
`apps/ingest/src/smoke.ts`.

## 0. Prereqs

- Bun ≥ 1.3.4 (root `package.json` engines pin)
- Docker
- Free ports: 5433 (PG), 8123 (CH HTTP), 6379 (Redis), 8766 (smoke ingest)

## 1. Bring up the dev DBs

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps    # all three healthy
```

Expected: `bematist-postgres`, `bematist-clickhouse`, `bematist-redis` all
report `(healthy)`.

## 2. Install + apply migrations

```bash
bun install --frozen-lockfile
bun run db:migrate:pg     # creates control-plane tables + RLS (PR #34)
bun run db:migrate:ch     # creates events + 5 MVs + 2 projections
```

Expected on `db:migrate:ch`:

```
[ch-migrate] applied 0001_events.sql
[ch-migrate] applied 0002_events_add_repo_cluster_cols.sql
[ch-migrate] applied 0003_dev_daily_rollup.sql
[ch-migrate] applied 0004_team_weekly_rollup.sql
[ch-migrate] applied 0005_repo_weekly_rollup.sql
[ch-migrate] applied 0006_cluster_assignment_mv.sql
[ch-migrate] applied 0007_prompt_cluster_stats.sql
[ch-migrate] applied 0008_projection_repo_lookup.sql
[ch-migrate] applied 0009_projection_cluster_lookup.sql
[ch-migrate] done — 9 file(s) applied to bematist
```

## 3. Live smoke — collector → ingest → CH events table → dev_daily_rollup MV

```bash
cd apps/ingest && INGEST_PORT=8766 bun run smoke
```

Expected (line breaks added):

```
{"level":"info","msg":"smoke: starting","redis":"redis://localhost:6379","ch":"http://localhost:8123","port":8766}
{"level":30,...,"msg":"ingest listening","url":"http://0.0.0.0:8766/"}
{"level":30,...,"accepted":10,"deduped":0,"tenant_id":"smokeorg","msg":"events accepted"}
{"level":"info","msg":"smoke: post done","status":202,"body":"{\"accepted\":10,\"deduped\":0,...}"}
{"level":"info","msg":"smoke: ch summary","count":10,"expected":10,"cost_usd_events":0.055,"cost_usd_rollup":0.055}
{"level":"info","msg":"smoke: OK"}
```

What happened:

1. In-process Bun ingest server booted on :8766 with **real** Redis
   dedup, real Redis Streams WAL, real `@clickhouse/client` writer.
2. POST `/v1/events` with a 10-event batch (`{events: [...]}` envelope,
   `Authorization: Bearer bm_smokeorg_smokekey_smokesecret`).
3. Server returned 202 `{accepted: 10, deduped: 0}`.
4. WAL consumer drained the Redis Stream and inserted into CH `events`.
5. Direct CH count + sum confirmed all 10 rows landed with $0.055 total.
6. `dev_daily_rollup` MV (AggregatingMergeTree) returned the same $0.055
   via `sumMerge(cost_usd_state)` — proves the MV pipeline is alive.

## 4. End-to-end test — `USE_FIXTURES=0` routing

```bash
TEST_E2E=1 bun test apps/web/integration-tests/use-fixtures-0.test.ts
```

Expected:

```
apps/web/integration-tests/use-fixtures-0.test.ts:
{"level":"warn","msg":"e2e: getSummary real-branch SQL incompatible with MV (known bug, see PR body)",...}

 3 pass
 0 fail
 19 expect() calls
Ran 3 tests across 1 file. [~1.7s]
```

The three tests prove:

| # | What                                                            | How                                                                        |
|---|-----------------------------------------------------------------|----------------------------------------------------------------------------|
| 1 | Collector → ingest → CH `events` table                          | POST 5 events, poll `count(events)` until = 5                              |
| 2 | `dev_daily_rollup` AggregatingMergeTree state functions work    | `sumMerge(cost_usd_state) ≈ 0.02`, `countIfMerge(accepted_edits_state)=2`  |
| 3 | `USE_FIXTURES=0` routes `getSummary` through real `ctx.db.ch`   | spy captures SQL containing `dev_daily_rollup`; fixture path never queries |

Test 3's `console.warn` is intentional and surfaces a real upstream bug — see
**Surprises** below.

## 5. Local dashboard render with `USE_FIXTURES=0`

The Next.js `apps/web` runtime currently constructs **stub** DB clients in
`apps/web/lib/db.ts` (M1 carry-over: real client wiring is owned by another
agent, not by A17). Once that wiring lands, the local-dashboard render is:

```bash
USE_FIXTURES=0 \
DATABASE_URL=postgres://postgres:postgres@localhost:5433/bematist \
CLICKHOUSE_URL=http://localhost:8123 \
REDIS_URL=redis://localhost:6379 \
bun --filter='@bematist/web' dev
```

Then visit http://localhost:3000 and the Summary tile will render against
**real** seeded ClickHouse rows (after running step 3 to seed data).

In the meantime, the integration test in step 4 is the authoritative proof
that `USE_FIXTURES=0` reaches CH.

## 6. CI smoke

A new GitHub Actions job in `.github/workflows/ci.yml` (matrix entry
`e2e-use-fixtures-0`) runs the integration test inside the standard service
stack on every PR. See the workflow file for details.

## Surprises (file these as follow-ups)

1. **`apps/ingest/src/wal/append.ts#canonicalize`** forwards `event.ts`
   verbatim to the CH writer. EventSchema requires ISO8601
   (`2026-04-18T01:23:45.678Z`); CH DateTime64's default input format
   rejects the `T` separator + `Z` suffix → INSERT raises CH error 27
   `CANNOT_PARSE_INPUT_ASSERTION_FAILED`. Workaround in this PR: pass
   `clickhouse_settings: { date_time_input_format: 'best_effort' }` on the
   writer client. Permanent fix: convert in canonicalize OR set the setting
   in `apps/ingest/src/clickhouse/realWriter.ts`.

2. **`packages/api/src/queries/dashboard.ts#getSummaryReal`** queries
   `SELECT sum(cost_usd) FROM dev_daily_rollup` but that MV is
   `AggregatingMergeTree` with column `cost_usd_state` — `sum(cost_usd)`
   raises CH error 47 `UNKNOWN_IDENTIFIER`. The fix is `sumMerge(cost_usd_state)`
   plus the same swap for `accepted_edits`, `merged_prs`, `sessions`. Out of
   scope for A17 (touches `packages/**` per brief). Test 3 demonstrates the
   USE_FIXTURES=0 routing is correct; the SQL bug is a separate fix.

3. **`apps/ingest/src/smoke.ts` on main was broken**: posted single events
   instead of `{events: [...]}` (returns 400 BAD_SHAPE), missed
   `tenant_id` / `engineer_id` (zod-rejected), missed `orgPolicyStore.seed`
   (returns 500 ORG_POLICY_MISSING), and the verify CH client was bound to
   the `default` database instead of `bematist` (returns table-not-found).
   This PR fixes all four.

4. **Bearer regex** (`apps/ingest/src/auth/verifyIngestKey.ts:122`) accepts
   only `[A-Za-z0-9]` in `orgId` and `keyId` — no hyphens. UUIDs need
   `.replace(/-/g, '')` before they can be used as test org IDs. Documented
   in the integration test.
