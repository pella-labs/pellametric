# CLAUDE.md additions — insights revamp (feat/insights-revamp)

> Append these sections to the root `CLAUDE.md` when the revamp lands. ADDITIVE ONLY — do not modify existing project context.

---

## Insights / lineage architecture (added in feat/insights-revamp)

The dashboard's hot path reads from precomputed rollups, not in-memory aggregation. Session → PR lineage is populated by a worker on PR merge + a sweep cron, never on page load.

### Data flow

```
Collector ──▶ POST /api/ingest ──▶ session_event, prompt_event, response_event
                                    └─▶ enqueue lineage_job (if PR window overlaps)

GitHub App webhook ──▶ POST /api/github-webhook
  pull_request.opened/synchronize → hydrate pr + pr_commit (kind='commit')
  pull_request.closed&&merged     → hydrate squash_merge/merge_commit + enqueue lineage_job
  installation.created            → backfill 30d via GraphQL (rate-limited 1 PR/sec)
  push (force-push detected via before/after ancestry) → wipe + rehydrate pr_commit

Worker (Next.js internal routes, Bearer INTERNAL_API_SECRET) :
  POST /api/internal/lineage/run   → links one PR's sessions, refreshes cost_per_pr
  POST /api/internal/lineage/sweep → drains lineage_job by priority, cap N=500
  Railway cron hits sweep every 30 min; full reconciliation at 02:00 UTC
```

### Schema tables added

- `pr_commit` — commit-level rows with `kind` (`commit`|`squash_merge`|`merge_commit`), `aiSources text[]`, `aiSignals jsonb`, `aiConfidence`, redacted message ≤1024 chars.
- `daily_user_stats`, `daily_org_stats` — UTC-bucketed rollups; tokens only, NO stored dollars (compute at read time from `model_pricing`).
- `cost_per_pr` — per-PR rollup with `pctClaude/Codex/Cursor/Human/Bot` and `priceVersion`.
- `lineage_job` — queue table; ingest enqueues for late-arriving sessions.
- `system_health` — heartbeat from worker; `/api/health/lineage` returns 503 if stale.
- `model_pricing` — versioned price table (effectiveFrom/effectiveTo); never store dollar columns.
- `session_event.branch` (collector populates via `git rev-parse --abbrev-ref HEAD`), `session_event.cwdResolvedRepo`.
- `pr` extensions: `kind` (`standard`|`revert`), `revertsPrId`, `stackedOn`, `headBranch`, `baseBranch`, `mergeCommitSha`, `lastSyncedAt`, `linkComputedAt`.

### Lineage confidence formula

```
gate    = cwd_match: session.cwdResolvedRepo == pr.repo  (1=match, 0=wrong, 0.6=unknown)
score   = gate × (0.45·fileJaccard + 0.25·timeOverlap + 0.15·branchMatch + 0.15·commitAuthorship)
bucket  = >=0.7 high | >=0.4 medium | >=0.15 low | else drop
exception: drop threshold falls to 0.10 if cwdMatch=true AND commit_authorship=true
```

Renames: `pr.fileList` expanded with `previous_filename` from `/pulls/{n}/files`.

### Attribution rules

- `pr_commit.aiSources` is `text[]` — multi-source commits preserved.
- `aiSource='bot'` is terminal for `*[bot]` logins and known bot emails. Excluded from human/AI denominator.
- `Co-Authored-By:` trailer + corroborating evidence → confidence ≥60.
- `noreply@anthropic.com` author alone → +30 src=`unknown` (NOT claude) — requires trailer/footer corroboration.
- `kind='merge_commit'` and `kind='squash_merge'` excluded from `SUM(additions)` percentages.
- Codex / Cursor without trailer get session-join inference (`+50 confidence`) when a high-confidence linked session has the matching `source`.
- `aiFooterPolicy` per-org: `'required'`|`'forbidden'`|`'optional'`. Violators surfaced as a hygiene metric, never blocking.

## Privacy boundaries (load-bearing — DO NOT WEAKEN)

