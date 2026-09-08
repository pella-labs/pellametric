# Pellametric Insights Revamp — PRD

> **Orchestrator-ready.** Build manifest at `dev-docs/build/`. The PRD describes the destination; the manifest describes the atomic tasks a swarm of subagents executes. Wall-clock estimates have been removed — execution time depends on subagent fan-out, not engineering weeks. See `dev-docs/build/01-overview-and-hotpaths.md` for the parallelism DAG and hot-path reference code.

> Phased implementation plan derived from `dev-docs/presearch.md`. All 33 challenger patches are sequenced into specific phases. Read presearch.md for context; this document is the build manifest.
>
> Branch: `feat/insights-revamp`. Mode: REVISION.

---

## Phase dependency map

```
Phase 1  Foundations: schema + pricing table + monitoring scaffolding
  └── Phase 2  Lineage core: GitHub App webhook + pr_commit + session_pr_link populator
       ├── Phase 3  Rollups: daily_user_stats, daily_org_stats, cost_per_pr
       │      └── Phase 7  Cohort + benchmark + waste + intent (parallel w/ 5)
       └── Phase 4  Design system + split routes + manager Overview/PRs/PR Detail
              └── Phase 5  Dev Sankey lineage + session detail (server-decrypt)
                     └── Phase 6  Two-tier OAuth/App fallback + non-App banners
                            └── Phase 8  Polish: mobile, motion, a11y, mockups → prod
```

Phases 3 and 4 can run in parallel after Phase 2. Phase 7 can start once Phase 3 + 5 are done.

---

## Phase 1 — Foundations: schema + pricing + monitoring

**Atomic tasks**: see `dev-docs/build/02-phase-1-2-tasks.md` tasks T1.1 through T1.12.

**Goal:** Land all schema additions, pricing table, and monitoring scaffolding before any lineage code is written. Reversible — none of these add behavior, only data shape.

**Depends on:** none.

**Patches addressed:** P2, P5, P7, P9, P11, P14, P15, P16, P20, P22, P29.

### Requirements
- [ ] Add `model_pricing` table (P7) with seed data for current Claude/Codex models.
- [ ] Add to `pr` table: `mergeCommitSha`, `baseBranch`, `headBranch`, `lastSyncedAt`, `linkComputedAt`, `kind` (default `'standard'`), `revertsPrId`, `stackedOn`.
- [ ] Indexes: `pr_by_merged_at` partial on `(orgId, mergedAt DESC) WHERE state='merged'`; `pr_by_head_branch` on `(orgId, repo, headBranch)`.
- [ ] Create `pr_commit` table with `kind` discriminator (P2), `aiSources text[]` (P6), `message ≤1024 chars`, `messageRedacted boolean` (P20), and indexes `pr_commit_uniq`, `pr_commit_by_org_author`, `pr_commit_by_org_ai`. **Do NOT add `byEmail`** (P29).
- [ ] Add to `session_event`: `branch text` (P9), `cwdResolvedRepo text` (P14).
- [ ] Enrich `session_pr_link`: `fileJaccard`, `timeOverlap`, `branchMatch`, `confidenceScore`, `confidence`, `confidenceReason`, `linkSource`, `updatedAt` + new index `link_by_confidence`.
- [ ] Add to `org`: `aiFooterPolicy text default 'optional'`.
- [ ] Create `lineage_job` table (P15) with `(status, scheduledFor)` and `(prId)` indexes.
- [ ] Create `system_health` table (P16) with `(component)` unique key.
- [ ] Create `daily_user_stats`, `daily_org_stats`, `cost_per_pr` tables — **tokens only, no dollar columns** (P7). Add `priceVersion integer` to `cost_per_pr`.
- [ ] Env: add `INTERNAL_API_SECRET`, `INTERNAL_API_SECRET_PREVIOUS` (rotation), `GITHUB_APP_WEBHOOK_SECRET` (P22).
- [ ] Add `cohort_query_log` table: `(managerId text, orgId uuid, metric text, cohortHash text, memberIds text[], queriedAt timestamp)` with index `(managerId, queriedAt)`. Consumed by Phase 7 intersection guard (P19).
- [ ] Add `backfill_state` table: `(orgId uuid PRIMARY KEY, lastDay text, lastPrId uuid nullable, status text, startedAt timestamp, updatedAt timestamp)`. Consumed by Phase 3 backfill script + Phase 6 install backfill.
- [ ] Add `user.useCursor boolean not null default false` to the existing better-auth `user` table via Drizzle `additionalFields` pattern (mirrors `githubLogin`/`githubId`). Consumed by Phase 5 P31 opt-in.
- [ ] Update `apps/web/lib/db/schema.ts`, run `bun run db:push`.
- [ ] Update `packages/shared` if any wire types change (`IngestSession` now optionally includes `branch`, `cwdResolvedRepo`).

