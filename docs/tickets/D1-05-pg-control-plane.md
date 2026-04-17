# D1-05 Primer: Remaining Postgres control-plane tables (Drizzle)

**For:** Fresh session landing the PG control-plane table suite
**Project:** bematist (DevMetrics)
**Workstream:** D (Storage & Schema)
**Date:** 2026-04-17 (planned)
**Previous work:** `D1-00`. Independent of `D1-02`/`D1-03` (CH-side). `D1-04` may need `erasure_requests` — coordinate ordering. See `docs/DEVLOG.md`.

---

## What Is This Ticket?

Landing the 13 remaining Postgres control-plane tables listed in contract 09 §Tables via Drizzle ORM migrations. M0 has `orgs`/`users`/`developers`; this ticket adds `repos`, `policies`, `git_events`, `ingest_keys`, `prompt_clusters`, `playbooks`, `audit_log`, `audit_events`, `erasure_requests` (unless `D1-04` lands it first), `alerts`, `insights`, `outcomes`, `embedding_cache`.

### Why It Matters

- Every downstream workstream that writes to PG (C ingest, E dashboard, G redaction side log, H scoring, I audit) needs these tables — unblocks parallel work.
- Contract 09 §Tables is authoritative for ownership + read/write roles; this ticket is pure schema, no business logic.
- Sets up the surface that `D1-06` enforces RLS on.

---

## What Was Already Done

- `packages/schema/postgres/schema.ts` has `orgs`, `users`, `developers` (M0).
- `packages/schema/postgres/migrations/0000_premium_shaman.sql` is the M0 baseline.
- Drizzle-kit configured in `packages/schema/postgres/drizzle.config.ts`.
- `bun run db:migrate:pg` works without env prefix (D1-00).

---

## What This Ticket Must Accomplish

### Goal

All 13 tables from contract 09 §Tables exist in Postgres, typed in `schema.ts`, with Drizzle migrations up + down, applied via `bun run db:migrate:pg`.

### Deliverables Checklist

#### A. Implementation

Per-table notes in `contracts/09-storage-schema.md` §Tables + §"Per-table contracts that cross workstreams". Each gets a `pgTable` definition in `packages/schema/postgres/schema.ts` with:

- [ ] **`teams`** — `(id, org_id, name, created_at)` — **scope addition per D1-02 design** (2026-04-17). `team_weekly_rollup` MV depends on `dev_team_dict` CH dictionary which sources from `developers.team_id`, which needs a `teams` table to FK to. Not in original contract 09 §Tables; add via additive changelog entry.
- [ ] **Add `developers.team_id`** — `uuid REFERENCES teams(id)` NULL for unassigned devs. Self-declared per D1-02 design D3.
- [ ] `repos` — `(id, org_id, repo_full_name_hash, provider, created_at)` — `repo_id_hash = HMAC(repo_full_name, tenant_salt)` per contract 09 open question 2.
- [ ] `policies` — `(org_id PK, tier_default, redaction_overrides_json, tier_c_signed_config, tier_c_activated_at)` — per-org redaction overrides + tier config.
- [ ] `git_events` — denormalized mirror written by C; joined to CH events by `commit_sha`.
- [ ] `ingest_keys` — `(id, org_id, key_prefix, hashed_secret, created_by, created_at, revoked_at)` — `dm_<orgId>_<rand>` records.
- [ ] `prompt_clusters` — `(id, org_id, centroid FLOAT4[], dim, model, label, created_at)` — H's nightly cluster job writes centroids.
- [ ] `playbooks` — `(id, org_id, session_id, abstract, outcome_metrics_json, promoted_by, promoted_at, takedown_requested_at)` — D31 Team Impact source.
- [ ] `audit_log` — `(id, ts, actor_user_id, action, target_type, target_id, reason, metadata_json)` — append-only, no UPDATE/DELETE trigger.
- [ ] `audit_events` — `(id, ts, actor_user_id, target_engineer_id_hash, surface, session_id_hash)` — D30 per-manager-view row.
- [ ] `erasure_requests` — see `D1-04`; land here if D1-04 hasn't.
- [ ] `alerts` — `(id, ts, org_id, kind, signal, value, threshold, dev_id_hash)` — anomaly detector writes.
- [ ] `insights` — `(id, ts, org_id, team_id, week, body_json, confidence)` — Insight Engine writes weekly.
- [ ] `outcomes` — `(id, ts, org_id, engineer_id, kind, pr_number, commit_sha, session_id, ai_assisted)` — webhook + trailer parser writes.
- [ ] `embedding_cache` — per contract 05 §Postgres canonical — `(cache_key PK, provider, model, dim, vector FLOAT4[], created_at, last_hit_at, hit_count)`.

