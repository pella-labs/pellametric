# Pellametric — Session ↔ PR Lineage Architecture Proposal (Architect, Loop 2)

> Output of the Architect agent (Opus 4.6). Proposes the full data model + lineage + aggregation architecture. Has 8 open questions for the Challenger to attack in Loop 3.

## 1. Executive summary

Pellametric's product thesis — "show managers and devs how much value AI coding sessions produce" — is currently broken at the most important seam: there is no persisted connection between `session_event` rows and the `pr` rows we already model. `session_pr_link` exists but is never populated; `aggregate.ts` always renders `shipped`/`in_review`/`in_progress` outcomes as zero because of this gap; and GitHub PRs are not persisted at all (live-fetched per request from `lib/gh.ts`, max 50 detailed records). The proposal locks five decisions: (1) **mirror the existing GitLab webhook persistence pattern for GitHub via the already-installed GitHub App**, eliminating live-fetch entirely; (2) **add a normalized `pr_commit` table** so authorship signals (co-authored-by trailers, AI bot email patterns, large monolithic-AI-shaped diffs) are first-class rows, not parsed at read time; (3) **populate `session_pr_link` from a Bun worker on PR-merge events plus a nightly sweep**, using a five-signal weighted confidence formula with `cwd→repo` as a deterministic gate; (4) **add three materialized rollup tables** (`daily_user_stats`, `daily_org_stats`, `cost_per_pr`) refreshed by the same worker, replacing in-memory aggregation for the dashboard hot path; (5) **enforce k≥5 anonymity for any cross-user cohort view and forbid prompt decryption in any aggregation path**, keeping the per-user DEK boundary load-bearing. v1 is heuristic-only attribution (no git blame); v2 adds optional blame for "% of PR by AI source". All schema is append-only and reversible.

---

## 2. Schema additions

### 2.1 GitHub PR persistence — locked pattern

| Option | Latency | Coverage | Auth | Cost | Verdict |
|---|---|---|---|---|---|
| Live-fetch per request (today) | 5-min cache, ~1-2s/page | First 50 PRs only for LOC | User OAuth | Wasted API every load | Reject — known bottleneck |
| Per-user OAuth polling worker | 1-15 min | Full | User OAuth, breaks on revoke | Per-user rate limits | Reject |
| **GitHub App webhook → DB** | ~1s | Full + historical backfill | Installation token | One install | **LOCKED** |
| GraphQL nightly snapshot | 24h | Full | App | Cheap | Reject — too slow for "is my PR merged" UX |

**LOCKED: GitHub App webhook persistence, mirroring `app/api/gitlab-webhook/[orgId]/route.ts`** because the GitHub App is already installed (`org.githubAppInstallationId`), org-scoped (no user-revoke risk), and gives us merge events in real time. `lib/gh.ts` becomes fallback for orgs without the App.

**New route**: `POST /api/github-webhook/[orgId]` — HMAC-SHA-256 verifies `X-Hub-Signature-256`. Handles `pull_request`, `pull_request_review`, `push`, `installation`, `installation_repositories`.

**Additions to existing `pr` table:**

```ts
mergeCommitSha: text("merge_commit_sha"),
baseBranch: text("base_branch"),
headBranch: text("head_branch"),
lastSyncedAt: timestamp("last_synced_at").notNull().defaultNow(),
linkComputedAt: timestamp("link_computed_at"),
```

New indexes: `pr_by_merged_at` on `(orgId, mergedAt DESC) WHERE state='merged'`, `pr_by_head_branch` on `(orgId, repo, headBranch)`.

### 2.2 `pr_commit` — commit-level rows

| Option | Schema simplicity | Attribution accuracy | Query cost | Storage |
|---|---|---|---|---|
| Embed array in `pr.fileList` style | Simple | Poor — can't index author/email | Slow | Small |
| **Separate `pr_commit` table** | Medium | High — index on email, message | Fast | ~10× more rows than `pr` |
| Only store at merge | Simple | Loses force-pushed history | Fast | Small |
| Store every commit on every push event | Heavy | Highest | Medium | Large |

**LOCKED: separate `pr_commit` table, populated on `pull_request` merged event only**. Force-pushed history loss is acceptable — managers care about what shipped.

