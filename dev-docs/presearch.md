# Pellametric Insights Revamp — Presearch (REVISION mode)

> Generated via `/presearch2` on branch `feat/insights-revamp`. Synthesizes Loop 0 (research) + Loop 2 (architect + design council) + Loop 3/6 (challenger stress-test). All 33 challenger patches are integrated into the locked decisions and PRD phases.
>
> Source agent outputs preserved in:
> - `dev-docs/research-brief.md`
> - `dev-docs/architect-proposal.md`
> - `dev-docs/design-council-proposal.md`
> - `dev-docs/challenger-report.md`

---

## Mode & Brief

**Mode:** REVISION. Existing codebase, schema, and conventions are preserved unless explicitly superseded.

**Brief:** Revamp Pellametric's UX and product experience to:
1. Improve Code Output Attribution.
2. Better interpret token usage vs GitHub code actions.
3. Unlock insights that actually matter.
4. Represent token usage against merged PRs.
5. Improve team insight presentation.

**Audience:** Two co-primary tracks — **Manager view** (org-level cost & throughput) and **Dev view** (personal session→PR lineage).

---

## Loop -1 — Codebase analysis

### What exists
- Bun monorepo (`apps/web` Next.js 16, `apps/collector` TS CLI, `packages/shared` wire types).
- Schema (`apps/web/lib/db/schema.ts`): `user`, `org`, `membership`, `apiToken`, `sessionEvent`, `pr`, `sessionPrLink`, `promptEvent`, `responseEvent`, `userPromptKey`, `uploadBatch`, plus better-auth core and GitLab credentials.
- Privacy: per-user DEK envelope encryption (AES-256-GCM). Master key in env. Managers cannot decrypt cross-user data.
- Aggregation: `apps/web/lib/aggregate.ts` runs in memory per page load. `SESSION_CAP=2h`. Outcome buckets exist but `shipped/in_review/in_progress` are always 0.
- PR data: GitLab populates `pr` via webhook; GitHub does NOT — `lib/gh.ts` live-fetches per request, capped at 50 PRs for LOC.
- Collector intent classifier: regex-only (`apps/collector/src/parsers/intent.ts`). No LLM.

### Design vs reality drift

| Designed (v1) | Actual | Gap |
|---|---|---|
| `session_pr_link` table | Schema exists; never populated anywhere | **The biggest gap.** All "what shipped" insights are blocked on this |
| `pr` table (provider-agnostic) | Only GitLab writes; GitHub live-fetches | No persisted GitHub PR history |
| Outcome buckets `shipped/in_review/in_progress` | Always 0 | Same root cause |
| `prAggForMember` 50-PR LOC cap | Documented limit | Bottleneck on team views |
| Commit-level data | Not captured | Required for AI source attribution |
| Cohort/benchmark views | Not implemented | Required for "improve team insight presentation" |

---

## Loop 0 — Research brief (key findings)

Full text: `dev-docs/research-brief.md`. Top findings:

| Topic | Finding | Confidence |
|---|---|---|
| PR↔session attribution | Industry pattern is multi-signal fusion (branch keyword, cwd, time, author). No public competitor uses `filesEdited↔PR.files` Jaccard — defensible novelty | High |
| Code provenance | `Co-Authored-By:` trailer works for Claude Code (reliable), unclear for Codex, **never** for Copilot. Cursor `agent-trace` is new and Cursor-specific | High |
| GitHub API budget | Webhook + GraphQL leaves >100× headroom for 100 orgs / 200 PRs/month. **Switch off `/search/issues`** | High |
| Aggregation | Persisted summary tables + worker = lowest-risk path. Skip pg_ivm (managed-PG hostile), skip Timescale (lock-in) | High |
| Privacy | k≥5 suppression standard. DP overkill until cross-org benchmarks ship | High |
| Design references | Linear / Swarmia / DX use precise, minimal, dense UIs. Sankey 8-10 nodes max. DX Core 4 (April 2026) is the freshest taxonomy | High |

