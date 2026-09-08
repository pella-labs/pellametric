# Pellametric — Challenger Report (presearch2, Loop 3 + Loop 6)

> Output of the Challenger agent (Opus 4.7). Attacks every load-bearing decision in the Architect / Researcher / Design proposals and produces the final 33-patch list for the PRD.

---

## A. Answers to the Architect's 8 open questions

**Q1 — GitHub App webhook secret storage: env vs `org_credentials`?**
**A:** Env (`GITHUB_APP_WEBHOOK_SECRET`), single global value. GitHub Apps have one webhook secret per App registration. Per-org rotation isn't possible without a separate App per org.

**Q2 — `cwd_match` gate brittleness for monorepos / worktrees.**
**A:** Keep as gate, but widen the definition. When `parsers/repo.ts` finds `.git` as a *file* (not dir), follow `gitdir:` indirection. For submodules, walk to outermost `.git/config`. Degrade to soft signal (score×0.6) if cwd resolution returned `null`; ×0 only if it returned a different repo. Don't punish "unknown" the same as "wrong".

**Q3 — Backfill on App install: 90d/100-repo org.**
**A:** Yes but use GraphQL (research §C: ~200 points total for 30d × 100 repos, free against 5000/hr budget). Default window 30 days not 90. DB write pressure during backfill is the real risk — rate-limit to 1 PR/sec, render "Backfilling N/M PRs" banner. Backfill rows get `linkComputedAt=null` and join the sweep tier, not hot path.

**Q4 — Squash-merges: pre vs post commits?**
**A:** **BOTH.** Add `pr_commit.kind: 'commit' | 'squash_merge' | 'merge_commit'`. Hydrate pre-squash commits at `opened`/`synchronize` events (before they become inaccessible via squash). Compute attribution from `kind='commit'` only.

**Q5 — `branchMatch` circularity. Collector capture branch?**
**A:** Yes. `sessionEvent.branch` populated by collector via `git rev-parse --abbrev-ref HEAD`. Lineage formula: `branchMatch = (session.branch == pr.headBranch)`. Deterministic, not a circular text search.

**Q6 — Cursor blindness.**
**A:** NOT acceptable as designed. Patch options: (a) opt-in user setting "I use Cursor" biases unknown commits toward `cursor` when linked session has `source=cursor`; (b) read Cursor's emerging `agent-trace` file when stable. Ship (a) in v1.

**Q7 — Pricing drift on `estCostUsdCenti`.**
**A:** Store tokens only. Add `model_pricing(model, effectiveFrom, effectiveTo, …Centi…)` table. Compute cost at read time. Cache only as `estCostUsdCenti + priceVersion` with explicit invalidation. NEVER store dollar amount as a column-of-truth.

**Q8 — Late-arriving sessions.**
**A:** Add `lineage_job(prId, reason, priority, scheduledFor, status)` queue. Ingest enqueues jobs when a session arrives for an org with PRs in the session's window. Worker drains by priority. Nightly sweep = safety net only.

---

## B. Lineage failure modes (8)