```ts
export const prCommit = pgTable("pr_commit", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id").notNull().references(() => pr.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  sha: text("sha").notNull(),
  authorLogin: text("author_login"),
  authorEmail: text("author_email"),
  authorName: text("author_name"),
  committerEmail: text("committer_email"),
  message: text("message").notNull(),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  fileList: jsonb("file_list").notNull().default([]),
  authoredAt: timestamp("authored_at").notNull(),
  aiSource: text("ai_source"),           // 'claude' | 'codex' | 'cursor' | 'copilot' | 'human' | null
  aiSignals: jsonb("ai_signals").notNull().default({}),
  aiConfidence: integer("ai_confidence").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
  uniq: uniqueIndex("pr_commit_uniq").on(t.prId, t.sha),
  byOrgAuthor: index("pr_commit_by_org_author").on(t.orgId, t.authorLogin, t.authoredAt),
  byOrgAi: index("pr_commit_by_org_ai").on(t.orgId, t.aiSource, t.authoredAt),
  byEmail: index("pr_commit_by_email").on(t.authorEmail),
}));
```

### 2.3 `pr_file_blame` — deferred to v2

| Source of truth | Effort | Accuracy | Repo access required? |
|---|---|---|---|
| Heuristic per-commit (LOC ÷ files) | Low | ±30% | No |
| `git blame` on merged HEAD | High | High | **Yes — `contents:read`** |
| Hybrid: blame only on PRs ≥ threshold | Medium | High where it matters | Yes |

**LOCKED: deferred to v2** — git blame requires cloning, sandboxed worker, 5-50 MB disk/repo. Ship v1 commit-level first.

### 2.4 `session_pr_link` enrichment

```ts
export const sessionPrLink = pgTable("session_pr_link", {
  sessionEventId: uuid("session_event_id").notNull().references(() => sessionEvent.id, { onDelete: "cascade" }),
  prId: uuid("pr_id").notNull().references(() => pr.id, { onDelete: "cascade" }),
  fileOverlap: integer("file_overlap").notNull().default(0),
  fileJaccard: integer("file_jaccard").notNull().default(0),       // 0..100
  timeOverlap: text("time_overlap").notNull().default("none"),     // 'within_pr_window' | 'pre_pr' | 'post_pr' | 'none'
  cwdMatch: boolean("cwd_match").notNull().default(false),
  branchMatch: boolean("branch_match").notNull().default(false),
  confidenceScore: integer("confidence_score").notNull().default(0),
  confidence: text("confidence").notNull().default("low"),
  confidenceReason: jsonb("confidence_reason").notNull().default({}),
  linkSource: text("link_source").notNull().default("auto"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.sessionEventId, t.prId] }),
  byPr: index("link_by_pr").on(t.prId),
  bySession: index("link_by_session").on(t.sessionEventId),
  byOrgConfidence: index("link_by_confidence").on(t.prId, t.confidenceScore),
}));
```

### 2.5 Materialized rollups

| Approach | Refresh cost | Query latency | Operational | Schema drift risk |
|---|---|---|---|---|
| In-memory aggregate.ts (today) | 0 | 100-800ms/page | Zero | None |
| Postgres MATERIALIZED VIEW | High (full refresh) | <50ms | Medium | Schema-locked |
| **Persisted summary tables, worker-upserted** | Incremental | <20ms | Low | None |
| Timescale continuous aggregates | Low | <20ms | High — adds extension | Locks to Timescale |

**LOCKED: persisted summary tables, upserted incrementally by the lineage worker.**

```ts
export const dailyUserStats = pgTable("daily_user_stats", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  day: text("day").notNull(),                  // 'YYYY-MM-DD' UTC
  source: text("source").notNull(),            // 'claude'|'codex'|'all'
  sessions: integer("sessions").notNull().default(0),
  activeHoursCenti: integer("active_hours_centi").notNull().default(0),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
  tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  messages: integer("messages").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  teacherMoments: integer("teacher_moments").notNull().default(0),
  frustrationSpikes: integer("frustration_spikes").notNull().default(0),
  estCostUsdCenti: integer("est_cost_usd_centi").notNull().default(0),
  prsMergedLinked: integer("prs_merged_linked").notNull().default(0),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.userId, t.orgId, t.day, t.source] }),
  byOrgDay: index("daily_user_by_org_day").on(t.orgId, t.day),
}));

export const dailyOrgStats = pgTable("daily_org_stats", {
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  source: text("source").notNull(),
  activeUsers: integer("active_users").notNull().default(0),
  sessions: integer("sessions").notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  estCostUsdCenti: integer("est_cost_usd_centi").notNull().default(0),
  prsOpened: integer("prs_opened").notNull().default(0),
  prsMerged: integer("prs_merged").notNull().default(0),
  prsMergedAiAssisted: integer("prs_merged_ai_assisted").notNull().default(0),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, t => ({
  pk: primaryKey({ columns: [t.orgId, t.day, t.source] }),
}));

export const costPerPr = pgTable("cost_per_pr", {
  prId: uuid("pr_id").primaryKey().references(() => pr.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => org.id, { onDelete: "cascade" }),
  linkedSessions: integer("linked_sessions").notNull().default(0),
  linkedUsers: integer("linked_users").notNull().default(0),
  tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
  tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
  estCostUsdCenti: integer("est_cost_usd_centi").notNull().default(0),
  totalSessionWallSec: integer("total_session_wall_sec").notNull().default(0),
  highConfLinks: integer("high_conf_links").notNull().default(0),
  mediumConfLinks: integer("medium_conf_links").notNull().default(0),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, t => ({
  byOrg: index("cost_per_pr_by_org").on(t.orgId),
}));
```