---

## Loop 1 — Constraints (locked)

### 1.1 Audience & use cases
- **Manager:** Did the team spend AI budget well? Per-dev cost-per-PR. Source-attribution mix. Cohort percentile. Waste detection. Intent vs outcome.
- **Dev:** Where did MY tokens go? Session → commit → PR lineage. Personal cost-per-merged-PR. Prompt-to-PR traceability (self-decrypt only). Token efficiency.

### 1.2 Scale targets (initial)

| Metric | MVP | Production target |
|---|---|---|
| Active orgs | 5–20 | 100+ |
| Devs / org | 5–20 | up to 100 |
| Sessions / dev / day | 5–20 | same |
| Merged PRs / org / month | 50–200 | 200–1000 |
| Page-load latency (manager overview) | <800ms p50 | <300ms p50 |
| Cost-per-PR query | <100ms p95 | <50ms p95 |

### 1.3 Time / cost / skill

| Constraint | Value |
|---|---|
| Engineering capacity | Small team (single repo, Bun monorepo) |
| Hosting | Railway (web + Postgres). No Vercel/AWS dependencies |
| Time to ship | Phased — MVP slice (manager cost-per-PR + dev Sankey) in 4–6 weeks; full revamp in ~3 months |
| Budget impact | Schema growth ~10× row count for `pr_commit`; index footprint manageable on $30/mo Railway PG |

### 1.4 Data sensitivity (LOCKED)
- Prompt/response ciphertext is PII-adjacent and load-bearing private. Per-user DEK boundary must NOT be weakened.
- Cohort views must aggregate without decrypting.
- Commit messages may contain accidentally-pushed secrets — must be redacted on insert (P20).
- Manager sees aggregates + per-user counts, never plaintext.

### 1.5 Evaluation criteria (locked)
Mapped from the brief:

| Criterion | How we address it | Phase |
|---|---|---|
| Better code-output attribution | `pr_commit` + heuristic source detection + Sankey + per-PR source-mix bar | Phase 2, 4 |
| Token usage vs GitHub code actions | Persist GitHub PRs via App webhook + `session_pr_link` populated by lineage worker | Phase 1, 2 |
| Unlock insights that matter | `cost_per_pr`, intent-vs-outcome correlation, waste view, cohort benchmark | Phase 3, 5 |
| Token usage against merged PRs | `cost_per_pr` table + manager overview + per-PR detail view | Phase 2, 4 |
| Team insight presentation | Split routes (`/org` vs `/me`), bematist palette + AI-source colors + Visx charts | Phase 4, 5 |

---

## Loop 1.5 — Innovation discovery

| # | Innovation | Category | Effort | Impact | Classification |
|---|---|---|---|---|---|
| 1 | **Cost-per-merged-PR with confidence pips** (no competitor exposes attribution confidence) | Data-driven optimization | M | H | **CORE** (Phase 2) |
| 2 | **AI-source attribution bar on every PR** (Claude/Codex/Cursor/human) | Novel AI application | M | H | **CORE** (Phase 4) |
| 3 | **Dev session→commit→PR Sankey** as personal lineage hero | UX excellence | M | H | **CORE** (Phase 4) |
| 4 | **Privacy-preserving cohort benchmark** (k≥5/k≥10, intersection guard) | Production hardening | M | M | **CORE** (Phase 5) |
| 5 | **Waste detection** (stuck/dormant/zombie joined with PR lineage) | Domain intelligence | L | M | **CORE** (Phase 5) |
| 6 | Intent × outcome heatmap with deterministic insight callouts | Domain intelligence | L | M | **CORE** (Phase 5) |
| 7 | Sankey at-scale fallback to stacked column | UX excellence | L | L | **STRETCH** (Phase 4) |
| 8 | `git blame` line-level attribution | Domain intelligence | H | H | **STRETCH** (v2, behind `PELLA_BLAME_ENABLED`) |
| 9 | Cursor `agent-trace` ingestion | Novel AI application | H | M | **STRETCH** (v2, once spec stabilizes) |
| 10 | Org-level "AI footer policy" hygiene metric | Domain intelligence | L | L | **STRETCH** (Phase 5) |
| 11 | Manager-also-dev role switcher | UX excellence | S | M | **CORE** (Phase 4) |

