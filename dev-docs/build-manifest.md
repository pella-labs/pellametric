# Build Manifest — Pellametric Insights Revamp

> Top-level index. The actual atomic tasks, hot-path code, and DAG live in the chunk files below. Read in order.

## Files in this manifest

| File | Purpose |
|---|---|
| `dev-docs/build/01-overview-and-hotpaths.md` | How to read the manifest. Atomic Task Unit schema. Parallelism DAG (27 waves). 7 hot-path TypeScript implementations (lineage scoring, proration, redaction, ancestry, GraphQL batch, two-tier helper, attribution heuristic). Rollout / feature-flag strategy. Orchestrator hand-off checklist. |
| `dev-docs/build/02-phase-1-2-tasks.md` | Phase 1 (Foundations, T1.1–T1.18) + Phase 2 (Lineage core, T2.0–T2.26). 45 atomic tasks. |
| `dev-docs/build/03-phase-3-4-5-tasks.md` | Phase 3 (Rollups, T3.1–T3.8) + Phase 4 (Design system + Manager UI, T4.1–T4.22) + Phase 5 (Dev Sankey + Session detail, T5.1–T5.11). 41 atomic tasks. |
| `dev-docs/build/04-phase-6-7-8-tasks.md` | Phase 6 (Two-tier + non-App banners, T6.1–T6.6) + Phase 7 (Cohort + Benchmark + Waste + Intent, T7.1–T7.12) + Phase 8 (Polish + Mobile + a11y + Cutover, T8.1–T8.12). Consistency audit at the end (22 patches resolved). 30 atomic tasks. |
| `dev-docs/fixtures/README.md` | Catalog of 35 fixture files (webhooks, commits, sessions, SQL seeds) the build agents must produce in T2.0. |

## Totals

- **~118 atomic tasks** across 8 phases.
- **27 sequential waves**, ~3-5 tasks parallel per wave on average.
- **5 hard gates** that block parallelism: W4 (`bun run db:push`, preceded by data-safety gates **T1.12a snapshot** + **T1.12b dry-run inspection**), W12 (webhook E2E), W14 (rollups end-to-end), W19 (a11y), W22 (dev-view E2E).
- **22 consistency-audit patches** applied retroactively to earlier phases (see `build/04` final section).

## Data safety

Phase 1 has non-negotiable data-safety gates: **T1.12a** takes a `pg_dump` snapshot of the live database BEFORE any `db:push`, and **T1.12b** runs drizzle-kit in dry-run and blocks if the proposed SQL contains any `DROP`, `RENAME`, `ALTER COLUMN … TYPE`, or `NOT NULL` without default. **T1.13** post-push verification asserts row counts on `session_event`, `pr`, `prompt_event`, `user`, `org` are unchanged. See `dev-docs/build/02-phase-1-2-tasks.md` Phase 1 preamble and tasks T1.12a / T1.12b / T1.13 for the full procedure.

## Reading order for an orchestrator

1. `dev-docs/presearch.md` — locked decisions and architecture context (~25K).
2. `dev-docs/build/01-overview-and-hotpaths.md` — DAG + reference code.
3. `dev-docs/fixtures/README.md` — fixture catalog.
4. `dev-docs/build/02-phase-1-2-tasks.md` — start here for the first wave.
5. Then `03` and `04` as phases unlock.

## Reading order for a human reviewer

1. `dev-docs/presearch.md` — the why.
2. `dev-docs/PRD.md` — the what.
3. `dev-docs/build/01-overview-and-hotpaths.md` §3 (DAG) and §5 (rollout).
4. `dev-docs/build/04-phase-6-7-8-tasks.md` final section (consistency audit) — the surprises.

## Execution modes

The manifest supports two execution styles. Both are valid.

| Mode | When | How |
|---|---|---|
| **Swarm** | You want maximum parallelism | Orchestrator reads DAG, spawns ~3-5 subagents per wave, runs ~27 waves. Each subagent receives one task block as prompt + repo access. |
| **Single-agent per phase** | You want simplicity, can afford serial execution | Hand the whole chunk file (or one phase from it) to one Claude. Say: "Complete all tasks in Phase N in order." |

For this codebase: **single-agent per phase** is likely fastest for Phases 1, 2, 3 (interdependent schema/worker code). **Swarm** works well for Phase 4 (mostly parallel components) and Phase 8 (parallel polish sweeps).

## Hand-off checklist (before execution)

- [ ] Branch `feat/insights-revamp` is checked out.
- [ ] `dev-docs/build/01-04` and `dev-docs/fixtures/README.md` all present.
- [ ] `.env` template includes `GITHUB_APP_WEBHOOK_SECRET`, `INTERNAL_API_SECRET`, `INTERNAL_API_SECRET_PREVIOUS`, `INTERNAL_ADMIN_SECRET`, `LINEAGE_ALERT_WEBHOOK`, `PELLA_BLAME_ENABLED`, `PELLAMETRIC_INSIGHTS_REVAMP_UI`.
- [ ] Postgres reachable; `bun run typecheck && bun run test` passes baseline.
- [ ] Collector builds: `cd apps/collector && bun run build:darwin-arm64`.
- [ ] Drizzle config points at the live DB; `bun run db:push --dry-run` shows no unexpected drift.
- [ ] Confidence in rollback: every schema task is additive; `bun run db:push` is reversible by `DROP TABLE` since we don't have committed migrations.