| # | Failure mode | Today | Impact | Patch |
|---|---|---|---|---|
| **B1** | Squash-merge collapses N commits → 1; trailers lost | `aiSource=null` falls to `human`. 0% Claude attribution. | False negative on every squash-merged PR | Hydrate `pr_commit` from `/pulls/{n}/commits` at `opened`/`synchronize`, not merge |
| **B2** | Force-push rewrites history | Old `pr_commit` rows orphaned; new rows added → double-count | Data corruption | Detect via `before`/`after` ancestry on `synchronize`; wipe + rehydrate `kind='commit'` rows |
| **B3** | Session edits file deleted in PR | Jaccard=0; falls below threshold | False negative on deletion PRs | Pull `previous_filename` from `/files`; expand `pr.fileList` to include old+new paths. Lower drop threshold to 0.10 when `cwdMatch+authorship` already strong |
| **B4** | Stacked PRs (A's base = B's head) | Sessions match both → both linked → cost double-counted | False positive on cost | Detect `pr.stackedOn`. Subtract child cost from parent in `cost_per_pr` |
| **B5** | Bot commits (renovate, dependabot) | Falls to `human` | Bot PRs inflate throughput, dilute cost-per-PR | Add `aiSource='bot'` enum; match `*[bot]` logins + known bot emails. Exclude from prsMerged |
| **B6** | Reverts (PR + auto-revert PR) | Both counted in throughput | Failed work counted as positive — worst possible direction | Detect `Revert "` titles. Set `pr.kind='revert', pr.revertsPrId`. Subtract from prsMerged. Show revertRate |
| **B7** | Merged PR with `headBranch=null` | branchMatch always 0 | ~15% confidence loss | Persist `head.ref` from API at close-time; fall back to first commit SHA match |
| **B8** | Sessions across UTC date boundary | Whole session attributed to start date | ~5% accuracy loss on dailies | Split intervals at day boundary in worker upsert; prorate to every day touched |
| **B9** | Collector cwd ≠ claimed repo | Server trusts `s.repo` for gate | False-positive cross-repo linkage | Add `sessionEvent.cwdResolvedRepo`; gate uses resolved value |

---

## C. Attribution heuristic stress tests (7 scenarios)

| # | Scenario | Today | Correct? | Fix |
|---|---|---|---|---|
| C1 | Squash-merged, trailers lost | `aiSource=null` → human | WRONG | Pre-squash hydration (B1 patch) |
| C2 | Team uses Anthropic SDK; commits authored by `noreply@anthropic.com` but written by humans | +80 src=claude | WRONG | Tighten: email alone +30 src=unknown; require corroborating trailer for +80 src=claude |
| C3 | Mixed Claude+Cursor session | First match wins (probably Claude) | AMBIGUOUS | `aiSources text[]`; per-source % columns in `costPerPr` |
| C4 | Codex emits no trailer | Falls to `human` | WRONG | Session-join inference: codex source + commit_authorship match + no trailer → src=codex confidence 50 |
| C5 | GitHub auto-generated merge commit | Falls to `human` | Should be `kind='merge_commit'` excluded from attribution math | (B1 patch — kind discriminator) |
| C6 | `🤖 Generated with [Claude Code]` footer | +90 src=claude | Correct for math, but team policy violated | Add `org.aiFooterPolicy` flag; surface violators |
| C7 | Bot accounts | Falls to `human` | WRONG | (B5 patch — `aiSource='bot'`) |

### Patched heuristic table

| Signal | Weight | Source |
|---|---|---|
| `*[bot]` login OR known bot email | **+100 terminal** | **`bot`** |
| `Co-Authored-By: Claude` AND `noreply@anthropic.com` | +90 | claude |
| `Co-Authored-By: Claude` alone | +60 | claude |
| `Co-Authored-By: Codex` / `Codex AI` | +60 | codex |
| `Co-Authored-By: Cursor` | +60 | cursor |
| `🤖 Generated with [Claude Code]` footer | +90 | claude |
| `noreply@anthropic.com` author, no trailer | +30 (was +80) | unknown |
| `cursor@cursor.sh` author | +70 | cursor |
| Session-join (linked session source X, commit no trailer) | +50 | session.source |
| Multiple sources detected | array merge | array |
| Merge commit (`web-flow`, parent-count ≥2) | terminal | `kind='merge_commit'`, exclude |
| Default | — | human |

---

## D. Privacy attacks (5)

| # | Attack | Fix |
|---|---|---|
| **D1** | Cohort intersection: two cohorts differing by one member reveal that member by subtraction | Lock cohort selection to system-defined groups OR raise k=10 for ad-hoc. Log per-manager queries; refuse queries differing by <2 from a recent one |
| **D2** | Commit messages contain accidentally-pushed secrets | Pre-insert regex scan (AWS_KEY, `gh[pous]_`, high-entropy ≥32 chars). Replace with `[REDACTED:type]`. `messageRedacted=true`. Truncate to 1024 chars |
| **D3** | Per-second prompt timing + count + author is a deanonymization vector | Bucket `tsPrompt` to hour granularity in cohort views. Add ±30s jitter on read for non-owning users |
| **D4** | **Browser-decrypt design is security theater** without a passphrase-derived second factor — server already has master key, adds XSS surface | **Do NOT ship `/api/me/prompt-key`.** Decrypt server-side in single endpoint `/api/me/sessions/[id]/prompts`. Rate-limit 60/min. `Cache-Control: no-store` |
| **D5** | `?orgSlug=` trusted by cohort endpoint | `requireMembership(userId, orgSlug)` at route entry. 403 not 404. Require role=manager for cohort views |