- [ ] **Append-only trigger on `audit_log`:** PostgreSQL trigger + RULE to raise exception on UPDATE/DELETE (contract 09 invariant 6).
- [ ] Indexes per access pattern — at minimum `(org_id, ts)` on audit_log / audit_events / alerts / insights; `last_hit_at` on embedding_cache.

#### B. Tests

- [ ] Per-table smoke test: INSERT + SELECT round-trip.
- [ ] `audit_log` immutability test: UPDATE raises, DELETE raises.
- [ ] Migration down-test (CLAUDE.md rule): every migration has `down` + CI verifies it succeeds against a real PG instance.
- [ ] Foreign key tests: inserting a row with a non-existent `org_id` rejects.
- [ ] `embedding_cache` uniqueness test: duplicate `cache_key` rejects with `ON CONFLICT (cache_key) DO UPDATE SET hit_count = hit_count + 1` upsert path.

#### C. Integration Expectations

- [ ] Schema matches contract 09 §Per-table contracts exactly — coordinate with Workstream C if their ingest code assumes different column names.
- [ ] `org_id` is the same string everywhere (CH uses LowCardinality(String); PG uses UUID — `org_id` in CH is `uuid::text`; document the boundary).
- [ ] `engineer_id` same string in both DBs (contract 09 §CH↔PG §2).
- [ ] No JOINs across CH ↔ PG (contract 09 invariant 5) — denormalize at write.
- [ ] RLS NOT enforced in this ticket — that's `D1-06`. Leave ALTERs for the next PR so reviewers can read them together.

#### D. Documentation

- [ ] DEVLOG entry
- [ ] Tickets README ✅
- [ ] Contract 09 changelog: "control-plane tables landed via migration 000X"
- [ ] No contract 09 schema change — we're implementing it, not editing it

---

## Branch & Merge Workflow

```bash
git switch main && git pull
git switch -c D1-05-pg-control-plane-jorge

# Drizzle-kit workflow:
bun --filter='@bematist/schema' drizzle:generate
# review generated SQL, commit, then:
bun run db:migrate:pg

# TDD: write per-table tests first, then iterate schema.ts

bun run lint && bun run typecheck && bun run test
git push -u origin D1-05-pg-control-plane-jorge
gh pr create --base main \
  --title "feat(schema): 13 Postgres control-plane tables (D1-05)" \
  --body "Refs #3"
```

---

## Important Context

### Files to Modify

| File | Action |
|------|--------|
| `packages/schema/postgres/schema.ts` | Add 13 table definitions |
| `packages/schema/postgres/migrations/0001_*.sql` (drizzle-generated) | New migration |
| `packages/schema/postgres/migrations/meta/_journal.json` | Auto-updated |
| `docs/DEVLOG.md` | Append |
| `docs/tickets/README.md` | ✅ |

### Files to Create

| File | Why |
|------|-----|
| `packages/schema/postgres/audit_log_triggers.sql` | UPDATE/DELETE prevention trigger |
| `packages/schema/postgres/__tests__/audit_log.test.ts` | Immutability test |
| `packages/schema/postgres/__tests__/*.test.ts` | Per-table smoke tests (≥13) |

