# D1-02 Design: ClickHouse Materialized Views (5 MVs)

**Status:** approved, ready for implementation plan
**Author:** Jorge (via brainstorming session 2026-04-17)
**Sprint:** D1 (Workstream D, Sprint 1)
**Ticket primer:** `docs/tickets/D1-02-materialized-views.md`
**GitHub issue:** #3

---

## 1. Purpose

Land five tables on ClickHouse that pre-aggregate every read path Workstream H (scoring) and Workstream E (dashboard) depend on. Without these, dashboard queries scan raw `events` at ~8M rows/day and miss the p95 <2s SLA; scoring becomes pull-at-read instead of pull-at-write; Twin Finder + playbook adoption have no per-session cluster join key.

The name "materialized views" is a misnomer for 1 of the 5 — `cluster_assignment_mv` is structurally a plain table written to by Workstream H's nightly cluster job, not a CH `MATERIALIZED VIEW` triggering on `events`. Kept the `_mv` suffix per contract 09 to avoid rippling rename work across other docs; treat the name as historical.

## 2. Scope

All 5 tables per contract 09 §Materialized views, bundled in one PR:

| Table | Type | Trigger | Owned + populated by |
|---|---|---|---|
| `dev_daily_rollup` | `AggregatingMergeTree` as CH `MATERIALIZED VIEW` | INSERT into `events` | D (this PR) |
| `team_weekly_rollup` | `AggregatingMergeTree` as CH `MATERIALIZED VIEW` + dictionary | INSERT into `events` + `dev_team_dict` | D (this PR ships schema + dictionary DDL; dictionary source data lands with D1-05) |
| `repo_weekly_rollup` | `AggregatingMergeTree` as CH `MATERIALIZED VIEW` | INSERT into `events` | D (this PR) |
| `prompt_cluster_stats` | `AggregatingMergeTree` as CH `MATERIALIZED VIEW` | INSERT into `cluster_assignment_mv` | D (schema) + H (nightly job populates source) |
| `cluster_assignment_mv` | `ReplacingMergeTree(ts)` plain table | Nightly job writes | D (DDL only) + H (Sprint 2 populates) |

**Additive `events` schema changes (bundled in this PR):**

```sql
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS repo_id_hash      Nullable(String) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prompt_cluster_id Nullable(String) DEFAULT NULL;
```

These columns are assumed by contract 09 §MVs but missing from the current `events` DDL. Adding them now unblocks all 5 MVs. Not a contract change — it's closing the gap between §events and §MVs. Requires a changelog line on contract 09.

## 3. Architectural decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Scope:** ship all 5 per contract 09 | Team tile views (E) need `team_weekly_rollup` by M1; shipping only the 4 named in issue #3 leaves E blocked. |
| D2 | **TZ:** UTC in the MV; per-org TZ at read time | MV is the invariant (no recompute when org changes TZ); correctness at the API boundary is standard event-analytics pattern. |
| D3 | **`team_id` source:** self-declared via `developers.team_id`; fed to CH via `dev_team_dict` dictionary | Simplest v1; no SSO integration dep; SSO-sync is a Phase 2 upgrade when a customer asks. |
| D4 | **`team_id` landing path:** `dictGetOrNull('dev_team_dict', 'team_id', engineer_id)` at MV write time | Additive; no `events` schema change; dev moves team → new events get new team, history stays event-time-correct. |
| D5 | **Noise-floor location:** scoring function, not MV | Keeps MVs pure sums; noise floor (sessions < 3) is a display policy, not an invariant of the aggregate. Locked at contract 04. |
| D6 | **`task_category`:** deferred to Phase 2 | Not in `events` today; 2×2 stratification can work on other dimensions for Sprint 1; revisit after we have data on what taxonomy is actually used. |
| D7 | **Engines:** AMT for 4 rollups; ReplacingMergeTree(ts) for `cluster_assignment_mv` | AMT supports `uniqState` needed for k-anonymity; cluster_assignment is a mapping (not aggregation), RMT handles nightly re-cluster. |
| D8 | **Two missing columns (`repo_id_hash`, `prompt_cluster_id`) added to `events` in this PR** | Designed columns, not unknown-attrs; belong in typed schema, not `raw_attrs`. |