---

## Loop 2 — Architecture (locked decisions)

### 2.1 Core pattern
Single Next.js app + lineage worker as **internal API routes** (no new container). Webhook-first data flow; live-fetch is fallback only.

```
GitHub App webhook ──▶ /api/github-webhook/[orgId]
                          │
                          ├─▶ pr (upsert)
                          ├─▶ pr_commit (hydrate from /pulls/{n}/commits)  [P1, P2, P3]
                          └─▶ lineage_job (enqueue)                          [P15]
                                  │
Collector ─▶ /api/ingest          ├─▶ /api/internal/lineage/run
            │                     │       │
            ├─▶ session_event     │       ├─▶ session_pr_link upsert
            ├─▶ prompt_event      │       └─▶ cost_per_pr upsert
            ├─▶ response_event    │
            └─▶ lineage_job       └─▶ /api/internal/lineage/sweep (cron 30 min)
                (enqueue)                 (safety net)

Dashboard reads from cost_per_pr, daily_user_stats, daily_org_stats (precomputed).
Manager + dev views split: /org/[provider]/[slug]/* vs /me/[provider]/[slug]/*
```

### 2.2 Tech stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun 1.3.9 | Existing |
| Web | Next.js 16 App Router | Existing |
| DB | Postgres via postgres-js + Drizzle | Existing |
| Auth | better-auth + GitHub OAuth + GitHub App | Existing |
| Charts | **Visx (`@visx/sankey`, `@visx/xychart`)** + inline SVG sparklines | New — tree-shakes per route, SSR-clean |
| Cron | Railway cron → internal API route | Existing pattern |
| Worker compute | Internal API routes (`/api/internal/lineage/*`) gated by `INTERNAL_API_SECRET` | New |

### 2.3 Data model additions (patched)

```ts
// pr — add 5 columns + 2 indexes
mergeCommitSha: text("merge_commit_sha"),
baseBranch: text("base_branch"),
headBranch: text("head_branch"),
lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
linkComputedAt: timestamp("link_computed_at"),
kind: text("kind").notNull().default("standard"),     // 'standard' | 'revert'       [P5]
revertsPrId: uuid("reverts_pr_id"),                   //                              [P5]
stackedOn: uuid("stacked_on"),                        //                              [P11]
// indexes: pr_by_merged_at, pr_by_head_branch

// pr_commit — NEW
{
  id, prId, orgId, sha,
  authorLogin, authorEmail, authorName, committerEmail,
  message,                                            // ≤1024 chars, redacted        [P20]
  messageRedacted: boolean,                           //                              [P20]
  additions, deletions, fileList,
  authoredAt,
  kind: text("kind").notNull().default("commit"),     // 'commit'|'squash_merge'|'merge_commit'  [P2]
  aiSources: text("ai_sources").array(),              // multi-source array            [P6]
  aiSignals: jsonb,
  aiConfidence: integer,
  createdAt,
}
// indexes: pr_commit_uniq (prId,sha); pr_commit_by_org_author; pr_commit_by_org_ai
// (drop pr_commit_by_email)                                                          [P29]

// session_event — add 2 columns
branch: text("branch"),                               // git rev-parse --abbrev-ref HEAD [P9]
cwdResolvedRepo: text("cwd_resolved_repo"),           // collector's resolved repo     [P14]

// session_pr_link — enriched
{
  sessionEventId, prId,
  fileOverlap, fileJaccard,                           // 0..100
  timeOverlap: text,                                  // 'within_pr_window'|'pre_pr'|'post_pr'|'none'
  cwdMatch: boolean, branchMatch: boolean,
  confidenceScore: integer,                           // 0..100
  confidence: text,                                   // 'high'|'medium'|'low'
  confidenceReason: jsonb,
  linkSource: text,                                   // 'auto'|'manual_dev'|'manual_manager'
  createdAt, updatedAt,
}

// model_pricing — NEW (replaces stored dollar columns)                              [P7]
{ model, effectiveFrom, effectiveTo, inputCentiPerMtok, outputCentiPerMtok,
  cacheReadCentiPerMtok, cacheWriteCentiPerMtok }

// daily_user_stats / daily_org_stats — NEW (rollups; tokens only, NO dollars)
// keys: (userId, orgId, day, source); (orgId, day, source)
// fields: sessions, activeHoursCenti, tokens*, messages, errors,
//         teacherMoments, frustrationSpikes, prsMerged*, prsMergedBot, computedAt
// UTC date boundary: prorate intervals across days touched                          [P12]

// cost_per_pr — NEW (rollup keyed by prId)
{ prId, orgId, linkedSessions, linkedUsers, tokensIn, tokensOut,
  totalSessionWallSec, highConfLinks, mediumConfLinks,
  pctClaude, pctCodex, pctCursor, pctHuman, pctBot,                                  [P6]
  priceVersion: integer,                                                              [P7]
  computedAt }

// lineage_job — NEW queue                                                            [P15]
{ id, prId, reason: text, priority: integer, scheduledFor, status, attempts, lastError, createdAt }
// indexes: (status, scheduledFor); (prId)

// system_health — NEW                                                                [P16]
{ component: text, lastRunAt, lastRunStatus, payload: jsonb }

// org — add 1 column
aiFooterPolicy: text("ai_footer_policy").default("optional"),  // 'required'|'forbidden'|'optional' [C6]
```