---

## 3. Lineage algorithm

### 3.1 Trigger

| Trigger | Latency | Cost | Failure-recovery |
|---|---|---|---|
| Only on PR merge webhook | <1 min | Cheap | Lost events stay unlinked forever |
| Only nightly batch | up to 24h | Cheap | Self-healing |
| **Merge webhook + nightly sweep** | <1 min hot path; 24h healing | Medium | Self-healing |
| Real-time stream (every session insert) | sub-second | Expensive | Self-healing |

**LOCKED: webhook (on `pull_request.closed && merged=true`) + nightly sweep.**

### 3.2 Confidence formula

Five signals normalized to `[0,1]`, weights summing to 1.0. `cwd→repo` is a **deterministic gate** (multiplier ×0 or ×1) — asymmetric on purpose; we refuse to guess across repos.

| Signal | Weight | Computation |
|---|---|---|
| **gate** `cwd_match` | gate | `session.repo === pr.repo` (collector already resolves cwd→repo) |
| `file_jaccard` | 0.45 | `\|files_edited ∩ pr.fileList\| / \|files_edited ∪ pr.fileList\|` |
| `time_overlap` | 0.25 | 1.0 if `session.endedAt ∈ [pr.createdAt-4h, pr.mergedAt+1h]`; 0.5 if within ±48h of window; 0 otherwise |
| `branch_hint` | 0.15 | 1.0 if `pr.headBranch` appears in any `prCommit.message` authored during the session window |
| `commit_authorship` | 0.15 | 1.0 if any `prCommit` has `authorLogin == session.user.githubLogin` AND `authoredAt ∈ [session.startedAt, session.endedAt+24h]` |

**Score**: `score = gate × (0.45·jaccard + 0.25·time + 0.15·branch + 0.15·authorship)`.

**Buckets**: high ≥ 0.7, medium ≥ 0.4, low ≥ 0.15, <0.15 → no row.

### 3.3 Pseudocode

```ts
async function linkPr(prId: uuid) {
  const pr = await getPr(prId);
  if (!pr || pr.state !== "merged") return;

  const winStart = new Date(pr.createdAt.getTime() - 14 * 86400_000);
  const winEnd = new Date((pr.mergedAt ?? pr.updatedAt).getTime() + 3600_000);

  const candidates = await db.select().from(sessionEvent).where(and(
    eq(sessionEvent.orgId, pr.orgId),
    eq(sessionEvent.repo, pr.repo),
    gte(sessionEvent.startedAt, winStart),
    lte(sessionEvent.endedAt, winEnd),
  ));

  const commits = await db.select().from(prCommit).where(eq(prCommit.prId, pr.id));
  const prFiles = new Set(pr.fileList as string[]);

  const rows = [];
  for (const s of candidates) {
    const sFiles = new Set(s.filesEdited as string[]);
    const intersect = [...sFiles].filter(f => prFiles.has(f)).length;
    const union = new Set([...sFiles, ...prFiles]).size || 1;
    const jaccard = intersect / union;

    const inWindow = s.endedAt >= new Date(pr.createdAt.getTime() - 4*3600_000)
                  && s.endedAt <= new Date((pr.mergedAt ?? pr.updatedAt).getTime() + 3600_000);
    const time = inWindow ? 1.0
              : Math.abs(s.endedAt.getTime() - pr.createdAt.getTime()) < 48*3600_000 ? 0.5
              : 0;

    const branchHit = pr.headBranch && commits.some(c =>
      c.message.toLowerCase().includes(pr.headBranch.toLowerCase()) &&
      c.authoredAt >= s.startedAt && c.authoredAt <= new Date(s.endedAt.getTime() + 24*3600_000));

    const userLogin = await getGithubLogin(s.userId);
    const authorship = commits.some(c =>
      c.authorLogin === userLogin &&
      c.authoredAt >= s.startedAt && c.authoredAt <= new Date(s.endedAt.getTime() + 24*3600_000));

    const score = 0.45*jaccard + 0.25*time + 0.15*(branchHit?1:0) + 0.15*(authorship?1:0);

    if (score < 0.15) continue;
    rows.push({
      sessionEventId: s.id, prId: pr.id,
      fileOverlap: intersect, fileJaccard: Math.round(jaccard*100),
      timeOverlap: inWindow ? "within_pr_window" : (s.endedAt < pr.createdAt ? "pre_pr" : "post_pr"),
      cwdMatch: true, branchMatch: !!branchHit,
      confidenceScore: Math.round(score*100),
      confidence: score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low",
      confidenceReason: { jaccard, time, branch: !!branchHit, authorship, gate: true },
      linkSource: "auto",
    });
  }
  await db.insert(sessionPrLink).values(rows).onConflictDoUpdate({ /* ... */ });
  await db.update(pr).set({ linkComputedAt: new Date() }).where(eq(pr.id, prId));
  await refreshCostPerPr(prId);
}
```

