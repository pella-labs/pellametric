# M3 Gate — Follow-ups carried from M2

> **Status:** M2 merged on `main` 2026-04-18 (commits up to PR #54 + #45).
> **Source of truth for M2 work:** `dev-docs/m2-gate-agent-team.md` (historical plan).
> **This doc:** the punch-list of work that was scoped out of M2 but is required to ship the platform end-to-end against a real multi-tenant team.

## How to pick up this work in a fresh Claude Code session

```
read dev-docs/m3-gate-followups.md and CLAUDE.md, then start with item 1 (Better Auth → tenant binding).
spawn a worktree-isolated agent for the work, follow the same standard preamble pattern as dev-docs/m2-gate-agent-team.md §7,
open a PR, do not merge.
```

The standard preamble in `dev-docs/m2-gate-agent-team.md` §7 still applies (read CLAUDE.md / PRD / contracts; isolated worktree; commit trailer; do not merge).

## Why these were deferred from M2

Each item was either out of an M2 agent's `OWNS` scope, blocked on a parallel workstream, or surfaced during the perf-gate CI debugging after the planned 16-agent fan-out had already merged. None of them block the M2 gate definition (`WORKSTREAMS.md` §M2); all of them block the **5-engineer team demo** scenario.

## The list (priority order)

### 1. Better Auth → tenant binding · **load-bearing for everything else**

**Problem:** `apps/web/lib/session.ts:getSessionCtx` synthesizes `tenant_id: "dev-tenant"` (string) in non-prod and **throws in prod** ("blocked on apps/ingest Better Auth handoff"). Postgres `teams.org_id::uuid` rejects `"dev-tenant"` → every `/teams` request 500s against the real stack. This is why #45's perf gate ships warn-only.

**Required:**
- Wire Better Auth session cookie validation in `apps/web/lib/session.ts` production branch.
- Derive `tenant_id` from `users.org_id` (UUID), `actor_id` from `users.id`, `role` from `users.role`.
- Reveal-token path: pull from Redis `reveal:<token>` when request header carries one (existing TODO in `getSessionCtx`).
- Dev fallback: read `BEMATIST_DEV_TENANT_ID` env so docker-compose dev stack can pin to a real seeded UUID.
- Update `packages/fixtures/seed/run.ts` to optionally write its target org's UUID to a known location for dev/perf use.

**Acceptance:** flip `K6_GATE_M2=1` in `.github/workflows/perf.yml` and the perf workflow goes green end-to-end with dashboard p95 < 2s and ingest p99 < 100ms on the seeded 600k–1M event corpus.

**Files:** `apps/web/lib/session.ts`, `apps/web/lib/db.ts` (already wired by #52), `apps/ingest/src/auth/`, `packages/fixtures/seed/run.ts`, `.github/workflows/perf.yml`.

---

### 2. Server-side redaction wired into ingest hot path · **MERGE BLOCKER status from PRD**

**Problem:** `packages/redact` ships a 98.8%-recall TruffleHog+Gitleaks+Presidio engine (PR #47), but A6 deferred the `apps/ingest/src/index.ts` boot swap that calls `runRedact({stage: realStage})` on every event. A6's PR comment: "one-liner for follow-up." Until this lands, the ingest accepts events at Tier B/C without server-side redaction — defense-in-depth gap.

**Required:**
- Inject `redactStage` from `packages/redact` into the ingest event-write path (`apps/ingest/src/wal/append.ts` or `apps/ingest/src/server.ts` — see contract 08).
- ClickHouse `redaction_audit` DDL — table doesn't exist yet on main; should match the shape in `contracts/09`.
- Migration in `packages/schema/clickhouse/migrations/0010_redaction_audit.sql`.
- Increment `redaction_count` per hit; insert `redaction_audit` row.

**Acceptance:** privacy adversarial gate (#51) still passes; new integration test asserts a Tier-A event with seeded secrets gets `<REDACTED:type:hash>` markers and an `redaction_audit` row.

**Files:** `apps/ingest/src/wal/append.ts` (or wherever the write path is), `packages/schema/clickhouse/migrations/0010_redaction_audit.sql`, `tests/privacy/adversarial/`.

---

### 3. Ed25519 policy-flip HTTP route + Drizzle store wiring

**Problem:** A14 (#43) shipped the `signed-config` validator + cooldown + audit-row shape (D20). The HTTP route (`apps/ingest/src/policy-flip/`) and Drizzle persistence to `policies.tier_c_signed_config` / `tier_c_activated_at` columns (already on the schema from PR #34) were intentionally deferred — would have touched `apps/ingest/src/index.ts` outside A14's OWNS.

**Required:**
- `POST /v1/admin/policy-flip` route handler in `apps/ingest/src/index.ts`.
- Drizzle write to `policies` updating tier + activated_at; insert `audit_log` row; insert `alerts` row for IC banner.
- SSE push so connected dashboards see the banner immediately.
- Pinned-public-key set already wired via `SIGNED_CONFIG_PUBLIC_KEYS` env (handled in `packages/config/src/signed-config.ts`).

**Acceptance:** integration test: signed payload → 200 + audit row + alert row + tier flips; tampered → 401; cooldown active → 403 with `retry_after_ms`.

**Files:** `apps/ingest/src/index.ts`, `apps/ingest/src/policy-flip/handler.ts` (already in A14's PR — needs the boot wiring).

---

### 4. Real-branch SQL on `pr_outcome_rollup` / `commit_outcome_rollup`

**Problem:** A19 noted that `packages/api/src/queries/outcomes.ts:perPROutcomes` and `perCommitOutcomes` target MVs (`pr_outcome_rollup`, `commit_outcome_rollup`) that aren't materialized yet. Sandesh's outcomes pipeline (Workstream H-outcomes) ships those.

**Required:**
- Materialize the MVs in `packages/schema/clickhouse/migrations/`.
- Update the queries to use the right `*Merge` calls per the AggregateFunction state columns.
- Wire into `/dashboard/outcomes` real-branch render.

**Acceptance:** `/dashboard/outcomes` returns 200 with non-zero data when seeded against the perf corpus.

---

### 5. Ingest `realWriter.ts` ISO8601 timestamp forwarding

**Problem:** A17 documented (#50) that `apps/ingest/src/wal/append.ts#canonicalize` forwards ISO8601 `ts` verbatim to ClickHouse, which rejects it on `DateTime64` with `CANNOT_PARSE_INPUT_ASSERTION_FAILED`. A17 worked around this in the test/smoke writer by setting `clickhouse_settings.date_time_input_format='best_effort'`. The permanent fix belongs in `apps/ingest/src/clickhouse/realWriter.ts`.

**Required:**
- Either set `date_time_input_format='best_effort'` on the realWriter's CH client config, or transform ISO8601 → `'YYYY-MM-DD HH:MM:SS.fff'` at canonicalization time.

**Files:** `apps/ingest/src/clickhouse/realWriter.ts` (or wherever the writer client is constructed).

---

### 6. Distro packages + signed release pipeline

**Problem:** `.github/workflows/release.yml` exists but per CLAUDE.md §11 the canonical install path is `brew install bematist` / `apt install bematist` / AUR / Choco — primary channels with Sigstore + cosign + SLSA L3 attestation. Need to verify the release workflow actually produces those artifacts on tag push.

**Required:**
- Audit `release.yml` against PRD §11 and the CLAUDE.md distribution rules.
- Add Homebrew formula tap, Debian repo, AUR PKGBUILD, Chocolatey package.
- Verify `cosign verify` works on a release artifact.

**Acceptance:** a developer can `brew install bematist && bematist install && bematist dry-run` against a self-hosted ingest and see events flow without building from source.

---

### 7. 24-hour Bun↔ClickHouse soak (F15 / INT0)

**Problem:** CLAUDE.md §Testing Rules requires a 24h sustained 100 evt/s soak with no flakes (or Plan B Go side-car ready). The `apps/ingest-sidecar/` skeleton is on main from Jorge's earlier work, but the actual soak harness + result hasn't been initiated.

**Required:**
- Run the soak (or document Plan B readiness) at the M2 tag.
- Capture the results in `dev-docs/soak-result-m2.md`.

---

## Quick state check for a fresh session

```bash
# What's the current main HEAD?
git log --oneline -3

# Are all M2 PRs merged? (should see #35-54 + #45)
gh pr list --state merged --base main --limit 30

# Is main healthy?
bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run test

# Privacy gate should be 5/5 green
bun run test:privacy

# Scoring gate
bun run test:scoring
```

If everything above passes, M2 is intact and you can pick up M3 follow-up #1.