### 2.4 Lineage algorithm (final, patched)

**Gate** (`cwd_match`): use `sessionEvent.cwdResolvedRepo` (P14). Wrong repo → ×0. Unknown (null) → ×0.6 soft (P13). Right → ×1.

**Score** (gate-applied):
```
score = gate × (0.45·jaccard + 0.25·time + 0.15·branch + 0.15·authorship)
```

| Signal | Weight | Computation |
|---|---|---|
| `cwd_match` | gate | `session.cwdResolvedRepo == pr.repo` |
| `file_jaccard` | 0.45 | `|filesEdited ∩ pr.fileList∪prevFilenames| / |union|` (P10) |
| `time_overlap` | 0.25 | 1.0 if endedAt ∈ [createdAt−4h, mergedAt+1h]; 0.5 within ±48h; else 0 |
| `branch_hint` | 0.15 | `session.branch == pr.headBranch` — deterministic (P9) |
| `commit_authorship` | 0.15 | any `prCommit.kind='commit'` with matching `authorLogin` in window |

**Buckets**: high ≥0.7, medium ≥0.4, low ≥0.15, <0.15 drop. **Exception**: when `cwdMatch=true AND commit_authorship=true`, drop threshold falls to 0.10 (P10).

**Pre-squash hydration (P1)**: `pr_commit` rows for `kind='commit'` are written at `pull_request.opened` and `pull_request.synchronize`, not at merge. Force-push (`before` not ancestor of `after`) wipes + rehydrates (P3).

**Stacked PRs (P11)**: at webhook time, set `pr.stackedOn` when `baseBranch` matches another open PR's `headBranch`. `cost_per_pr` for parent subtracts the linkedSessions already attributed to children.

**Reverts (P5)**: title starts with `Revert "` or merge commit message contains `This reverts commit <sha>` → `pr.kind='revert'`, `pr.revertsPrId` set. Excluded from `prsMerged` and `prsMergedAiAssisted`. Surfaced via `revertRate` metric.

### 2.5 Attribution heuristic (final patched table)