### 3.4 Multi-PR / multi-session
- Session→2 PRs: both links written; dashboard picks `MAX(confidenceScore)` for bucketing.
- PR with N sessions: all linked. `cost_per_pr` sums only `high`+`medium`.
- Session without PR link: existing `aggregate.ts` outcome buckets unchanged.

---

## 4. Code-output attribution algorithm

### 4.1 Heuristic signals (commit-level, v1)

| Signal | Source | Weight | Notes |
|---|---|---|---|
| `Co-authored-by: Claude` trailer | message | +60, src=claude | Claude Code emits this when configured |
| `Co-authored-by: Codex` / `OpenAI` trailer | message | +60, src=codex | |
| `Co-authored-by: Cursor` trailer | message | +60, src=cursor | |
| `noreply@anthropic.com` author/committer | header | +80, src=claude | |
| `cursor@...` author email | header | +70, src=cursor | |
| `[skip ci]` + `chore(` + zero-prose | shape | +5, src=unknown | weak |
| ≥8 files AND ≥200 LOC in one commit, no human co-author | shape | +15, src=unknown | monolithic AI commit |
| `🤖 Generated with [Claude Code]` footer | footer | +90, src=claude | high-confidence signature |
| Linked session within window edited ≥80% of commit files | join | +25, src=session.source | promotes when high-confidence link exists |
| Default | — | src=human, conf=80 | |

Final source: highest-weighted positive signal; confidence = capped sum.

### 4.2 Comparison

| Approach | Effort | Accuracy | Coverage | Privacy |
|---|---|---|---|---|
| **Heuristic-only v1** | 1 week | 70-85% if tools write trailers; 50-60% otherwise | High | None |
| Trailer strict | 0.5 week | 95% when present; null otherwise | Low | None |
| `git blame` v2 | 3-4 weeks | 92-97% | High but needs `contents:read` | Cached commit messages on infra |

**LOCKED v1: heuristic-only. v2: feature-flagged `git blame` for PRs where heuristic confidence <60 and PR is large.**

### 4.3 "% of PR by source"

Computed at write time, served from `cost_per_pr`:

```sql
SELECT
  SUM(CASE WHEN ai_source='claude' THEN additions ELSE 0 END)::float / NULLIF(SUM(additions),0) AS pct_claude,
  ...
FROM pr_commit WHERE pr_id = $1;
```

Without blame, this is **LOC-by-commit** not **LOC-by-line**. UI labels metric "Claude commits %" to avoid lying. v2 blame upgrades to true line-level.

---

## 5. Aggregation / refresh architecture

### 5.1 Worker host

| Host | Cold-start | Idempotency | Coupling | Cost |
|---|---|---|---|---|
| **Next.js internal API route + Railway cron** | Cold | Easy via upserts | Tight to web | Free |
| Bun script invoked by Railway cron + webhook entry | Warm | Easy | Loose | Free |
| Separate `apps/worker` container | Always warm | Easy | Loose | Extra container |
| Inngest / Trigger.dev | n/a | Managed | New SaaS | Paid |

**LOCKED: `apps/web/app/api/internal/lineage/{run,sweep}/route.ts`** invoked by (a) webhook synchronously on merge and (b) Railway cron every 30 min. Gated by `INTERNAL_API_SECRET`.

### 5.2 Refresh cadence

| Surface | Cadence | Why |
|---|---|---|
| `pr_commit` insert | On webhook | Source of attribution |
| `session_pr_link` (one PR) | On webhook | Manager wants merge → linked instantly |
| `cost_per_pr` (one PR) | On webhook | Same |
| `daily_user_stats` | 30-min sweep + on ingest | Devs care about today |
| `daily_org_stats` | 30 min | Main consumer |
| Full reconciliation | 02:00 UTC | Self-heals missed webhooks |