- **No aggregation path decrypts prompts/responses.** Lineage worker reads only session_event, pr, pr_commit, membership, org. May read `prompt_event.{wordCount, tsPrompt, externalSessionId}` metadata.
- **DEK never leaves the server.** There is NO `/api/me/prompt-key` route. Plaintext decryption happens exclusively inside `GET /api/me/sessions/:id/prompts` after verifying `session.userId === row.userId`. Rate-limited 60/min/user. `Cache-Control: no-store`.
- **`requireMembership(userId, orgSlug)` middleware** is mandatory on every insights endpoint. Returns 403 (not 404) on failure. Cohort endpoints additionally require `role=manager`.
- **Cohort k-anonymity:** k≥5 for system-defined groups (membership role, tenure quartile, repo group); k≥10 for ad-hoc cohorts. Intersection guard: `cohort_query_log` refuses queries differing by <2 members from a query made in the last 30 days. Cross-org k≥25 is deferred until cross-org benchmarks ship.
- **Prompt metadata bucketing:** any cohort query reading `prompt_event` timing returns hour-granular `tsPrompt` with ±30s jitter for non-owning views.
- **Commit-message redaction:** `pr_commit` insert path regex-scans for AWS_KEY, `gh[pous]_`, high-entropy ≥32-char strings. Replaces with `[REDACTED:type]`. Sets `messageRedacted=true`. Truncates to 1024 chars.

## Manager vs Dev view split (route structure)

`OrgViewSwitcher` is deleted. Routes are split:

- `/org/[provider]/[slug]/*` — manager namespace. Layout at `app/org/[provider]/[slug]/layout.tsx`. Children: `(overview)`, `prs/`, `prs/[number]`, `devs/`, `devs/[login]`, `waste/`, `intent/`, `benchmark/`, `members/`, `invite/`, `policy/`.
- `/me/[provider]/[slug]/*` — dev namespace. Layout at `app/me/[provider]/[slug]/layout.tsx`. Children: `(overview)`, `sessions/`, `sessions/[id]`, `prs/`, `efficiency/`, `waste/`.

`(overview)` is a Next.js route group — sibling to `prs/` etc., NOT a parent layout. Shared layout MUST live at `[slug]/layout.tsx`.

A persistent top-right role switcher toggles between `/org/.../(overview)` and `/me/.../(overview)` for the same slug (cookie-persisted as `pellametric_view`).

Legacy `?view=me` URLs are 301-redirected for one release via `next.config.js` and a shim component.

## OAuth-vs-App two-tier experience

`getPrsForOrg(orgId)` is the single helper that abstracts this:
- App-installed (`org.githubAppInstallationId != null`): reads from `pr` + `cost_per_pr` (full features).
- OAuth-only: falls back to `lib/gh.ts` `prAggForMember` (top-50 PRs, no cost-per-PR, no attribution). Manager overview shows a banner: "Install GitHub App for full features."

Do NOT remove the OAuth fallback. Half the user base hasn't installed the App.

## Design system additions

### Tokens (`apps/web/app/globals.css`)

```css
--source-claude:  #c08a4f;   /* warm tan */
--source-codex:   #6fa3b8;   /* slate-blue */
--source-cursor:  #b07ec0;   /* muted violet */
--source-human:   #8a8a82;   /* taupe */
--conf-high:      var(--positive);
--conf-med:       var(--warning);
--conf-low:       #6c6c66;
--chart-grid:     rgba(237, 232, 222, 0.06);
--chart-axis:     rgba(237, 232, 222, 0.24);
```

Component classes added: `.mk-stat-numeric` (KPI tiles), `.mk-table-cell` (mono dense rows). `tabular-nums` everywhere a number renders.

### Tailwind v4 compliance (REPEAT — global rule):
- `bg-(--source-claude)` NEVER `bg-[var(--source-claude)]`
- `bg-linear-to-r from-(--source-claude) to-(--source-codex)` NEVER `bg-gradient-to-r`
- `h-9` `w-150` `p-6` — never bracketed pixel values
- `rotate-45` NEVER `rotate-[45deg]`
- Run `npx prettier --write <file>` after editing component files

### Color-blind safety

Every place a `--source-*` color renders must ALSO render a non-color channel:

| Source | Hue | Pip glyph |
|---|---|---|
| claude | `--source-claude` | ◼ |
| codex | `--source-codex` | ▨ |
| cursor | `--source-cursor` | ▦ |
| human | `--source-human` | ◻ |

Legend is always adjacent to the chart, never tucked in a tooltip.

### Confidence affordances