See `dev-docs/challenger-report.md` §C. Highlights:
- `aiSources` is an **array** (P6) — mixed sessions preserved.
- Bot accounts get `aiSource='bot'` terminal (P4); excluded from human/AI denominator.
- Anthropic email alone is +30 src=unknown (P8) — must be corroborated with trailer for src=claude.
- Codex session-join inference: src=codex confidence 50 (P32).
- Cursor opt-in user setting biases inference (P31).
- `kind='merge_commit'` excluded from `SUM(additions)` percentages.

### 2.6 Aggregation refresh

| Surface | Cadence | Trigger |
|---|---|---|
| `pr` upsert | Immediate | Webhook |
| `pr_commit` (kind=commit) | Immediate | Webhook (opened/synchronize) |
| `pr_commit` (kind=squash_merge/merge_commit) | Immediate | Webhook (closed/merged) |
| `session_pr_link` for PR | <1s | Webhook → `/api/internal/lineage/run` |
| `cost_per_pr` for PR | <1s | Same trigger |
| `daily_user_stats` | 30 min sweep + on ingest | Worker |
| `daily_org_stats` | 30 min sweep | Worker |
| Full reconciliation | 02:00 UTC | Cron, safety net only |
| `lineage_job` queue drain | Continuous | Worker, by priority |

### 2.7 API additions

```
POST /api/github-webhook                       (no [orgId] — App-level secret in env, route resolves org by installation.id) [P22]
POST /api/internal/lineage/run         body:{ prId }      [Bearer INTERNAL_API_SECRET]
POST /api/internal/lineage/sweep                          [Bearer INTERNAL_API_SECRET]
POST /api/lineage/relink/:prId                            [session, manager-or-author, rate-limited 1/min/PR]
GET  /api/insights/cost-per-pr?orgSlug=&window=           [requireMembership, role=manager|dev for own]
GET  /api/insights/intent-outcomes?orgSlug=&window=       [requireMembership]
GET  /api/insights/cohort/:metric?orgSlug=&windowKey=     [requireMembership, role=manager, k≥5/k≥10] [P19, P21]
GET  /api/me/sessions/:id/prompts                         [session, userId===owner, 60/min]            [P18]
GET  /api/health/lineage                                  [returns 503 if heartbeat >90 min stale]    [P16]
```

### 2.8 Two-tier OAuth/App experience (P17)

`getPrsForOrg(orgId)` helper hides the branching:
- App-installed: read from `pr` + `pr_commit` + `cost_per_pr` (full features).
- OAuth-only: live-fetch via `lib/gh.ts` (top 50 PRs, no cost-per-PR, no attribution). Banner CTA: "Install GitHub App for full features."

---

## Loop 2 (continued) — Design (locked)

### Direction: Evolve palette + bolder layout

- **Keep** bematist warm-dark canvas, sage `--primary`, amber `--warning`, mono `mk-*` typography classes.
- **Add** four `--source-*` brand tokens (claude / codex / cursor / human) — non-negotiable.
- **Replace** `OrgViewSwitcher` Team/Myself tab with split routes (`/org/[provider]/[slug]/*` vs `/me/[provider]/[slug]/*`).
- **Move** to dense panel grids with shared borders on data pages. Keep card aesthetic on marketing/settings/onboarding.
- **Chart library**: Visx (Sankey/scatter/heatmap) + inline SVG sparklines. Each route's chart bundle <60KB.

### IA (route trees)

```
# Manager
/org/[provider]/[slug]/
  layout.tsx                        # shared org-shell layout (P28)
  (overview)/page.tsx               # "Did we spend well?"
  prs/{page.tsx, [number]/page.tsx}
  devs/{page.tsx, [login]/page.tsx}
  waste/page.tsx
  intent/page.tsx
  benchmark/page.tsx                # cohort k≥5/k≥10
  members/, invite/, policy/        # existing

# Dev
/me/[provider]/[slug]/
  layout.tsx
  (overview)/page.tsx               # personal Sankey lineage
  sessions/{page.tsx, [id]/page.tsx}
  prs/page.tsx
  efficiency/page.tsx
  waste/page.tsx

# Shared role switcher (P26) — top-right toggle
# Mobile (P25): <768px → bottom tabs; <900px Sankey → vertical bar;
#               <600px PR table → cards; <380px "desktop recommended"
```