---

## 6. API additions

```
POST /api/github-webhook/[orgId]
  HMAC X-Hub-Signature-256; handles pull_request, pull_request_review, push,
  installation, installation_repositories. On merged → enqueue lineage.

POST /api/internal/lineage/run         { prId }     [INTERNAL_API_SECRET]
POST /api/internal/lineage/sweep                    [INTERNAL_API_SECRET]
  Finds pr WHERE state='merged' AND (link_computed_at IS NULL OR <mergedAt)
  Cap N=500/invocation; cron 30 min.

POST /api/lineage/relink/:prId
  User session; manager-or-author. Force recompute. Rate-limit 1/min/PR.

GET /api/insights/cost-per-pr?orgSlug=&window=
GET /api/insights/intent-outcomes?orgSlug=&window=
GET /api/insights/cohort/:metric?orgSlug=&windowKey=
  k-anonymity gate: cohort <5 → 422 { error:"cohort_too_small", k_required:5 }.
```

---

## 7. Privacy preservation

### 7.1 Decryption invariants
1. **No aggregation path ever decrypts prompts/responses.** Lineage worker reads only `session_event`, `pr`, `pr_commit`, `membership`, `org`. `prompt_event.{wordCount,tsPrompt,externalSessionId}` are metadata (non-encrypted) — fine to read.
2. Per-user DEK only unwrapped when `session.user.id` matches row's `userId`. Manager routes never carry that authority. (Already enforced; we preserve.)
3. Cohort views use only numeric fields. Word counts and intent classes are integers/enums — no plaintext.

### 7.2 k-anonymity

| View | k | Why |
|---|---|---|
| Manager dashboard (per-user rows) | n/a | Explicit membership relationship |
| Cohort comparison within org | **k ≥ 5** | Standard re-identification floor |
| Cohort across orgs | **k ≥ 25** | No org-level trust |
| AI-source per PR | n/a | PR identity is public within org |
| AI-source rolled to user-day in cohort | k ≥ 5 | Don't expose another dev's source mix |

`GET /api/insights/cohort/:metric` checks `COUNT(DISTINCT userId)` before returning data.

### 7.3 Code-output attribution access

| Viewer | Can see |
|---|---|
| Dev (self) | Own sessions, own PR links (all confidences), per-PR AI source |
| Dev (other dev in org) | Only org-aggregate cohort buckets |
| Manager | Per-user PR list, sessions, AI mix, cost — never prompt/response text |
| Anyone | Public `/card` only |

---

## 8. Open questions for the Challenger

1. **GitHub App webhook secret storage** — should it be env (`GITHUB_APP_WEBHOOK_SECRET`) or per-org in `org_credentials`?
2. **`cwd_match` gate is brittle for monorepos/worktrees.** Devs using `git worktree` may have a cwd that doesn't resolve. Gate vs soft-signal (weight 0.3)?
3. **Backfill on App install.** Backfill 90d of merged PRs? ~1000 API calls per 100-repo org. Acceptable?
4. **Squash-merges collapse N commits → 1.** Store pre-squash commits (better attribution) or post-squash (matches `main`)? Proposed: pre-squash.
5. **`branchMatch` via `prCommit.message` is circular.** Should the collector capture `git rev-parse --abbrev-ref HEAD` per session?
6. **Cursor has no co-authored-by trailer by default.** Will be classified as `human` often. Acceptable?
7. **`estCostUsdCenti` stored values drift when pricing changes.** Store tokens only, compute at read time?
8. **Sessions arriving AFTER PR merge** (collector backfill days late). Nightly sweep catches via `link_computed_at < max(session.createdAt)` — but wide query. Want a `pending_recompute` queue?

---

## LOCKED summary

- GitHub App webhook → `pr` persistence (kills live-fetch).
- `pr_commit` table, populated only on merge.
- `pr_file_blame` deferred to v2 behind flag.
- `session_pr_link` enriched with `fileJaccard`, `timeOverlap`, `branchMatch`, `confidenceScore`, `confidenceReason`. `cwd_match` is a deterministic gate.
- Persisted rollups (`daily_user_stats`, `daily_org_stats`, `cost_per_pr`).
- Lineage worker = Next.js internal routes invoked by webhooks + Railway cron.
- v1 attribution is heuristic-only commit-level; "% of PR from Claude" is **commits %**, not lines %.
- Zero new decryption paths; cohort views k≥5 (k≥25 cross-org).