### Files You Should NOT Modify

- `0000_premium_shaman.sql` — M0 migration, don't edit
- ClickHouse migrations — out of scope here
- `apps/ingest/`, `apps/worker/` — schema consumers; ingest writes land in other workstreams

### Files You Should READ for Context

| File | Why |
|------|-----|
| `contracts/09-storage-schema.md` §Postgres + §Per-table contracts | Authoritative table list + shapes |
| `contracts/05-embed-provider.md` §Postgres | `embedding_cache` canonical shape |
| `CLAUDE.md` "Database Rules" §Postgres | RLS + migration conventions |
| `dev-docs/PRD.md` §5.3, D8, D30 | Audit + erasure + PG ORM decisions |

---

## Architectural Decisions

| Decision | Reference | Summary |
|----------|-----------|---------|
| ORM | Tech Stack | Drizzle ORM — single source; migrations auto-generated. |
| `audit_log` immutability | Inv. 6 | DB-level trigger; app code can't UPDATE/DELETE even with bugs. |
| `repo_id_hash` | Open Q 2 | HMAC(repo_full_name, tenant_salt) — cross-tenant collision unobservable. |
| RLS | — | Scoped to `D1-06`; keep this PR focused on shape. |

---

## Suggested Implementation Pattern

```ts
// packages/schema/postgres/schema.ts (excerpt)
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actor_user_id: uuid("actor_user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  target_type: text("target_type").notNull(),
  target_id: text("target_id").notNull(),
  reason: text("reason"),
  metadata_json: jsonb("metadata_json").notNull().default(sql`'{}'::jsonb`),
});
```

```sql
-- packages/schema/postgres/audit_log_triggers.sql
CREATE OR REPLACE RULE audit_log_no_update AS
  ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_log_no_delete AS
  ON DELETE TO audit_log DO INSTEAD NOTHING;
-- Belt + suspenders: also add a trigger that RAISE EXCEPTION for error visibility
CREATE OR REPLACE FUNCTION audit_log_prevent_mutate()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only — UPDATE/DELETE forbidden';
END $$;
CREATE TRIGGER audit_log_no_mutate_trg
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutate();
```

---

## Edge Cases to Handle

1. **`org_id` type mismatch across DBs.** PG uses `uuid`; CH uses `LowCardinality(String)`. Document in `packages/schema/README.md` (create if missing) that the boundary is `uuid::text`.
2. **Drizzle + `FLOAT4[]` for embeddings.** Drizzle supports this via `real().array()`. Verify migration SQL generates `REAL[]`, not `FLOAT[]`.
3. **Migration atomicity.** 13 tables in one migration is fine — Drizzle wraps in transaction. If one fails, rollback.
4. **`jsonb` vs `json`.** Use `jsonb` for all JSON columns — indexable, canonical.

---

## Definition of Done

- [ ] 13 tables exist in schema.ts + migration applied
- [ ] `audit_log` immutability enforced (UPDATE/DELETE raise)
- [ ] Every migration has down; CI tests down
- [ ] Per-table smoke tests pass (≥15 tests)
- [ ] `bun run test` / `typecheck` / `lint` green
- [ ] Contract 09 changelog
- [ ] DEVLOG entry
- [ ] Tickets README ✅
- [ ] Branch pushed, PR `Refs #3`

---

## Estimated Time

| Task | Estimate |
|------|----------|
| Schema.ts — 13 tables | 2 h |
| Drizzle generate + review + tweak | 45 min |
| audit_log triggers | 30 min |
| Per-table tests (TDD) | 3 h |
| Docs + DEVLOG | 15 min |

~6–7 h.

---

## After This Ticket: What Comes Next

- **D1-06** (RLS + INT9) — enforces tenant isolation on every org-scoped table landed here. Merge blocker.
- Unblocks C (ingest writes), E (dashboard reads), H (scoring writes centroids + insights), I (audit reads).