### Key views (mockups in `dev-docs/design-council-proposal.md`)

| # | View | Audience | Innovation served |
|---|---|---|---|
| M1 | Manager Overview (4 stat tiles + spend-vs-throughput scatter + attribution mix bar) | Manager | 1, 2 |
| M2 | Cost-per-PR table (sortable, confidence pips, source-mix bars) | Manager | 1 |
| M3 | PR Detail (attribution bar + linked sessions + revert detection) | Manager | 2 |
| M4 | Dev Overview (Sankey hero, recent sessions feed) | Dev | 3 |
| M5 | Dev Session Detail (server-decrypted prompts in `/api/me/sessions/:id/prompts`) (P18) | Dev | own privacy |
| M6 | Cohort Benchmark (k-anonymity gated, intersection guard P19) | Manager | 4 |
| M7 | Waste view | Both | 5 |
| M8 | Intent × Outcome (with deterministic insight callouts) | Manager | 6 |

### Confidence affordances
- 3-pip indicator `███`/`██▒`/`█▒░` — pip count is the accessibility carrier; color reinforces.
- Page-level banner on PR detail when overall <70%.
- Plain-English explainer modal.
- Never silently drop low-confidence — gray + label.

---

## Loop 3 — Stress test results

Full report in `dev-docs/challenger-report.md`. 33 patches integrated above. **Top exposures (all addressed in PRD):**

1. **Pre-squash commits (P1/P2/P3)** — without these, AI attribution is 0% for any org using squash-merge.
2. **Reverts and bots (P4/P5)** — failed work being counted as positive throughput is worse than no metric.
3. **Dollar storage (P7)** — corrupts cost-per-PR on next pricing change.
4. **Browser-decrypt (P18)** — security theater; killed. Server-side only.
5. **Cohort intersection + membership trust (P19/P21)** — real vulns, not edge cases.
6. **Non-App orgs (P17)** — half the user base; two-tier experience locked.
7. **Heartbeat + monitoring (P16)** — silent staleness is the worst failure mode.

---

## Privacy preservation (locked)

1. **No aggregation path decrypts prompts/responses.** Lineage worker reads only `session_event`, `pr`, `pr_commit`, `membership`, `org`. Reads `prompt_event.{wordCount, tsPrompt, externalSessionId}` (metadata) — never ciphertext.
2. **Per-user DEK** only unwrapped when `session.user.id === row.userId`. Manager routes never carry that authority.
3. **Cohort metadata bucketing (P33):** `tsPrompt` rounded to hour granularity + ±30s jitter for non-owning views.
4. **k-anonymity (P19):** k≥5 within-org for system-defined cohorts; k≥10 for ad-hoc; cross-org k≥25 (deferred).
5. **Membership enforcement (P21):** all insights endpoints check `requireMembership(userId, orgSlug)` and return 403 (not 404).
6. **Commit message redaction (P20):** secrets regex (AWS_KEY, `gh[pous]_`, high-entropy ≥32 chars), truncate to 1024.
7. **Server-side decryption (P18):** `GET /api/me/sessions/:id/prompts` only. No browser-decrypt route. No `/api/me/prompt-key`.

---

## Cost analysis

### Dev cost
- Schema + worker: ~3-4 weeks
- Manager dashboard rebuild: ~3 weeks
- Dev dashboard + Sankey: ~3 weeks
- Cohort/benchmark/waste/intent: ~2-3 weeks
- Polish + mobile: ~1-2 weeks