---

## E. Design IA issues (6)

| # | Issue | Fix |
|---|---|---|
| **E1** | Manager-who-is-also-a-dev has no role switcher between `/org/...` and `/me/...` | Persistent top-right toggle `[Team view] / [My view]`. Cookie-persisted |
| **E2** | `(overview)` route group misunderstanding — `(group)` is sibling not parent | Shared org-shell layout lives at `app/org/[provider]/[slug]/layout.tsx`, NOT inside `(overview)` |
| **E3** | Sankey unreadable at scale (~100 sessions) | Cap at 8 buckets by source/intent (not per-session). Fall back to stacked column at >50 sessions/week |
| **E4** | Wrapped DEK in browser storage exposure | (D4 fix — kill browser-decrypt entirely) |
| **E5** | `?view=me` deep links 404 silently when switcher deleted | Keep `org-view-switcher.tsx` as 301 redirect shim for one release. Add `next.config.js` redirects |
| **E6** | Mobile not addressed in mockups | <768px: nav rail → bottom tabs. <900px: Sankey → vertical bar. <600px: PR table → card list. <380px: "best on desktop" + escape hatch |

---

## F. Rollout / migration risks (5)

| # | Risk | Fix |
|---|---|---|
| **F1** | Backfill chicken-and-egg for `daily_user_stats` | One-shot migration `apps/web/scripts/backfill-daily-stats.ts`. Cursor-paginated, rate-limited. `backfill_state` table tracks progress. Resumable |
| **F2** | Railway cron has no failure-mode story | `system_health(component, lastRunAt, lastRunStatus)` heartbeat. Banner if >90 min stale. `/api/health/lineage` returns 503 if stale. Optional Slack webhook for >2h |
| **F3** | Non-App orgs (half the user base) silently lose features | Two-tier experience: App-installed = full features; OAuth-only = live-fetch fallback (top 50 PRs, no cost-per-PR, no attribution) + prominent CTA banner |
| **F4** | Page-load App-vs-OAuth branching | Single `getPrsForOrg(orgId)` helper. Same shape regardless |
| **F5** | `INTERNAL_API_SECRET` rotation | Quarterly via Railway CLI. `INTERNAL_API_SECRET_PREVIOUS` allows dual-acceptance for 1 cycle |

---

## G. Cost & operational complexity (4)

| # | Concern | Fix |
|---|---|---|
| **G1** | `pr_commit` indexes (3 proposed) | Drop `byEmail` — no read path needs it. Keep `(orgId, authorLogin, authoredAt)` and `(orgId, aiSource, authoredAt)` |
| **G2** | Nightly sweep timeout on App-install backfill | Cap N=500/invocation. Add `priority` column to `lineage_job`. Backfill drains over multiple cron runs |
| **G3** | GitHub API budget during deploy storms (~20 sync events/min) | Switch hydration to GraphQL. Dedup `synchronize` for same PR within 60s |
| **G4** | Dollar pricing drift | (A7 fix — store tokens, compute at read time) |

---

## H. Final 33-patch list

