# Workstream D — Sprint 1 Tickets

> These are Jorge's primers for GH issue [#3](https://github.com/pella-labs/bematist/issues/3) — Workstream D + H-AI Sprint 1+ fan-out. One ticket per phase; each file is a self-contained primer for resuming work in a fresh session.

## Convention

- **ID format:** `D<sprint>-<phase>` — e.g. `D1-02` = Workstream D, Sprint 1, phase 02.
- **Branch format:** `D1-<phase>-<short-slug>-jorge` — e.g. `D1-01-materialized-views-jorge`.
- **Commit format:** Conventional Commits — `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- **Template:** All tickets follow `/docs/tickets/_template.md` (adapted from Nclusion primer template).

## Index (Sprint 1)

| ID | Title | Status | Branch |
|---|---|---|---|
| `D1-00` | Dev env autoload + compose override | ✅ committed (push blocked) | `dev-env-autoload-compose-override-jorge` |
| `D1-01` | Contract 05 naming drift fix (`@devmetrics/*` → `@bematist/*`) | pending | — |
| `D1-02` | ClickHouse materialized views (5 MVs) | ✅ committed (push blocked) | `D1-02-materialized-views-jorge` |
| `D1-03` | Projections on `events` + EXPLAIN gates | ✅ committed | `D1-03-projections-jorge` |
| `D1-04` | GDPR partition-drop worker (7-d SLA) | ✅ committed | `D1-04-partition-drop-worker-jorge` |
| `D1-05` | Remaining Postgres control-plane tables (Drizzle) | ✅ committed | `D1-05-pg-control-plane-jorge` |
| `D1-06` | RLS on every org-scoped table + INT9 cross-tenant probe | ✅ committed (MERGE BLOCKER gate passes) | `D1-06-rls-int9-probe-jorge` |
| `D1-07` | Plan-B Go sidecar skeleton (F15 / INT0 fallback) | ✅ committed | `D1-07-plan-b-sidecar-jorge` |

Sprint 2 (Workstream H-AI) will add `D2-*` tickets once Sprint 1 closes.

## Dependency graph

```
D1-00 (done) ─┬─> D1-01 ─┬─> D1-02 ─> D1-03
              │          │
              │          └─> D1-05 ─> D1-06 (blocks PR merge: INT9 merge gate)
              │
              └─> D1-04
              └─> D1-07 (parallel; must land before Sprint 1 ends per F15)
```

- `D1-01` unblocks everything downstream (consumer imports are wrong in contract 05 today).
- `D1-02` (MVs) and `D1-04` / `D1-05` are parallelizable.
- `D1-03` must come after `D1-02` (projections reference MV column shape).
- `D1-06` is the merge-blocker gate for all org-scoped PG work.
- `D1-07` is time-gated — must ship before Sprint 1 ends regardless of priority.

## How to use a ticket primer

1. Read the primer end-to-end before touching code.
2. Read the referenced contracts + PRD decisions.
3. Check off deliverables as you go.
4. When complete: update the Status column in this index, append a `DEVLOG.md` entry, move to next ticket.
