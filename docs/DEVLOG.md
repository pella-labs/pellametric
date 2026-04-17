# DEVLOG — Workstream D (Jorge)

Chronological log of tickets worked on. Append-only; one entry per completed ticket.

---

## 2026-04-17 — Sprint 1 kickoff

- Dev environment setup complete (Bun 1.3.12, docker stack healthy, M0 migrations applied, baseline green).
- Phase 0 (`D1-00` env autoload + compose override) committed to local branch `dev-env-autoload-compose-override-jorge`. Push blocked pending repo collaborator grant.
- Sprint 1 phases sliced into tickets; see `docs/tickets/README.md`.

## 2026-04-17 — D1-01: verified no-op

- **What shipped:** Audit trail update only. Both "known contract drift" items in GH issue #3 were verified already-fixed at M0 on 2026-04-16 (commit `b086bfc`) before Sprint 1 started.
- **Branch / PR:** `D1-01-contract-05-drift-jorge` — docs-only commit; no contract change.
- **Contracts touched:** None (read-only verification). Evidence recorded in `docs/tickets/D1-01-contract-05-drift.md` §Resolution.
- **Tests added:** None needed.
- **Follow-ups:** Mention in final Sprint 1 PR description that issue #3's "Known contract drift" bullets are resolved-on-inspection.

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