3-pip indicator: `███` (high) / `██▒` (medium) / `█▒░` (low). Pip count is the accessibility carrier; color reinforces. Banner on PR detail when overall confidence <70%. Never silently drop low-confidence data — gray and label it.

### Charts

- Visx for Sankey / scatter quadrant / heatmap / xychart. Tree-shaken per route.
- Plain inline SVG for sparklines, source pip glyphs, attribution bars (4-rect).
- Sankey hard cap: 8 buckets. Above 50 sessions/week, fall back to stacked column.

### Motion (locked)

- Filter transitions: 220ms `cubic-bezier(0.2,0,0,1)`.
- Drill-in shared-element: 180ms.
- Hover-lift: 1px border color only (no translate, no shadow).
- Sankey hover: dim non-traversed bands to 20% opacity over 120ms.
- Decrypt-prompts reveal: 200ms fade.
- ALL motion wrapped in `@media (prefers-reduced-motion: no-preference)`. Default = no motion.

Banned: row enter/leave animations on data tables, KPI tile flips, page-load skeleton-to-content fade (skeletons must match loaded geometry).

### Mobile breakpoints

- `<768px`: nav rail collapses to bottom tabs.
- `<900px`: Sankey degrades to vertical bar chart.
- `<600px`: PR table swaps to card list.
- `<380px`: shows "Pellametric works best on desktop" with `View anyway` escape hatch.

## Environment variables added

```
GITHUB_APP_WEBHOOK_SECRET     # global HMAC secret for App-level webhook
INTERNAL_API_SECRET           # Bearer for /api/internal/* routes
INTERNAL_API_SECRET_PREVIOUS  # accepted during rotation (1 deploy cycle)
LINEAGE_ALERT_WEBHOOK         # optional Slack webhook for >2h cron staleness
PELLA_BLAME_ENABLED           # v2 feature flag (off by default)
```

Rotation: `INTERNAL_API_SECRET` rotated quarterly via Railway CLI. Workers (Bun cron) and web read same env. Access: 2 founders + on-call. Stored in 1Password.

## Commands added

```bash
# One-shot backfill of daily_user_stats / daily_org_stats from session_event
bun run --cwd apps/web scripts/backfill-daily-stats.ts

# One-shot seed demo data (~30 days of sessions + PRs + lineage)
bun run --cwd apps/web scripts/seed-demo.ts

# Trigger lineage for a single PR (debug; uses INTERNAL_API_SECRET)
curl -X POST $PELLAMETRIC_URL/api/internal/lineage/run \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"prId":"<uuid>"}'

# Force-refresh a PR's link from a UI button (rate-limited 1/min/PR)
curl -X POST $PELLAMETRIC_URL/api/lineage/relink/<prId> --cookie "..."

# Healthcheck
curl $PELLAMETRIC_URL/api/health/lineage  # 200=healthy, 503=heartbeat >90min stale
```

## Reference documents

- `dev-docs/presearch.md` — full presearch (mode REVISION)
- `dev-docs/PRD.md` — 8-phase plan, ~14 weeks, 33 challenger patches mapped
- `dev-docs/research-brief.md` — Loop 0 external research with citations
- `dev-docs/architect-proposal.md` — Loop 2 architect proposal (LOCKED + 8 open Qs)
- `dev-docs/design-council-proposal.md` — Loop 2 design council (mockups, IA, tokens)
- `dev-docs/challenger-report.md` — Loop 3/6 33 patches + 7 top exposures
- `dev-docs/ops-runbook.md` (Phase 8) — pricing-API drift handling
- `dev-docs/launch-checklist.md` (Phase 8) — pre-prod sign-off

---

## Things that explicitly didn't change in this revamp

For the avoidance of doubt — these existing conventions remain authoritative:

- Bun is package manager + runtime; no npm/yarn/pnpm.
- Collector has NO persisted cursor; server-side idempotency via unique `(userId, source, externalSessionId)` makes restarts safe.
- `aggregate.ts` `SESSION_CAP=2h`, overlapping-interval merging — still authoritative for per-session computations (not replaced by rollups, complemented).
- Per-user DEK envelope (AES-256-GCM) — same encryption scheme; only the route surface changed (no browser-decrypt).
- Drizzle workflow: schema changes via `bun run db:push`; no committed migrations.
- Conventional commits + PR title validation.
- `apps/web/lib/crypto/prompts.ts` is untouched. Decryption helpers are server-only.