### Tests (≥15)
- `apps/web/lib/__tests__/schema-shape.test.ts` — Drizzle compiles; each new column has expected default.
- `apps/web/lib/__tests__/model-pricing.test.ts` — seed loads; `priceFor(model, ts)` returns active row for timestamp.
- `apps/web/lib/__tests__/cost-from-tokens.test.ts` — compute cost from tokens + pricing snapshot; mixed-model session sums correctly; cache-read/write priced separately.
- `apps/web/lib/__tests__/redaction.test.ts` — AWS key, `ghp_`, high-entropy strings redacted; benign commits untouched; truncation at 1024 chars.
- Verify all new indexes exist on a real PG instance.

### Data safety (non-negotiable)
- [ ] `pg_dump` snapshot taken BEFORE first `db:push` (T1.12a). Snapshot path recorded in commit body.
- [ ] Drizzle-kit dry-run inspected (T1.12b). Proposed SQL contains ONLY `CREATE TABLE`, `ALTER TABLE … ADD COLUMN` (nullable or with DEFAULT), and `CREATE INDEX`. Any `DROP`, `RENAME`, `ALTER COLUMN … TYPE`, `ALTER COLUMN … SET NOT NULL` (without DEFAULT), or `TRUNCATE` is a STOP.
- [ ] Post-push row counts on `session_event`, `pr`, `prompt_event`, `user`, `org` match pre-push baseline exactly. No row loss.

### Acceptance
- `bun run typecheck && bun run test` green.
- `psql … -c "\d pr_commit"` shows the right columns + indexes (no `byEmail`).
- `system_health` insertable; `lineage_job` insertable with priority sorting verified.

---

## Phase 2 — Lineage core: webhook + pr_commit + linker

**Atomic tasks**: see `dev-docs/build/02-phase-1-2-tasks.md` tasks T2.0 through T2.14 (T2.0 = fixture creation, sub-tasks T2.0a..T2.0f — see `dev-docs/fixtures/README.md`).

**Goal:** Wire the GitHub App webhook, hydrate `pr_commit` with pre-squash commits, populate `session_pr_link` for merged PRs. Worker runs end-to-end on a real merged PR.

**Depends on:** Phase 1.

**Patches addressed:** P1, P3, P4, P6, P8, P10, P13, P15, P16, P21, P22, P30, P31, P32.

