# Insights Revamp — Completion Plan

Created 2026-05-14T04:21Z. Author: Claude. Branch: `feat/insights-revamp`.

> **Mandate from user:** "No more partial work." Everything we planned in
> `dev-docs/PRD.md`, `dev-docs/presearch.md`, `dev-docs/design-council-proposal.md`,
> and `dev-docs/build/*` ships before merge. UI quality matters — the current
> shipped UI is "generally unimpressive" and needs major rework toward a
> PostHog-style slice-and-dice analytics experience.

---

## 0. Plan structure

1. **State of the world** — what's actually live, what's broken, what's missing.
2. **Bug inventory** — every defect across v1, v2, and live walk.
3. **Deferred-scope inventory** — every Phase 6/7/8 task that the orchestrator skipped.
4. **UI rework** — design intent vs shipped, plus net-new PostHog-style requirements.
5. **Execution phases** — ordered, no-partial-delivery, verifiable.
6. **Handoff brief** — concrete prompt for the implementation subagent.

---

## 1. State of the world

### 1.1 What's actually shipped on `feat/insights-revamp`

| Layer | Status |
|---|---|
| Schema (9 new tables, 9 new columns, 17 indexes, 11 FKs) | ✅ Applied to Railway prod DB. Snapshot at `/tmp/pellametric-pre-revamp-20260514T033518Z.sql`. |
| Pricing seed (9 rows) | ✅ Loaded. |
| Hot-path code (lineage score, attribution, proration, redaction, ancestry, hydrate, worker, run/sweep routes) | ✅ Source-level verified. Untested at runtime. |
| Webhook + auth middleware | ✅ Reject unauth correctly (curl verified 401/401/307). |
| Manager `/org/.../prs` (list) | ✅ Renders empty state ("0 PRs in 30 days"). No filters, no charts, no KPIs. |
| Manager `/org/.../prs/[number]` (detail) | ⚠ Compiled. No real PR data yet (lineage worker never run). |
| Dev `/me/.../` (overview) | ✅ Renders 40 real sessions. No Sankey. No KPI hero. |
| Dev `/me/.../sessions/[id]` (detail) | ✅ Server-decrypts prompts inline. No "Decrypt prompts" click-to-load UX. |
| Production `next build` | ✅ Fixed in commit `bc6fc68` (was broken — split `lib/pricing.ts`). |
| CI workflow `review-insights-revamp.yml` | ⚠ Untracked. Should be committed. |
| Dev auth bypass `/api/dev/mint-session` | ⚠ Uncommitted local-only helper. Should be committed (env-gated) or deleted. |

### 1.2 What's NOT shipped

**Manager IA (design council §1.2 prescribed 8 routes; 2 of 8 shipped):**
- ❌ `/org/.../overview` revamped (KPI hero + scatter + attribution mix). Legacy page still loads.
- ❌ `/org/.../devs` revamped. Legacy `team-tables.tsx` still loads.
- ❌ `/org/.../devs/[login]` revamped.
- ❌ `/org/.../waste` (stuck/abandoned sessions).
- ❌ `/org/.../intent` (intent × outcome heatmap).
- ❌ `/org/.../benchmark` (cohort comparison).

**Dev IA (3 routes prescribed; 2 of 3 shipped, but with reduced fidelity):**
- ❌ `/me/.../` Sankey hero session→commit→PR. Shipped a plain table instead.
- ❌ `/me/.../sessions` (list page). 404.
- ❌ `/me/.../prs` (own PRs filtered). 404.

**Backend services:**
- ❌ GitHub App installation event handler → backfill trigger.
- ❌ `/api/internal/lineage/backfill` route (GraphQL paginated, resumable, rate-limited).
- ❌ Backfill progress banner.
- ❌ Cohort intersection guard live alert (audit log exists but no alert wiring).
- ❌ Prompt metadata bucketing in cohort views (P33).
- ❌ Intent × outcomes API.
- ❌ Cost-per-PR API (route file exists but not wired to UI).
- ❌ Manual lineage relink route `/api/lineage/relink/[prId]`.