### Runtime cost (per Researcher §C, §D)
- GitHub API: 100 orgs × 200 PRs/month × ~3 REST calls ≈ 60k calls/month per installation; well under 5000/hr/installation budget. Sync-storm dedup (P30) caps deploy-day peaks.
- DB: `pr_commit` ~10× row count of `pr`. At 200 PRs/month/org × 100 orgs × 10 commits/PR = 200k rows/month. ~$5-15/mo additional on Railway PG.
- Worker: lineage compute ~50-200 ms per PR. 30-min sweep caps at N=500. Even at full org backfill scale, fits inside Railway free tier.

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pricing API drift | High | High | `model_pricing` table; compute at read; cache w/ `priceVersion` (P7) |
| Squash-merge erasing trailers | High | Critical | Pre-squash hydration on `opened`/`synchronize` (P1) |
| Force-push rewriting history | Medium | High | Ancestry check + wipe+rehydrate (P3) |
| Bot PRs inflating metrics | High | Medium | `aiSource='bot'` enum (P4) |
| Reverts counted as throughput | High | High | Revert detection (P5) |
| Non-App orgs broken | High | Critical | Two-tier `getPrsForOrg()` (P17) |
| Browser-decrypt XSS | Medium | High | Kill design; server-side only (P18) |
| Cohort intersection attack | Medium | Medium | System-defined groups + query log + k≥10 ad-hoc (P19) |
| URL membership bypass | High | Critical | `requireMembership` middleware (P21) |
| Backfill collision with ingest | Medium | Medium | Rate-limited GraphQL, queued, banner UI (P23) |
| Cron silent staleness | Medium | High | `system_health` heartbeat + 503 health endpoint (P16) |
| Sankey unreadable at scale | High | Low | Bucket to 8 max + stacked column fallback (P24) |

---

## What we are NOT building (explicit non-goals)

- v1 `git blame` (deferred to v2 behind `PELLA_BLAME_ENABLED`)
- Cross-org public benchmark (deferred until k≥25 + DP design)
- Cursor `agent-trace` ingestion (deferred until spec stabilizes)
- Differential-privacy noise injection (overkill at our scale)
- Mobile-first design (responsive but desktop-primary)
- Real-time streaming (`/api/internal/lineage/run` is sync; no SSE/WebSocket)
- Manager → dev DM / annotation features (out of scope)
- LLM-generated insights/copy (use deterministic server-side rules)

---

## Decision log

All ✅ are LOCKED. ⚠ are flagged for revisit during build if blocking.

- ✅ GitHub App webhook persistence (kills live-fetch primary path)
- ✅ `pr_commit` table with `kind` discriminator; pre-squash hydration
- ✅ `session_pr_link` enrichment with 5-signal weighted confidence (cwd as gate)
- ✅ Persisted rollups (`daily_user_stats`, `daily_org_stats`, `cost_per_pr`); tokens only, no stored dollars
- ✅ `lineage_job` queue + `system_health` heartbeat + 02:00 UTC reconciliation sweep
- ✅ Two-tier OAuth-vs-App experience via `getPrsForOrg()` helper
- ✅ Split routes: `/org/.../*` (manager) and `/me/.../*` (dev) with shared layout at `[slug]/layout.tsx`
- ✅ Bematist palette + AI-source brand tokens (`--source-claude/codex/cursor/human`)
- ✅ Visx for charts; plain SVG for sparklines
- ✅ k≥5 within-org cohorts (k≥10 ad-hoc); intersection guard; membership middleware
- ✅ Server-side prompt decryption only (NO browser-decrypt design)
- ✅ Commit-message redaction on insert; 1024-char truncation
- ✅ Heuristic-only attribution v1; `aiSources` is text[]; bot/revert/merge_commit discriminators
- ✅ Collector captures `branch` and `cwdResolvedRepo`
- ✅ Sankey 8-bucket cap + stacked-column fallback at scale
- ⚠ Backfill window default 30d (not 90d); revisit after first 100-org deployment
- ⚠ `git blame` deferred to v2 — revisit after measuring v1 attribution accuracy in production
- ⚠ Mobile breakpoints specified; revisit if mobile usage >25% of sessions