### Requirements
- [ ] Implement `POST /api/github-webhook` (no `[orgId]` param — resolves org by `installation.id`, P22). Verify `X-Hub-Signature-256` with `GITHUB_APP_WEBHOOK_SECRET`.
- [ ] Handle event types: `pull_request` (`opened`, `synchronize`, `closed`), `pull_request_review`, `push`, `installation`, `installation_repositories`. Each handler is small + tested.
- [ ] On `opened` / `synchronize`: hydrate `pr_commit` rows with `kind='commit'` from `GET /pulls/{n}/commits` + `/pulls/{n}/files` (P1). Use GraphQL where it's a single query (research §C).
- [ ] Force-push detection (P3): compare `before` not-ancestor-of `after` → wipe `pr_commit WHERE prId AND kind='commit'`, re-hydrate.
- [ ] Synchronize dedup (P30): coalesce events for the same PR within a 60s window; only the last triggers hydration.
- [ ] Apply commit attribution heuristics (final patched table — challenger §C). `aiSources` is `text[]` (P6); Anthropic email alone gets +30 unknown (P8); bots get terminal `aiSource='bot'` (P4); session-join inference for Codex (P32) and opt-in Cursor (P31).
- [ ] Update `parsers/repo.ts` in collector (P13): follow `gitdir:` indirection for worktrees; walk to outermost `.git/config` for submodules.
- [ ] Collector populates `sessionEvent.branch` from `git rev-parse --abbrev-ref HEAD` (P9) and `cwdResolvedRepo` (P14) on session start.
- [ ] Implement `POST /api/internal/lineage/run { prId }` gated by `INTERNAL_API_SECRET` (accepts both current and `_PREVIOUS` for rotation).
- [ ] Lineage algorithm exactly per presearch §2.4: 5-signal weighted score, `cwdResolvedRepo` gate, rename-aware Jaccard (P10), 0.10 threshold exception when authorship+cwd both pass.
- [ ] Enqueue `lineage_job` rows (P15) on ingest for late-arriving sessions and on webhook events for newly-merged PRs.
- [ ] Worker writes `system_health` heartbeat per run (P16).
- [ ] `POST /api/internal/lineage/sweep` cron route: drains `lineage_job` by priority, cap N=500/invocation, then runs full reconciliation as safety net.
- [ ] Railway cron config: hit `/api/internal/lineage/sweep` every 30 minutes.
- [ ] `GET /api/health/lineage` returns 503 if heartbeat >90 min stale (P16).
- [ ] `requireMembership(userId, orgSlug)` middleware lifted to `apps/web/lib/auth-middleware.ts` (P21). Used by every insights endpoint going forward.

### Tests (≥20)
- Webhook signature: valid HMAC accepted; invalid rejected; missing rejected.
- `kind='commit'` rows hydrated for an `opened` event with N commits.
- `synchronize` with force-push (mocked ancestry check) wipes + rehydrates.
- `synchronize` storm: 10 events in 60s coalesce to 1 hydration call.
- Squash-merge fixture: pre-squash commits retained as `kind='commit'`; merge commit stored as `kind='squash_merge'`; attribution computed only from `commit` kind.
- Heuristic: `Co-Authored-By: Claude` trailer → `aiSources=['claude']` confidence ≥60.
- Heuristic: Anthropic email alone → `aiSources=['unknown']` (NOT claude), confidence 30 (P8).
- Heuristic: `dependabot[bot]` author → `aiSources=['bot']` terminal (P4).
- Heuristic: Cursor + Claude trailers both present → `aiSources=['claude','cursor']` (P6).
- Lineage formula: cwd-mismatch → score×0; cwd-unknown → score×0.6 (P13).
- Lineage: rename PR (`previous_filename` present) → Jaccard recomputed against old+new path union (P10).
- Lineage: low-conf link with `cwdMatch+authorship=true` written at threshold 0.10 not 0.15.
- `lineage_job` queue: enqueue, priority sort, drain-by-status, retry-on-failure.
- `requireMembership`: non-member returns 403; member with wrong role returns 403; manager passes.
- `system_health` heartbeat: worker writes; `/api/health/lineage` returns 503 when stale.

### Acceptance
- Real merged PR on a test repo with `Co-Authored-By: Claude` trailer ends up in `session_pr_link` with `confidence='high'` and `aiSources=['claude']` within <30 seconds of merge.
- Force-pushing the PR triggers `pr_commit` rehydration; counts in DB match `/pulls/{n}/commits` exactly.
- `lineage_job` queue drains under load; no rows stuck `pending` longer than the next sweep window.

---

## Phase 3 — Rollups: daily stats + cost_per_pr

**Atomic tasks**: see `dev-docs/build/03-phase-3-4-5-tasks.md` tasks T3.1 through T3.8.