## 4. Per-MV schemas

### 4.1 `dev_daily_rollup`

```sql
CREATE MATERIALIZED VIEW dev_daily_rollup
ENGINE = AggregatingMergeTree
ORDER BY (org_id, engineer_id, day)
PARTITION BY toYYYYMM(day)
POPULATE AS SELECT
  org_id,
  engineer_id,
  toDate(ts, 'UTC')                                       AS day,
  sumState(input_tokens)                                  AS input_tokens_state,
  sumState(output_tokens)                                 AS output_tokens_state,
  sumState(cost_usd)                                      AS cost_usd_state,
  uniqState(session_id)                                   AS sessions_state,
  countIfState(event_kind = 'code_edit_decision'
               AND edit_decision = 'accept')              AS accepted_edits_state,
  countIfState(event_kind = 'code_edit_decision'
               AND edit_decision = 'accept'
               AND revert_within_24h = 0)                 AS accepted_retained_edits_state,
  minState(ts)                                            AS first_ts_state,
  maxState(ts)                                            AS last_ts_state
FROM events
GROUP BY org_id, engineer_id, day;
```

**Consumer usage** (scoring function reads with `-Merge`):

```sql
SELECT
  engineer_id,
  sumMerge(cost_usd_state)             AS cost_usd,
  uniqMerge(sessions_state)            AS sessions,
  countIfMerge(accepted_edits_state)   AS accepted_edits
FROM dev_daily_rollup
WHERE org_id = {org:String} AND day >= today() - 30
GROUP BY engineer_id;
```

### 4.2 `team_weekly_rollup`

Same shape as 4.1, keyed `(org_id, team_id, week)` where `week = toMonday(toDate(ts, 'UTC'))`.