| # | Patch | Affects | Severity |
|---|---|---|---|
| **P1** | Pre-squash commit hydration on opened/synchronize, not merge | webhook handler / pr_commit | **Critical** |
| **P2** | `pr_commit.kind` discriminator (`commit` / `squash_merge` / `merge_commit`) | schema.ts | **Critical** |
| **P3** | Force-push detection: ancestry check on `before`/`after`, wipe + rehydrate | webhook handler | High |
| **P4** | Bot author classification: `aiSource='bot'` + separate `prsMergedBot` | heuristic + daily_org_stats | High |
| **P5** | Revert PR detection: `pr.kind='revert'`, `revertsPrId`, subtract from prsMerged | schema + UI | High |
| **P6** | Multi-source `aiSources text[]` array | pr_commit | Medium |
| **P7** | Drop dollar storage; add `model_pricing` table; compute at read time | schema + queries | High |
| **P8** | Anthropic email alone → +30 unknown (was +80 claude) | heuristic | High |
| **P9** | Collector captures `git rev-parse --abbrev-ref HEAD` per session; deterministic branchMatch | collector + sessionEvent.branch | High |
| **P10** | Rename-aware file overlap via `previous_filename` | lineage worker | High |
| **P11** | Stacked PR detection + cost subtraction | pr.stackedOn + cost_per_pr | High |
| **P12** | Split daily_user_stats intervals at UTC date boundary | lineage worker | Medium |
| **P13** | Worktree + submodule cwd resolution; soft signal for "unknown" cwd | apps/collector/src/parsers/repo.ts | Medium |
| **P14** | `cwdResolvedRepo` column on sessionEvent | schema + collector + lineage gate | Medium |
| **P15** | `lineage_job` queue table | schema + ingest + worker | High |
| **P16** | `system_health` heartbeat + `/api/health/lineage` + banner | new table + worker + UI | High |
| **P17** | Two-tier OAuth-vs-App experience via `getPrsForOrg(orgId)` helper | dashboard + lib/gh.ts | **Critical** |
| **P18** | **Kill browser-decrypt design.** Server-side `/api/me/sessions/[id]/prompts` only | design + new route | **Critical** |
| **P19** | Cohort intersection guard: lock to system groups OR raise k=10 + query log | /api/insights/cohort | High |
| **P20** | Commit message redaction (regex secrets, ≤1024 chars) | pr_commit insert | High |
| **P21** | Membership enforcement on cohort endpoint (`requireMembership`, 403, role=manager) | /api/insights/cohort | **Critical** |
| **P22** | Webhook secret = env (`GITHUB_APP_WEBHOOK_SECRET`), not per-org | github-webhook | Medium |
| **P23** | Backfill via GraphQL, 30d default (not 90), 1 PR/sec, UI progress banner | worker + dashboard | Medium |
| **P24** | Sankey cap at 8 buckets; fall back to stacked column >50 sessions/week | design | Medium |
| **P25** | Mobile breakpoints: <768px tabs, <900px Sankey→bar, <600px cards, <380px desktop-only | design | Low |
| **P26** | Manager-also-dev role switcher in nav | shell | Medium |
| **P27** | `?view=me` 301 redirect shim for one release | org-view-switcher.tsx + next.config | Low |
| **P28** | App Router layout lives at `[slug]/layout.tsx`, not inside `(overview)` group | PRD wording | Low |
| **P29** | Drop `pr_commit_by_email` index | schema | Low |
| **P30** | Webhook synchronize dedup within 60s | github-webhook | Medium |
| **P31** | Cursor opt-in user-level inference | settings + heuristic | Medium |
| **P32** | Codex session-join inference (src=codex, conf=50, when corroborated) | heuristic | Medium |
| **P33** | Prompt metadata bucketing in cohort views (hour granularity + ±30s jitter) | cohort queries | Medium |

---

## Top 7 exposures

1. **Pre-squash commits (P1/P2/P3)** — determines whether AI attribution works at all
2. **Reverts and bots (P4/P5)** — failed work counted as positive throughput
3. **Dollar storage (P7)** — corrupts headline cost-per-PR metric on next pricing change
4. **Browser-decrypt (P18)** — security theater; pull it
5. **Cohort intersection + membership trust (P19/P21)** — real vulns, not edge cases
6. **Non-App orgs (P17)** — half the user base; Architect locks them out without saying so
7. **Heartbeat + monitoring (P16)** — silent staleness is worst possible failure mode