**Goal:** Replace in-memory aggregation hot path with persisted rollups. Webhook + ingest incrementally update; full reconciliation at 02:00 UTC.

**Depends on:** Phase 1 (schema), Phase 2 (webhook + linker).

**Patches addressed:** P5, P6, P7, P12.

### Requirements
- [ ] Implement `refreshDailyUserStats(userId, orgId, daysTouched: string[])` (incremental). Called by ingest and by lineage worker.
- [ ] **UTC date-boundary split (P12):** when a session crosses midnight UTC, prorate `activeHoursCenti`, `messages`, `errors`, `teacherMoments`, `frustrationSpikes` across every day touched. Tokens count once on `startedAt` day (already integer; don't split).
- [ ] Implement `refreshDailyOrgStats(orgId, day)` reading from `daily_user_stats` + `pr` + `pr_commit`.
- [ ] **Revert exclusion (P5):** `prsMerged` and `prsMergedAiAssisted` exclude `pr.kind='revert'`. Add `prsMergedBot` and `prsReverted` columns. Add `revertRate` derived in queries.
- [ ] Implement `refreshCostPerPr(prId)`:
  - Sum tokens across linked sessions where `confidence ∈ {high, medium}` (drop `low`).
  - Compute `pctClaude/pctCodex/pctCursor/pctHuman/pctBot` from `pr_commit` rows where `kind='commit'` using `aiSources` array (multi-source counts toward each).
  - Store `priceVersion = max(model_pricing.id used)`. Dollar amount computed at read time via `priceFor()` helper (P7).
- [ ] **Stacked PR cost adjustment (P11):** parent's `cost_per_pr` subtracts sessions already attributed to children (`pr.stackedOn = parent.id`).
- [ ] `apps/web/scripts/backfill-daily-stats.ts` one-shot migration:
  - Iterates orgs, batches by day, rate-limited.
  - Writes progress to `backfill_state(orgId, lastDay, status)`.
  - Resumable on partial failure.
- [ ] Wire backfill into Railway one-off task; document in README.

### Tests (≥15)
- Date-boundary fixture: session 23:50–00:20 UTC contributes to both days proportionally.
- Daily stats: incremental upsert is idempotent (calling twice produces same row).
- `cost_per_pr` with multi-source commits sums percentages to 100 ±1.
- `cost_per_pr` for stacked PR subtracts child session tokens; assert parent total = (total - children).
- Revert PR not counted in `prsMerged`; counted in `prsReverted`; `revertRate` query returns expected ratio.
- `priceFor(model, ts)` returns the correct historical row when pricing changes mid-month.
- Backfill: partial failure resumes from `backfill_state.lastDay`.

### Acceptance
- 30-day backfill on a 5k-session dev fixture completes in <60s.
- Manager dashboard query `getCostPerPrForOrg(orgId, 30d)` returns in <50ms p95.

---

## Phase 4 — Design system + manager Overview/PRs/PR Detail

**Atomic tasks**: see `dev-docs/build/03-phase-3-4-5-tasks.md` tasks T4.1 through T4.14.

**Goal:** Split routes ship. Manager has Overview, PR list, PR detail. Design system tokens land. First demo-ready slice.

**Depends on:** Phase 3 (data is in `cost_per_pr`).

**Patches addressed:** P5 (UI), P17, P22, P24, P25, P26, P27, P28.

### Requirements
- [ ] Add to `apps/web/app/globals.css`:
  - `--source-claude #c08a4f`, `--source-codex #6fa3b8`, `--source-cursor #b07ec0`, `--source-human #8a8a82`, `--conf-high/med/low`, `--chart-grid`, `--chart-axis`.
  - `.mk-stat-numeric`, `.mk-table-cell` component classes.
- [ ] Add Visx: `bun add @visx/sankey @visx/xychart @visx/scale @visx/shape @visx/group`.
- [ ] Create shared layout `apps/web/app/org/[provider]/[slug]/layout.tsx` (P28) with: nav rail (Overview / PRs / Devs / Waste / Intent / Benchmark / Members / Policy), org switcher, breadcrumb slot, role switcher (P26).
- [ ] Restructure: move existing `page.tsx` content into `(overview)/page.tsx`. Existing `members/`, `invite/`, `policy/` continue to work as siblings (verified — `(group)` is sibling-scoped).
- [ ] Implement `/org/[provider]/[slug]/(overview)/page.tsx` per design council mock M1: 4 stat tiles (Cost-per-PR, Spend, Merged PRs, Waste%) + scatter quadrant (Visx `xychart`) + attribution-mix stacked bar.
- [ ] Implement `/org/[provider]/[slug]/prs/page.tsx` per mock M2: sortable cost-per-PR table with `confidence` 3-pip, source-mix bars, sticky header, virtualized for >100 rows.
- [ ] Implement `/org/[provider]/[slug]/prs/[number]/page.tsx` per mock M3: attribution bar hero + linked sessions table + revert detection banner (P5) ("Reverted by #N" or "Reverts #M").
- [ ] **Two-tier `getPrsForOrg(orgId)` helper (P17):** App-installed → reads from `pr`/`cost_per_pr`; OAuth-only → falls back to `lib/gh.ts` `prAggForMember`. Same return shape. Banner CTA in non-App overview: "Install GitHub App for full features (cost-per-PR, attribution, lineage)."
- [ ] Delete `apps/web/components/org-view-switcher.tsx` BUT keep `?view=me` 301 redirect shim for one release (P27). Add `next.config.js` redirect entry for permanent cases.
- [ ] Role switcher component (P26) in nav: cookie-persisted `pellametric_view` (`org` | `me`). Toggles between `/org/.../(overview)` and `/me/.../(overview)` for same slug.
- [ ] Sankey scale fallback (P24): library-level constant `SANKEY_MAX_BUCKETS=8`; if computed buckets >8, render as stacked column chart.
- [ ] Mobile breakpoints (P25): apply Tailwind v4 responsive classes per design council §6.6. Below 380px, render desktop-recommended screen with escape-hatch button.
- [ ] Convert `apps/web/components/team-tables.tsx` into `components/data/data-table.tsx` (generic, sortable, sticky) and use across PRs / Devs / Waste tables.

### Tests (≥15 + UI)
- `getPrsForOrg`: returns App-path shape for org with installation; falls to OAuth path otherwise; same outer shape.
- Visx Sankey: 8-bucket cap enforced; falls to stacked column at 9+ buckets.
- 3-pip confidence indicator: pip count matches confidence string.
- Role switcher cookie persists across pages.
- `?view=me` deep link redirects to `/me/.../(overview)`.
- Mobile: <600px renders PR card list, not table.
- Accessibility: keyboard nav (g+o, g+p chord) works; tab order through PR row → drill-in.
- Manual: load on a real org with 50+ PRs; manager overview p50 <800ms.

### Acceptance
- Manager opens Overview → sees cost-per-PR ▼ trend, scatter of devs, attribution mix.
- Clicks a PR → sees attribution bar, linked sessions table, revert notice if applicable.
- Manager-also-dev toggles to `/me/...` → see Phase 5 skeleton (no data yet).
- Old `?view=me` URL redirects cleanly.
- Lighthouse a11y ≥95 on Overview, PR list, PR detail.

---

## Phase 5 — Dev Sankey lineage + session detail

**Atomic tasks**: see `dev-docs/build/03-phase-3-4-5-tasks.md` tasks T5.1 through T5.9.

**Goal:** Personal view ships. Sankey hero answers "where did my tokens go?" Dev can drill into a session and read their own prompts (server-decrypted).

**Depends on:** Phase 2 (linker), Phase 3 (rollups), Phase 4 (design system).

**Patches addressed:** P18, P24, P31.

### Requirements
- [ ] Create `app/me/[provider]/[slug]/layout.tsx` (same shell pattern as Phase 4).
- [ ] `/(overview)/page.tsx` per mock M4: 4 personal tiles + Sankey hero (session → commit → PR).
  - Bands carry `--source-*` color.
  - Width = `tokensOut`.
  - 8-bucket cap (P24).
  - Hover dims non-traversed bands to 20%.
  - Click PR node → `/me/.../prs/[number]` (dev's PR view, not manager's).
- [ ] `/sessions/page.tsx`: filterable list by intent/source.
- [ ] `/sessions/[id]/page.tsx` per mock M5: session header, linked PR with confidence, files touched, prompts column.
- [ ] **Server-side prompt decryption (P18):** `GET /api/me/sessions/:id/prompts`.
  - Verifies `session.userId === row.userId` (also from `promptEvent.userId`).
  - Rate-limit 60/min per user.
  - Response `Cache-Control: no-store`.
  - Returns `{ prompts: [{ tsPrompt, text, wordCount }], responses: [...] }`.
  - **No `/api/me/prompt-key` route** is exposed.
- [ ] `/prs/page.tsx`: dev's own merged PRs with attribution breakdown.
- [ ] `/efficiency/page.tsx`: tokens-per-LOC, tokens-per-PR with team-median comparison (anonymized).
- [ ] Cursor opt-in (P31): user setting `account.useCursor boolean` (or simpler `user.useCursor`); when true, the heuristic biases unsourced commits authored by the user toward `cursor` when linked session is `source=cursor`.

### Tests (≥15)
- Sankey: 3-session fixture renders 3 bands with correct widths.
- Sankey: 100-session fixture buckets to 8.
- `/api/me/sessions/:id/prompts`: returns plaintext for owner; returns 403 for another user trying same session id; rate-limited at 60/min.
- Cursor opt-in: setting persisted; heuristic respects flag; flag-off behavior unchanged.
- Session detail: prompts render with `Cache-Control: no-store` header.
- E2E: dev signs in, opens `/me/...`, clicks recent session, sees prompts, navigates to linked PR.

### Acceptance
- Dev with ≥3 merged PRs sees a clean Sankey on overview.
- Clicking session → seeing prompts is the only flow that decrypts; server logs show no decryption attempts from manager routes.
- Cursor users see Cursor attribution on their PRs after enabling the flag.

---

## Phase 6 — Two-tier polish + non-App banners

**Atomic tasks**: see `dev-docs/build/04-phase-6-7-8-tasks.md` tasks T6.1 through T6.5.

**Goal:** Non-App orgs get a clear upgrade path; App-install backfill works smoothly.

**Depends on:** Phase 4 (helper exists), Phase 2 (backfill scaffolding).

**Patches addressed:** P17, P23.

### Requirements
- [ ] On `installation` webhook event: trigger `/api/internal/lineage/backfill` for installed repos. Default window 30 days (P23).
- [ ] Backfill uses GraphQL batched at 10 PRs/query, 1 PR/sec DB write cap.
- [ ] Banner on manager overview: "Backfilling N/M PRs imported — newest data shown live."
- [ ] Banner on non-App orgs: "Install GitHub App for cost-per-PR, source attribution, and lineage" with feature comparison table.
- [ ] Admin escape hatch: env-gated `?backfill_window=90` query param on `/api/internal/lineage/backfill` for orgs that ask.

### Tests (≥10)
- GraphQL backfill query shape: pulls PR + commits + files in one round-trip.
- Rate limit: 1 PR/sec is honored under load test.
- Resumable: kill mid-backfill; restart picks up at `backfill_state.lastPrId`.
- Non-App banner renders; CTA links to `installUrl(slug)`.

### Acceptance
- Fresh App install on a 50-PR test org completes backfill in <2 minutes.
- Dashboard shows live data within seconds of install; backfill completes in background.

---

## Phase 7 — Cohort + benchmark + waste + intent

**Atomic tasks**: see `dev-docs/build/04-phase-6-7-8-tasks.md` tasks T7.1 through T7.10.

**Goal:** Manager gets the 4 higher-order insight views. Cohort benchmark is privacy-safe.

**Depends on:** Phase 3 (rollups), Phase 4 (design system).

**Patches addressed:** P19, P21, P33.

### Requirements
- [ ] `/org/[provider]/[slug]/waste/page.tsx` per mock M7: stuck sessions, abandoned commits, top sinks. Reuses outcome buckets from `aggregate.ts` joined with `session_pr_link` for "no PR" tagging.
- [ ] `/org/[provider]/[slug]/intent/page.tsx` per mock M8: intent × outcome table + day-of-week × intent heatmap. Deterministic server-side insight callout (NOT LLM).
- [ ] `/org/[provider]/[slug]/benchmark/page.tsx` per mock M6: cohort comparison.
- [ ] `GET /api/insights/cohort/:metric`:
  - `requireMembership` + role=manager (P21).
  - Cohort selection limited to system-defined groups (membership role, tenure quartile, repo group). Ad-hoc cohorts require k≥10 (P19).
  - `cohort_query_log` table: rows logged per manager+query. Refuses queries differing by <2 members from a query made in the last 30 days.
  - Returns distribution buckets (P50/P10/P90), never per-user values.
  - Prompt-metadata bucketing (P33): `tsPrompt` rounded to hour granularity + ±30s jitter for non-owning views.
- [ ] `/devs/page.tsx` per-dev leaderboard for managers; `/devs/[login]/page.tsx` drill-in.
- [ ] `/org/[provider]/[slug]/devs/[login]/page.tsx` reuses dev-view rollups but with manager scope (sees session counts, files, costs — never plaintext prompts).

### Tests (≥15)
- Cohort endpoint: `n<5` returns 422 `{error:'cohort_too_small'}`.
- Intersection guard: querying cohort A (5 members) then cohort B (4 of A + 1 new) within 30 days returns 422 `{error:'cohort_intersection_blocked'}` (P19).
- `requireMembership`: cross-org access returns 403 (P21).
- Role gate: dev hitting cohort endpoint returns 403.
- Prompt-metadata bucketing: requesting `prompt_event` timing as a manager returns hour-granular tsPrompt with ±30s jitter (P33).
- Waste view: stuck-session detection matches `aggregate.ts` outcome buckets.
- Intent heatmap: 6-intent × 7-day grid renders; deterministic insight string asserts expected output.

### Acceptance
- Manager sees their org's cost-per-PR at P50 of a same-size cohort.
- Cohort with hidden rows shows the grey-`─` pattern; manager understands data was suppressed.
- Cohort intersection attack is blocked in a manual test.

---

## Phase 8 — Polish: mobile + motion + a11y + production rollout

**Atomic tasks**: see `dev-docs/build/04-phase-6-7-8-tasks.md` tasks T8.1 through T8.8.

**Goal:** Ship-ready. Mobile works at <768px. Motion is restrained. a11y passes. Pricing-API drift handled.

**Depends on:** Phases 4, 5, 7 (UI ships).

**Patches addressed:** P25, P28, P29, the long tail of QA.

### Requirements
- [ ] Mobile (P25): apply breakpoint rules; below 380px show "best on desktop" + escape hatch.
- [ ] Motion: implement design council §5 — `cubic-bezier(0.2,0,0,1)` 220ms filter transitions, 180ms shared-element drill-ins, 1px border hover, dim-to-20% Sankey hover, 200ms decrypt fade. All wrapped in `@media (prefers-reduced-motion: no-preference)`.
- [ ] Skeletons: match loaded geometry exactly (zero CLS).
- [ ] Keyboard nav: chord shortcuts `g o`, `g p`, `g d`, `g w` per audience; `?` keymap modal.
- [ ] CSP: `connect-src 'self'`; ensure no third-party fetches.
- [ ] Pricing table: ops-runbook in `dev-docs/ops-runbook.md` documenting how to add a new `model_pricing` row when Anthropic / OpenAI / Cursor change rates.
- [ ] Healthcheck: wire `/api/health/lineage` 503 to Railway healthcheck so cron failures degrade routing visibly.
- [ ] Demo data fixture: `apps/web/scripts/seed-demo.ts` generates ~30 days of realistic sessions + PRs + commits + links for a fresh org. Used in dev + tests.
- [ ] Update `CLAUDE.md` (root) with the additions in `dev-docs/CLAUDE-additions.md`.

### Tests (≥10)
- Lighthouse a11y ≥95 on Manager Overview, PRs, PR Detail, Dev Overview, Session Detail.
- `prefers-reduced-motion`: chart entry animations suppressed; hover effects preserved.
- Keyboard-only flow: complete drill-in PRs → PR detail → linked session without mouse.
- Healthcheck integration: stop cron → endpoint returns 503 → Railway flags unhealthy.

### Acceptance
- Demo fixture seeds clean; `/dashboard` shows the seeded org with ~50 PRs, ~300 sessions, attribution bars, cohort view with k=5+ data.
- Production launch checklist (`dev-docs/launch-checklist.md`) signed off.

---

## MVP validation checklist

| # | Requirement (from brief) | Phase | Innovation? | Tests |
|---|---|---|---|---|
| 1 | Improve Code Output Attribution | 2, 4 | #2 (CORE) | Heuristic table tests + UI bar tests |
| 2 | Better interpret token usage vs GitHub code actions | 2 | #1 (CORE) | Lineage formula + confidence tests |
| 3 | Unlock insights that actually matter | 5, 7 | #5, #6 (CORE) | Waste + intent + cohort tests |
| 4 | Represent token usage against merged PRs | 2, 3, 4 | #1 (CORE) | `cost_per_pr` + UI tests |
| 5 | Improve team insight presentation | 4, 5, 7 | #3, #4 (CORE) | Design system + Sankey + benchmark tests |

## Stretch goals (ordered)

1. `git blame` line-level attribution (v2, behind `PELLA_BLAME_ENABLED`). Phase 9.
2. Cursor `agent-trace` ingestion. Phase 10.
3. Cross-org public benchmark (k≥25 + DP design). Phase 11.
4. LLM-generated insight callouts (replacing deterministic rules). Phase 12.

## Phase totals

| Phase | Atomic tasks (parallel / sequential) |
|---|---|
| 1 — Foundations | ~12 (10P + 2S gate) |
| 2 — Lineage core | ~14 (4P + 10S — webhook chain mostly sequential) |
| 3 — Rollups | ~8 (6P + 2S) |
| 4 — Manager design + Overview/PRs | ~14 (10P + 4S) |
| 5 — Dev Sankey + session detail | ~9 (6P + 3S) |
| 6 — Two-tier polish + non-App banners | ~5 (3P + 2S) |
| 7 — Cohort + benchmark + waste + intent | ~10 (7P + 3S) |
| 8 — Polish + mobile + a11y | ~8 (5P + 3S) |

Task IDs and dependencies live in `dev-docs/build/`; the parallelism DAG is in `01-overview-and-hotpaths.md`.

## Patch coverage matrix

| Patch | Phase | Patch | Phase | Patch | Phase |
|---|---|---|---|---|---|
| P1 | 2 | P12 | 3 | P23 | 6 |
| P2 | 1 | P13 | 2 | P24 | 4 |
| P3 | 2 | P14 | 1, 2 | P25 | 8 |
| P4 | 2 | P15 | 1, 2 | P26 | 4 |
| P5 | 1, 3, 4 | P16 | 1, 2 | P27 | 4 |
| P6 | 1, 2 | P17 | 4 | P28 | 4 |
| P7 | 1, 3 | P18 | 5 | P29 | 1 |
| P8 | 2 | P19 | 7 | P30 | 2 |
| P9 | 1, 2 | P20 | 1 | P31 | 5 |
| P10 | 2 | P21 | 2, 7 | P32 | 2 |
| P11 | 1, 3 | P22 | 1, 2 | P33 | 7 |

All 33 patches sequenced into specific phase requirements. No orphans.