- `team_id Nullable(String)` — from `dictGetOrNull('dev_team_dict', 'team_id', engineer_id)`.
- Dictionary `dev_team_dict` is DDL'd in this PR but sourced from PG `developers.team_id`, which doesn't exist until D1-05 adds a `teams` table + `developers.team_id` FK. **This introduces a small scope bump on D1-05** — the ticket primer didn't originally list `teams`; update the `D1-05` primer to include it. Until D1-05 lands, `dictGetOrNull` returns NULL, MV rows exist with NULL team_id, and E's team-tile consumer renders whatever fallback it chooses (contract 07's concern, not ours).

### 4.3 `repo_weekly_rollup`

Keyed `(org_id, repo_id_hash, week)`:
- `input_tokens_state`, `output_tokens_state`, `cost_usd_state` — same `sumState` sums as 4.1.
- `sessions_state = uniqState(session_id)`.
- `accepted_edits_state` and `accepted_retained_edits_state` — same two `countIfState` expressions as 4.1 (both the raw accepted count and the retained-24h count).
- `commits_state = uniqState(commit_sha)` — for outcome attribution.
- `prs_state = uniqStateIf(pr_number, pr_number IS NOT NULL)` — NULL PRs excluded.

Source: `FROM events WHERE repo_id_hash IS NOT NULL` (events without repo attribution excluded from this MV; `dev_daily_rollup` still counts them).

### 4.4 `prompt_cluster_stats`

Keyed `(org_id, cluster_id, week)`:
- `prompt_count_state = sumState(toUInt64(1))`.
- `contributing_engineers_state = uniqState(engineer_id)` — API gates `k ≥ 3` at read (CLAUDE.md §6.4).
- `cost_usd_state = sumState(cost_usd)`.
- `avg_duration_state = avgState(duration_ms)`.

**Source:** `FROM cluster_assignment_mv LEFT JOIN events USING (org_id, session_id, prompt_index)`. Triggers on INSERTs into `cluster_assignment_mv` (H's nightly job).

### 4.5 `cluster_assignment_mv`

Plain table, not a CH MV:

```sql
CREATE TABLE cluster_assignment_mv (
  org_id        LowCardinality(String),
  session_id    String,
  prompt_index  UInt32,
  cluster_id    String,
  ts            DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(ts)
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, session_id, prompt_index);
```

H's nightly cluster job writes to this table. ReplacingMergeTree keeps the latest assignment when a prompt is re-clustered.

## 5. Integration points

| Consumer | Reads from | Notes |
|---|---|---|
| Scoring function (H, contract 04) | `dev_daily_rollup`, `team_weekly_rollup` | Uses `-Merge` finalizers; applies noise floor (sessions < 3). |
| Dashboard API (E, contract 07) | All 5 MVs | Applies k-anonymity gates (k≥5 teams, k≥3 clusters) at query layer. |
| Twin Finder + playbook adoption (H, D31) | `cluster_assignment_mv` | Direct read — no aggregation needed. |
| Ingest (C, contract 02) | (writer only) | No code change; writes to `events` as before; MVs auto-populate. |
| Nightly cluster job (H, future Sprint 2) | Writes `cluster_assignment_mv` | Embeds in OpenAI Batch API; nearest-cluster assignment; inserts one row per `(session_id, prompt_index)`. |

**RLS note:** CH has no RLS equivalent; tenant isolation at this layer is enforced by `org_id` prefix on every `ORDER BY`. Cross-tenant leakage prevention relies on the API layer (contract 07 §Authz) setting `WHERE org_id = <authenticated org>` on every query. Workstream E is responsible for this at the tRPC level.

## 6. Tests (target: ~22 focused tests)

All in `packages/schema/clickhouse/__tests__/`. Uses `bun test` + `@clickhouse/client` against the local docker stack.

- **Per-MV smoke** (5 tests): insert 20 deterministic events → assert MV row count + key column sums match naive SELECT. For `cluster_assignment_mv` and `prompt_cluster_stats` the source is not `events` — insert directly into `cluster_assignment_mv` for those two (simulating what H's nightly job will do).
- **Per-MV property** (5 tests): seed 1000 random events → `sumMerge(col_state) == sum(col)` within ±0.
- **Uniq correctness** (3 tests): `uniqMerge(sessions_state) == uniq(session_id)` on raw events, for dev/team/repo rollups.
- **Partition-drop survival** (1 test): `ALTER TABLE events DROP PARTITION` also drops MV rows in the matching partition. Regression guard — CH native behaviour, assert not regressed.
- **Replacement correctness** (2 tests): two rows in `cluster_assignment_mv` with same `(org_id, session_id, prompt_index)` but different `ts` → only latest survives after FINAL.
- **Empty cohort** (1 test): org with 0 events returns 0-row MV (not NULL row); contract 04 display gates handle absence.
- **Schema additions round-trip** (2 tests): insert event with `repo_id_hash`/`prompt_cluster_id` set and unset; both read back.
- **`team_id` dictionary fallback** (2 tests): `dictGetOrNull` returns NULL when dev not in dict; MV row persists.
- **Seed script smoke** (1 test): `bun run db:seed` runs clean, ≥1 row in every MV.

## 7. Seed script (`packages/schema/scripts/seed.ts`)

Deterministic synthetic fixture — not randomized per run (use fixed seed) so tests are reproducible:

- 3 orgs (small / medium / large)
- 12 engineers distributed across orgs
- 200 sessions, 8000 events spread over 30 days
- Mix of Claude Code / Cursor / Continue event sources
- Some events tagged with `repo_id_hash` + `prompt_cluster_id`; some without
- Writes PG `orgs`/`users`/`developers` + CH `events` in one pass

Script is idempotent — `TRUNCATE` before insert; can re-run without accumulating.

## 8. Migration plan

New files in `packages/schema/clickhouse/migrations/`:

| File | Content |
|---|---|
| `0002_events_add_repo_cluster_cols.sql` | Additive `ALTER TABLE events ADD COLUMN ...` |
| `0003_dev_daily_rollup.sql` | MV definition (§4.1) |
| `0004_team_weekly_rollup.sql` | MV definition (§4.2) + `dev_team_dict` dictionary DDL |
| `0005_repo_weekly_rollup.sql` | MV definition (§4.3) |
| `0006_cluster_assignment_mv.sql` | Plain table (§4.5) |
| `0007_prompt_cluster_stats.sql` | MV definition (§4.4) |

Applied in order via `bun run db:migrate:ch`. `0006` before `0007` because `prompt_cluster_stats` reads from `cluster_assignment_mv`.

## 9. Performance notes

- **Write amplification:** 3 event-sourced MVs = 4× write fan-out (1 base + 3 MVs). Measured on the 8k-event seed fixture. Delta reported in PR description.
- **Read path:** consumers use `-Merge` aggregators on state columns. Reading MVs is ~10–50× faster than scanning raw `events` for equivalent aggregates; not benchmarked in this ticket — D1-03 projections + D1-03 EXPLAIN gates quantify.
- **POPULATE timing:** runs at `CREATE MATERIALIZED VIEW` time. Empty-dev DB → no-op. Production → CH back-populates from existing `events` — can be slow on a live system; document in the migration comment that production deploys should run during a quiet window.

## 10. Contract 09 changelog entry (to append)

```markdown
- 2026-04-17 — D1-02: added 5 materialized view DDLs per §Materialized views. 
  Additive `events` columns `repo_id_hash` and `prompt_cluster_id` added to 
  support repo + cluster MV read paths (closes gap between §events and §MVs 
  where the columns were assumed but not declared). `cluster_assignment_mv` 
  is a plain `ReplacingMergeTree(ts)` table populated by H's nightly cluster 
  job, not a CH `MATERIALIZED VIEW` triggering on events — name retained for 
  historical consistency.
```

## 11. Out of scope (explicit non-goals for D1-02)

- **Projections** — D1-03.
- **EXPLAIN gates** — D1-03.
- **Partition-drop worker** — D1-04.
- **Teams PG table + `developers.team_id`** — D1-05.
- **Nightly cluster job that populates `cluster_assignment_mv`** — Sprint 2 (Workstream H).
- **Scoring function reading MVs** — Sprint 2 (Workstream H, contract 04).
- **k-anonymity query gates** — API layer, Workstream E in Sprint 2.
- **Per-org TZ correctness at read** — API layer, Workstream E in Sprint 2. This PR ships UTC-bucketed MVs; E adds the TZ shift when they build the read endpoints.
- **`task_category` stratification** — Phase 2.

## 12. Definition of done

- [ ] 6 CH migrations land and apply cleanly (`bun run db:migrate:ch` green).
- [ ] Seed script runs and populates every MV.
- [ ] ~22 focused tests, all green (`bun run test`).
- [ ] `bun run typecheck` green.
- [ ] `bun run lint` green.
- [ ] Contract 09 changelog appended.
- [ ] `docs/DEVLOG.md` entry appended.
- [ ] `docs/tickets/README.md` D1-02 status flipped to ✅.
- [ ] PR opened against main with `Refs #3` (once push access lands).

## 13. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CH `@clickhouse/client` HTTP flakiness under MV fan-out | Low-Medium | High | D1-07 Plan B Go sidecar skeleton. If F15 soak fails in Sprint 2, switch hot-path writer. |
| `POPULATE` lockup on production event volumes | Medium | Medium | Document in migration comment; recommend maintenance-window apply in prod. |
| Contract drift — E building against a different MV shape than shipped | Medium | High | Ship spec to `docs/superpowers/specs/` BEFORE merging; pair with E's workstream reviewer on PR. |
| Dictionary timing — `dev_team_dict` DDL in this PR but source data absent until D1-05 | Low | Low | `dictGetOrNull` returns NULL; MV rows exist with NULL team_id. Dashboard renders "team setup pending" state. |
| Nightly cluster job doesn't exist yet — `cluster_assignment_mv` stays empty, `prompt_cluster_stats` shows no data | Low | Low | Expected. Both tables light up when H's job runs in Sprint 2. |