**Design system:**
- ❌ Visx never installed. Sankey, scatter, calendar heatmap, attribution heatmap all unimplemented.
- ❌ Loading skeletons (geometry-matched).
- ❌ Empty states per §6.3 (3 diagnostics + 2 escape hatches).
- ❌ Mobile responsive (no <768/<900/<600/<380 breakpoints).
- ❌ Role switcher (manager-who-is-also-dev).
- ❌ Keyboard chords (`g o`, `g p`, `g d`, `g w`).
- ❌ Motion implementation (220ms transitions, shared-element drill-in).
- ❌ `?view=me` 301 redirect shim.

**Tests:**
- 93 leaf-function tests pass. 0 tests for:
  - `lib/insights/refresh-*` (3 files containing 3 of the 6 bugs found)
  - `lib/lineage/run.ts` worker
  - `lib/github-pr-hydrate.ts` (revert/force-push paths)
  - All API route handlers (cohort, prompts, webhook, internal/lineage/*)

---

## 2. Bug inventory (every defect, severity-ranked)

### CRITICAL — must fix before flag-on

| ID | Where | What | Action |
|---|---|---|---|
| **C1** | `apps/web/lib/insights/refresh-cost-per-pr.ts:141-154` | `priceVersion` is dead code (sets to row count, discards `max(createdAt)`). | Replace with monotonic version source — recommend `extract(epoch from max(model_pricing.created_at))::int`. |
| **C2** | `apps/web/lib/insights/refresh-cost-per-pr.ts:70-94` | Stacked-PR subtraction over-subtracts. Subtracts every child session even those never linked to parent. `Math.max(0, …)` clamp hides the bug. | Intersect parent's link set with child's before subtracting. |
| **C3** | `apps/web/lib/insights/refresh-daily-org-stats.ts:55-123` | `prsMerged` / `prsMergedAiAssisted` / `prsMergedBot` / `prsReverted` are duplicated across every source row. `SUM(prsMerged) WHERE day=?` returns N× actual. | Move PR counts to a separate `daily_org_pr_stats` table keyed `(orgId, day)`, OR write only into `source='_meta'` canonical row. |
| **C4** | `apps/web/app/api/insights/cohort/[metric]/route.ts:30,53` | `?members=u&members=u&members=u` bypasses k-anonymity gate. | `Array.from(new Set(memberFilter))` before length check. |
| **C5** | `apps/web/lib/lineage/run.ts:83-100` | `prevFilenames` always empty → P10 rename-aware Jaccard never fires. P10 listed ✅ in patch matrix but only half-shipped. | Add GitHub compareCommits call in hydrate or in run; thread `previous_filename` from response into `scoreLineage`. |
| **C6** | Build broke on Phase 1 ship | Already fixed in commit `bc6fc68` (split pricing-db.ts). | DONE. Verify CI passes on next push. |

### HIGH — must address before flag-on

| ID | Where | What | Action |
|---|---|---|---|
| **H1** | `apps/web/app/me/[provider]/[slug]/sessions/[id]/page.tsx:33-54` | SSRs decrypted prompts inline. P18 design said click-to-decrypt via rate-limited API. Page is `force-dynamic` so CDN caching is mitigated, but no per-request rate limit and HTML response body contains plaintext. | Convert to Client Component skeleton that fetches `/api/me/sessions/[id]/prompts` on user click. The API route already enforces 60/min + `no-store`. |
| **H2** | `apps/web/app/me/[provider]/[slug]/prs/page.tsx` | 404. Listed in nav. | Create the page per design §2.5 ("dev personal feed" filtered to user's own merged PRs). |
| **H3** | `apps/web/app/me/[provider]/[slug]/sessions/page.tsx` | 404. Listed in nav. | Create the list page; pagination + filter by source/repo/date. |
| **H4** | `apps/web/app/api/dev/mint-session/route.ts` | Local-only dev bypass route. `.gitignore`'d under `apps/web/app/api/dev/`. Resolved 2026-05-14 — must never ship. | DONE: route stays in working tree, gitignore prevents accidental commit. |
| **H5** | `.github/workflows/review-insights-revamp.yml` | Untracked CI workflow. Encodes the static + db + runtime invariants we ran by hand. | Commit. |
| **H6** | Lineage worker has no advisory lock | `SELECT pending → UPDATE running` is a 2-statement race; concurrent /run + /sweep can run same job twice. | `UPDATE … WHERE status='pending' RETURNING *` atomic claim, OR `SELECT FOR UPDATE SKIP LOCKED`. |
| **H7** | `apps/web/lib/auth-middleware.ts:69-78` | `checkInternalSecret` uses `===` (timing oracle). | `crypto.timingSafeEqual` with length pre-check. |
| **H8** | `apps/collector/src/parsers/repo.ts:122-134` | `execSync(\`git -C "${cwd}" rev-parse …\`)` — shell-interpolated cwd. | `execFileSync("git", ["-C", cwd, "rev-parse", …])`. |
| **H9** | `apps/web/app/api/ingest/route.ts:280-300` | Fire-and-forget `refreshDailyUserStats` post-response may be killed by runtime lifecycle. | Move to `lineage_job` queue with `priority: 3` OR use Vercel `waitUntil` if available. |

### MEDIUM — should fix before flag-on, OK to ship behind flag

| ID | Where | What | Action |
|---|---|---|---|
| **M1** | `cohort_query_log.memberIds` | Stored as cleartext text[]. P19 only needs `cohortHash` for intersection detection. | Drop the column, OR document operator-trust assumption. |
| **M2** | Decrypt rate-limit | In-memory `Map`, per-instance. Fine on single Railway instance, fragile if scaled. | DB-backed or Redis-backed sliding window. |
| **M3** | `apps/web/lib/insights/refresh-daily-org-stats.ts:82-85` | Phantom `source='claude'` row written when no sources active that day. | After C3 fix, route the empty-day write to `source='_meta'` or skip. |
| **M4** | All 4 deferred Top-7-exposure patches | P23 backfill, P24 Sankey cap, P25 mobile, P26 role switcher, P27 ?view=me, P28 shared layout, P33 metadata bucketing. | Build out per Phase 6/7/8 below. |

### LOW — track, fix during cleanup

| ID | Where | What |
|---|---|---|
| L1 | `pricing.test.ts` doesn't cover the new DB-driven functions. | Add tests for `priceFor`/`applyPricing`. |
| L2 | `LINEAGE_ALERT_WEBHOOK` env declared but never read. | Wire to Slack-incident-webhook when `/api/health/lineage` returns 503 for >2h. |
| L3 | Layout's nav links to `/sessions` and `/prs` 404. | Will be resolved when H2/H3 ship. |

---

## 3. Deferred-scope inventory

These are tasks from `dev-docs/build/04-phase-6-7-8-tasks.md` that the orchestrator
marked ⚠ deferred. They are part of the agreed scope and must ship.

### Phase 6 — Two-tier polish + non-App banners (0.5 wk)
- **T6.1** Wire `installation.created` webhook → backfill trigger.
- **T6.2** `/api/internal/lineage/backfill` route (GraphQL paginated, resumable via `backfill_state`, 1 PR/sec rate limit).
- **T6.3** Backfill progress banner on manager overview ("Backfilling N/M PRs").
- **T6.4** Non-App install banner with feature comparison table (already partially shipped as `NonAppBanner` component, needs wiring + comparison content).
- **T6.5** Admin escape hatch: extended-window backfill (UI to trigger longer history pulls).
- **T6.6** Phase 6 tests (fixture replay of installation event; backfill resume).

### Phase 7 — Cohort + benchmark + waste + intent (2 wk)
- **T7.1** Manager `/org/.../waste` page (stuck sessions, abandoned work, top sinks).
- **T7.2** Calendar heatmap component (Visx grid).
- **T7.3** Manager `/org/.../intent` page (intent × outcome heatmap + day-of-week).
- **T7.4** Manager `/org/.../benchmark` page (cohort comparison, k-anonymity gate visible).
- **T7.5** Cohort intersection guard live alert (audit log already exists; add scheduled detector).
- **T7.6** Prompt metadata bucketing helper (hour granularity + ±30s jitter for non-owners).
- **T7.7** Cohort API route (✅ exists but needs C4 fix + per-cohort filtering).
- **T7.8** Intent-outcomes API route.
- **T7.9** Cost-per-PR API (route exists; wire to manager UI).
- **T7.10** Manager `/org/.../devs` leaderboard revamp (replace legacy `team-tables.tsx`).
- **T7.11** Manager `/org/.../devs/[login]` drill-in revamp.
- **T7.12** Phase 7 tests.

### Phase 8 — Polish, mobile, motion, a11y, rollout (1.5 wk)
- **T8.1** Mobile responsive sweep (<768 nav rail → bottom tabs, <900 Sankey → bar, <600 tables → cards, <380 desktop-only escape hatch).
- **T8.2** Motion implementation (220ms transitions, 180ms drill-in, prefers-reduced-motion gate).
- **T8.3** Loading skeleton components for every major view (geometry-matched).
- **T8.4** Keyboard chord shortcuts + `?` modal (`g o`, `g p`, `g d`, `g w`).
- **T8.5** CSP tightening (script-src, connect-src, frame-ancestors).
- **T8.6** Ops runbook for pricing-API drift (when Anthropic/OpenAI publish new rates).
- **T8.7** Demo seed script (idempotent dev DB seeder for a believable team).
- **T8.8** Healthcheck wiring to Railway alarms (>90 min stale → ping).
- **T8.9** Launch checklist doc.
- **T8.10** Cut-over: flip `PELLAMETRIC_INSIGHTS_REVAMP_UI=1` + delete legacy `org-view-switcher.tsx` + `?view=me` 301 shim.
- **T8.11** Update root `CLAUDE.md` with revamp additions.
- **T8.12** Phase 8 tests.

### Additional deferred items (from earlier phases)
- **T2.0** Webhook fixture files at `dev-docs/fixtures/` (for replay tests).
- **T2.5** Manual relink route `/api/lineage/relink/[prId]`.
- **T3.7** Backfill script for `daily_user_stats` (one-shot, resumable).
- **T4.10/T4.11** Shared `[slug]/layout.tsx` with nav rail.
- **T4.12** Move existing `page.tsx` into `(overview)/page.tsx`.
- **T4.17** `?view=me` redirect shim.
- **T5.5** Sankey visualization (Visx).
- **Build-status WIP** `.env.example` update (was permission-blocked).

---

## 4. UI rework

The user said the current UI is "generally unimpressive" and wants PostHog-style
slice-and-dice. The design council prescribed dense panel grids, Visx charts,
empty-state diagnostics, motion, and keyboard nav — but the shipped UI is a
plain table with no charts and no filters. **The shipped UI does not match the
design council spec, and the design council spec itself doesn't yet include
PostHog-style ad-hoc querying.**

This section proposes both (a) completing the design council vision and
(b) layering on the PostHog slice/dice.

### 4.1 PostHog-style slice/dice — the missing piece

PostHog's UX strengths to mirror:

1. **Insight builder** — define a metric by choosing event/property/breakdown/filter, save as an "insight."
2. **Dashboards** — pin insights into customizable dashboards.
3. **Trends + funnels + retention** — multiple visualization modes for the same query.
4. **Breakdown-on-any-property** — group by `user.github_login`, `repo`, `intent`, `model`, `source`, `day-of-week`, etc.
5. **Compare two cohorts side-by-side**.
6. **Saved filters** that persist in URL (shareable).

Mapping to Pellametric data model:

| PostHog concept | Pellametric equivalent |
|---|---|
| Event | A `session_event` row (or rolled-up `daily_user_stats`) |
| Property to filter by | `source`, `model`, `repo`, `intent_top`, `branch`, `userId`, `day-of-week`, `cost_bucket` |
| Property to break down by | Same as above |
| Metric | tokens_in, tokens_out, cost (computed from pricing-db), wall_sec, sessions count, PRs merged, error_rate |
| Time series | Daily / weekly / monthly grain, last 7d/30d/90d/custom |
| Saved insight | URL-encoded query state; later: persisted `saved_insight` table |
| Funnel | session → linked_pr_high_confidence → pr_merged → not_reverted |
| Cohort | members[] of org membership (with k-anonymity gate enforced) |

**Concrete UI shape:**

```
+-------------------------------------------------------------------------+
| pellametric / pella-labs / Insights                       walid ▾   ⌘K |
+-------------------------------------------------------------------------+
| ← Sidebar ──────────────────┐                                          |
|  📊 Dashboard               │  ┌──── Builder ─────────────────────┐    |
|  ▲ Trends         (default) │  │ Metric:    [Tokens out         ▾]│    |
|  ◇ Funnels                  │  │ Breakdown: [Source             ▾]│    |
|  ⊕ Retention                │  │ Filter:    [Repo = pellametric ✕]│    |
|  ◉ Sessions                 │  │            [Intent = build     ✕]│    |
|  ◼ PRs                      │  │            [+ add filter         ]│    |
|  ◈ Devs                     │  │ Range:     [Last 30 days       ▾]│    |
|  ◆ Waste                    │  │ Compare:   [Previous period  ☐  ]│    |
|  ◊ Intent                   │  └──────────────────────────────────┘    |
|  ☴ Benchmark                │                                          |
|  ⎈ Settings                 │  ┌──── Chart ───────────────────────┐    |
|                             │  │       │claude  │codex  │human    │    |
|  Saved insights:            │  │  ▆▆▆  │▇▇▇▇▇  │▃▃    │▅▅▅▅▅   │    |
|  • Cost trend (org)         │  │  ▆▆▆  │▇▇▇▇▇  │▃▃    │▅▅▅▅▅   │    |
|  • Top sinks                │  │       │       │       │         │    |
|  • Bot vs human             │  │       Mon Tue Wed Thu Fri        │    |
|  + New insight              │  └──────────────────────────────────┘    |
|                             │                                          |
|                             │  ┌──── Breakdown table ────────────┐    |
|                             │  │ source   sessions  tokens  cost │    |
|                             │  │ claude   38        4.6M    $128 │    |
|                             │  │ codex    21        1.2M    $24  │    |
|                             │  │ human    —         —       $0   │    |
|                             │  └──────────────────────────────────┘    |
|                             │                                          |
|                             │  [Save as insight] [Share URL] [Export] |
|                             │                                          |
+-----------------------------+-------------------------------------------+
```

**URL state encoding:**

```
/org/github/pella-labs/insights
  ?metric=tokens_out
  &breakdown=source
  &filter=repo:pellametric,intent:build
  &range=30d
  &chart=stacked_bar
  &compare=prev_period
```

**New surfaces required (over and above design council):**

- `/org/[provider]/[slug]/insights` — the builder shell, default to "trends/tokens_out/by source/30d".
- `/me/[provider]/[slug]/insights` — same shape, scoped to user.
- Sidebar nav with 8 metric modes (Trends, Funnels, Retention, Sessions, PRs, Devs, Waste, Intent).
- Builder panel (metric / breakdown / filter / range / compare).
- Chart panel that switches type based on metric (line, stacked bar, funnel, sankey, table).
- Breakdown table that pairs with the chart.
- Saved-insight table (`saved_insight (id, orgId, userId, name, query_json, created_at)`).
- Saved-dashboard table (`saved_dashboard (id, orgId, name, layout_json, created_at)`).
- Insight pin: `dashboard_pinned_insight (dashboard_id, insight_id, position)`.

**Query engine:**

A central `getInsight(query: InsightQuery)` function that compiles the query
into a single drizzle SELECT against `session_event` ⋈ `session_pr_link` ⋈ `pr`
⋈ `pr_commit` ⋈ `daily_user_stats` based on the metric. Returns
`{ series: TimePoint[], breakdown: BreakdownRow[] }`. Lives at
`apps/web/lib/insights/query.ts`.

Privacy invariant: when run from manager scope, k-anonymity gate fires the same
way as the existing cohort endpoint — if the resulting cohort has <k members,
return `{ error: "k_anonymity_violated", required: 5, actual: N }`.

### 4.2 Completing the design council vision

In parallel with the PostHog work, the deferred design-council surfaces must
ship. They are NOT redundant with the insight builder — they are curated
prebuilt views ("did we spend well this week?", "who is stuck?") that load
without configuration. Think: PostHog's prebuilt dashboards.

Specifically:

- **Manager overview** rebuilt per §2.1 — KPI hero strip + spend-vs-throughput scatter + attribution mix bar + week-over-week trend sparklines.
- **PR detail** rebuilt per §2.3 — cost, sessions linked w/ confidence, code-output attribution, linked sessions table.
- **Dev overview** rebuilt per §2.4 — Sankey hero session → commit → PR.
- **Waste page** per §2.7.
- **Intent page** per §2.8 (heatmap).
- **Benchmark page** per §2.6.

### 4.3 Design system gaps to fill before rebuilding

- Install Visx (`@visx/visx` or per-component `@visx/sankey`, `@visx/xychart`, `@visx/heatmap`, `@visx/shape`).
- Build the 4 chart primitives:
  - `<SankeyChart>` (with band-color = source, hover dim, click-to-drill).
  - `<ScatterChart>` (dots sized by sqrt(sessions), median dashed line, outlier labels).
  - `<CalendarHeatmap>` (5-stop color ramp, hover numeric label).
  - `<StackedAttributionBar>` (pre-computed, 4 rect, inline text labels).
- Build skeleton components per §6.4 (geometry-matched, no fade transition).
- Build empty-state component per §6.3 (3 diagnostics + 2 escape hatches signature).
- Build confidence affordance: 3-pip indicator + glyph + color.

---

## 5. Execution phases (no partial delivery)

Each phase has a **gate**: all tasks in the phase must be done + tested before
the next phase starts. The orchestrator/subagent cannot mark a phase done if
any task is WIP or deferred.

### Phase F0 — Foundation fixes (1 day, no UI work)

1. C1-C5 from §2 (rollup math, cohort gate, P10 prevFilenames, build).
2. H6-H9 (lineage queue lock, timing-safe compare, exec hardening, ingest waitUntil).
3. Add unit tests for `refreshCostPerPr`, `refreshDailyOrgStats`, `runLineageForPr` (closes the test-coverage hole that allowed C1-C3 to ship).
4. Commit CI workflow (`.github/workflows/review-insights-revamp.yml`).
5. Commit OR delete `apps/web/app/api/dev/mint-session/route.ts` (decision: keep, env-gated).
6. Update `.env.example` with all 6 new env vars (T1.11 from build-status WIP).

**Gate:** CI green. 93 → ~110+ tests passing.

### Phase F1 — Visx + chart primitives + skeletons + empty states (2 days)

7. `bun add @visx/sankey @visx/xychart @visx/heatmap @visx/shape @visx/scale @visx/axis @visx/tooltip @visx/group @visx/responsive`.
8. Build `components/charts/{SankeyChart, ScatterChart, CalendarHeatmap, StackedAttributionBar}.tsx`.
9. Build `components/data/{skeleton, empty-state, confidence-pip-large, kpi-tile, sparkline}.tsx` (expand existing primitives).
10. Storybook-equivalent: a `/_dev/components` route (env-gated) that renders every chart with mock data so the design can be evaluated in isolation.

**Gate:** All 4 charts render with mock data on `/_dev/components`. Skeleton geometry matches loaded geometry. Empty state has 3 diagnostics + 2 escape hatches.

### Phase F2 — PostHog-style insight builder (3 days)

11. Schema: add `saved_insight` + `saved_dashboard` + `dashboard_pinned_insight` tables.
12. `lib/insights/query.ts` — central `getInsight(query)` query compiler.
13. `/org/[provider]/[slug]/insights/page.tsx` — builder shell + URL state encoding.
14. `/me/[provider]/[slug]/insights/page.tsx` — user-scoped version.
15. 8 metric modes (Trends / Funnels / Retention / Sessions / PRs / Devs / Waste / Intent) — each a Visx chart + breakdown table.
16. Save-as-insight flow (modal → row in `saved_insight`).
17. Sidebar nav of saved insights.
18. Manager k-anonymity gate enforced on every builder query (refuses if cohort size <5).

**Gate:** A manager can build "tokens_out by source last 30d filtered to repo=pellametric" and save it. The saved insight reappears on next page load. Same query loads from URL alone.

### Phase F3 — Deferred design-council surfaces (3 days)

19. T4.10/T4.11/T4.12 — shared `[slug]/layout.tsx` with nav rail; move existing pages under `(overview)/`.
20. Rebuild `/org/.../overview` per §2.1 (KPI hero + scatter + attribution mix + week-over-week sparklines).
21. Rebuild `/org/.../prs/[number]` per §2.3 (uses real `cost_per_pr` data once lineage runs).
22. Rebuild `/org/.../devs` + `/org/.../devs/[login]` (T7.10/T7.11).
23. Build `/org/.../waste` (T7.1).
24. Build `/org/.../intent` (T7.3) — uses calendar heatmap.
25. Build `/org/.../benchmark` (T7.4) — uses k-anonymity gate UI.
26. Rebuild `/me/.../` overview with Sankey hero (T5.5).
27. Build `/me/.../sessions` list (H3) + `/me/.../prs` list (H2).
28. Convert `/me/.../sessions/[id]` to click-to-decrypt pattern (H1).

**Gate:** All 14 prescribed routes render correctly with seeded test data. Every chart in design council ships.

### Phase F4 — Backend rounding-out (2 days)

29. T6.1 installation webhook → backfill trigger.
30. T6.2 `/api/internal/lineage/backfill` route (GraphQL, resumable, rate-limited).
31. T6.3 backfill progress banner.
32. T6.5 admin extended-window backfill.
33. T2.5 manual relink route.
34. T7.5 cohort intersection guard alert wiring.
35. T7.6 prompt-metadata bucketing helper.
36. T7.8/T7.9 intent-outcomes + cost-per-PR APIs (wire to UI).

**Gate:** A new GitHub App install backfills its top 50 merged PRs within 5 min; progress banner reflects status. Cohort intersection alert fires when two queries overlap by ≥(k-1) members.

### Phase F5 — Polish (2 days)

37. T8.1 mobile breakpoints (test on 320, 600, 768, 900, 1280).
38. T8.2 motion implementation (220ms, prefers-reduced-motion gate).
39. T8.4 keyboard chords + `?` modal.
40. T8.5 CSP tightening.
41. T8.7 demo seed script.
42. T8.8 healthcheck wiring.
43. T8.9 launch checklist.
44. T8.11 CLAUDE.md update.

**Gate:** Lighthouse a11y ≥95 on every new route. Mobile 320×568 renders without horizontal scroll. `g o` / `g p` / `g d` / `g w` chords work.

### Phase F6 — Cutover (0.5 day)

45. T8.10 flip `PELLAMETRIC_INSIGHTS_REVAMP_UI=1` in Railway production.
46. Delete legacy `org-view-switcher.tsx`.
47. Add `?view=me` 301 redirect to `next.config.ts`.
48. Update CLAUDE.md "Production: revamp is live."
49. Squash + merge `feat/insights-revamp` → main.

**Gate:** A real manager + real dev walk through every page without error.
Three days of production logs show 0 errors on new routes.

---

## 6. Subagent handoff brief

The subagent will implement Phases F0 through F6 sequentially. It must:

1. **Never** mark a phase done with WIP or deferred tasks inside it.
2. Use `TaskCreate`/`TaskUpdate` for every task in every phase. Update status to `in_progress` when starting, `completed` only after the task's gate is met.
3. After each phase, run `dev-docs/scripts/review.sh static` (37/37 must pass) and full `bun run typecheck && bun run test && bun --filter='./apps/web' run build` (all green).
4. For UI work, run the local prod server (`bun --filter='./apps/web' run start` after build) and visually verify every changed page via the Chrome MCP `mcp__claude-in-chrome__*` tools — read accessibility tree, capture state, confirm against design council ASCII mockups.
5. Commit per Phase boundary with a conventional-commit message naming the Phase.
6. After F6, run a full `dev-docs/scripts/review.sh all` against staging Postgres + a fresh dev server.

### Subagent prompt (copy-paste-ready)

```
You are implementing the comprehensive completion plan at
dev-docs/completion-plan-20260514T042140Z.md. Work on branch
feat/insights-revamp. The mandate from the user is NO PARTIAL DELIVERY —
all 49 tasks (F0.1 through F6.49) must complete before merge.

Read these in order:
1. dev-docs/completion-plan-20260514T042140Z.md (this plan)
2. dev-docs/PRD.md
3. dev-docs/presearch.md (locked decisions)
4. dev-docs/challenger-report.md (33-patch list)
5. dev-docs/design-council-proposal.md (UI spec, especially §2 mockups + §3 tokens + §6 a11y)
6. dev-docs/build/01-overview-and-hotpaths.md (verbatim algorithms)
7. dev-docs/review-report-v2-20260514T031615Z.md (known bugs)

Execute Phases F0 through F6 in order. For each phase:

1. Call TaskCreate for every numbered task in the phase.
2. Set the active task to in_progress with TaskUpdate.
3. Implement.
4. Run typecheck + test + build. Static check must be 37/37.
5. For UI tasks, spin up `bun --filter='./apps/web' run start` with
   DEV_AUTH_BYPASS=1 and PELLAMETRIC_INSIGHTS_REVAMP_UI=1. Use the
   mcp__claude-in-chrome__* tools to visit every changed page and verify
   against design-council ASCII mockups.
6. Mark task completed only when the phase gate is met.
7. Commit at phase boundary: feat(web): F<N> — <phase title>.

If you hit any blocker that requires a user decision (deletion, schema rename,
breaking change), STOP and ask. Do not deliver partial. Do not skip a task.

The PostHog-style insight builder (Phase F2) is new scope not present in the
original orchestrator's plan. Treat it as first-class — it is what makes the
product actually competitive. Take time on the IA, the URL encoding, the
saved-insight persistence. The user's words: "make the info digestible and
also allow that posthog feel ability to slice and dice the data anyway you'd
like."

The user is unimpressed with the current UI. Lean toward dense panel grids
with shared borders, the Linear/Swarmia/DX aesthetic prescribed in design
council §4.3 ("Evolve palette, adopt bolder layout posture"). Avoid the
plain-table look the orchestrator shipped.

When you finish F6, run:
  bash dev-docs/scripts/review.sh static
  bash dev-docs/scripts/review.sh db   # requires DATABASE_URL
  bash dev-docs/scripts/review.sh runtime  # requires DATABASE_URL + PROMPT_MASTER_KEY

All three must pass with 0 failures.
```

---

## 7. Locked decisions (from user, 2026-05-14)

1. **`/api/dev/mint-session` is LOCAL-ONLY.** Added to `.gitignore` at
   `apps/web/app/api/dev/`. Subagent must NEVER commit this route. It stays
   in the user's working tree for local development. Production has no such
   route — auth must always go through better-auth's GitHub OAuth flow.
2. **PostHog-style builder URL encoding = query-string** (shareable links).
3. **`saved_insight` ownership = ORG-SCOPED.** Any manager in the org can
   see, edit, share, and delete insights. Devs see only their own insights
   (scoped to their userId). Manager queries still enforce k-anonymity gate
   on cohort sizes <5 / <10.
4. **Mobile fidelity floor = 320px+ everything works.** Every chart degrades
   gracefully. Sankey → vertical bar at <900. Tables → card list at <600.
   No "best on desktop" escape hatch unless absolutely forced.
5. **Visx LOCKED** per design council §3.5. Confirmed.
6. **Demo seed data = separate `seed:demo` script** (T8.7). Subagent writes
   a script that generates a believable team: 50 PRs across 4 devs, 200
   sessions across Claude + Codex + Cursor, ranges over 30d, mixed AI
   sources, 3 reverts, 2 stacked PRs, realistic intent distribution.
   Idempotent. Never run against prod DATABASE_URL — script must check
   that `DATABASE_URL` hostname is `localhost` or has `DEMO=1` env set.

---

## 8. Estimated timeline

- Phase F0: 1 day
- Phase F1: 2 days
- Phase F2: 3 days
- Phase F3: 3 days
- Phase F4: 2 days
- Phase F5: 2 days
- Phase F6: 0.5 day

**Total: ~13.5 dev-days** assuming one focused implementer (subagent) without context-switching. The single biggest variable is F2 (PostHog builder); the IA is novel and may take longer in practice.

---

## 9. Restoration / rollback

If anything in F3-F6 introduces a regression after Railway deploy:

```bash
# In Railway dashboard: PELLAMETRIC_INSIGHTS_REVAMP_UI=0
# Application redeploys; legacy UI returns.

# DB rollback (only if F0 schema fix breaks something unexpected):
psql "$DATABASE_URL" < /tmp/pellametric-pre-revamp-20260514T033518Z.sql
```

Snapshot path is preserved.

---

End of plan. Next: spawn the subagent with the brief above.
