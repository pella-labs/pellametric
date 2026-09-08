# Fixtures catalog

Static test fixtures consumed by Phase 2 onward. Every fixture below has a fixed shape and a fixed purpose. Build agents author fixtures during Phase 2 task T2.0 (and sub-tasks T2.0a..T2.0f); test agents reference them by relative path; no test is allowed to fabricate its own fixture inline once the catalog is populated.

Layout:

```
dev-docs/fixtures/
  webhooks/   # GitHub App webhook event payloads
  commits/    # Single-commit attribution fixtures
  sessions/   # Collector IngestSession-shaped fixtures
  sql/        # Seed scripts producing repeatable DB states
```

---

## webhooks/

GitHub App webhook payloads. Each file is a valid JSON body as it would arrive on `POST /api/github-webhook`. Shape follows the official GitHub Webhook event schema for that `X-GitHub-Event` header. All payloads use `installation.id = 11111` and `organization.login = 'pella-labs'` unless stated.

| File | Purpose | Shape | Grounds |
|---|---|---|---|
| `pr-opened-with-claude-trailer.json` | PR opened event used to validate first-touch hydration of `pr_commit`. | `pull_request` event, `action='opened'`, `pull_request.number=101`, three entries in the referenced `/pulls/101/commits` response (provided inline under `_commits`) each with `commit.message` ending `Co-Authored-By: Claude <noreply@anthropic.com>`. | P1 hydration test (Phase 2). |
| `pr-synchronize-normal.json` | Normal force-push-free push to a PR head. | `pull_request` event, `action='synchronize'`, `before` and `after` SHAs where `before` is the parent of `after` (linear history). | Phase 2 synchronize handler test (non-force-push branch of P3). |
| `pr-synchronize-force-push.json` | Rebase-style push. | `pull_request` event, `action='synchronize'`, `before` SHA is NOT an ancestor of `after` (disjoint histories simulated by distinct random SHAs and a `_ancestry` hint block consumed by the mock). | P3 force-push wipe + rehydrate test. |
| `pr-merged-squash.json` | Squash-merged PR. | `pull_request` event, `action='closed'`, `pull_request.merged=true`, `merge_commit_sha` set, `_commits` retains the three pre-squash commits as they would be returned by `/pulls/{n}/commits` after merge. | B1 / P1 — pre-squash commit retention. |
| `pr-merged-rebase.json` | Rebase-merged PR (fast-forward). | `closed+merged=true`, `merge_commit_sha` equals last commit SHA; no synthetic merge commit. | Phase 2 attribution path for rebase merges. |
| `pr-merged-revert.json` | Revert PR. | `closed+merged=true`, title starts with `Revert "feat: add foo"`, body contains `This reverts commit <sha>`. | P5 revert detection. |
| `pr-files-with-rename.json` | `/pulls/{n}/files` response (NOT a webhook event — a REST response fixture used by hydration code). | Array of file entries; one entry has `status='renamed'` and `previous_filename` set. | P10 rename-aware Jaccard. |
| `installation-created.json` | GitHub App installed on the org. | `installation` event, `action='created'`, `repositories` array with 5 entries. | Phase 6 backfill trigger. |
| `pull-request-review-submitted.json` | Approval review. | `pull_request_review` event, `action='submitted'`, `review.state='approved'`. | Phase 2 review-event handler smoke test. |

Cross-cutting payload conventions:

- All SHAs are 40-char hex; reuse `aaaaaaaa…01`, `…02` pattern so test snapshots stay stable.
- `_commits` and `_files` underscore-prefixed keys are non-spec helpers attached to webhook fixtures so the test harness can resolve "would-be" REST responses without recording HTTP. Production code never sees these — the test mock strips them before injection.
- `sender.login = 'manager-1'` unless the test cares.

---

## commits/

Single-commit attribution fixtures. Each file represents one row that would land in `pr_commit` with `kind='commit'`. The attribution heuristic (Phase 2, P6) consumes the `message`, `author`, and `committer` fields and produces `aiSources text[]` + `confidence` + `confidenceReason`.

Each fixture follows the GitHub REST `Commit` shape pruned to what the heuristic actually reads:

```
{
  "sha": "...",
  "commit": { "message": "...", "author": { "name": "...", "email": "..." } },
  "author": { "login": "..." } | null,
  "parents": [{ "sha": "..." }]
}
```

| File | Purpose | Expected output | Grounds |
|---|---|---|---|
| `commit-claude-trailer.json` | Standard `Co-Authored-By: Claude` git trailer in message. | `aiSources=['claude']`, confidence ≥60, `confidenceReason='trailer'`. | Phase 2 heuristic test C1. |
| `commit-claude-footer.json` | Message ends `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. | `aiSources=['claude']`, confidence ≥90, `confidenceReason='footer'`. | Phase 2 heuristic test C2. |
| `commit-anthropic-email-no-trailer.json` | Author email `noreply@anthropic.com`, no trailer/footer in message. | `aiSources=['unknown']`, confidence 30, `confidenceReason='anthropic_email_only'`. | P8 — Anthropic email alone is NOT Claude. |
| `commit-cursor-trailer.json` | `Co-Authored-By: Cursor <cursor@cursor.sh>` trailer. | `aiSources=['cursor']`, confidence ≥60. | Phase 2 heuristic test C3. |
| `commit-cursor-email.json` | Author email `cursor@cursor.sh`, no trailer. | `aiSources=['cursor']`, confidence ≥70. | Phase 2 heuristic, P31 opt-in pairing baseline. |
| `commit-dependabot-bot.json` | Author login `dependabot[bot]`. | `aiSources=['bot']`, confidence 100 (terminal — heuristic stops here). | P4 bot terminal rule. |
| `commit-renovate-bot.json` | Author login `renovate[bot]`. | `aiSources=['bot']`, confidence 100. | P4. |
| `commit-github-actions.json` | Author login `github-actions[bot]`. | `aiSources=['bot']`, confidence 100. | P4. |
| `commit-multi-source.json` | Message has both `Co-Authored-By: Claude` and `Co-Authored-By: Cursor` trailers. | `aiSources=['claude','cursor']` (P6 array, both counted). | P6 multi-source array test. |
| `commit-merge-commit.json` | Author login `web-flow`, message `Merge pull request #42 from feat/x`, `parents` length 2. | `kind='merge_commit'` — excluded from attribution entirely. | Phase 2 merge-commit exclusion test. |
| `commit-human.json` | Plain message (`fix: handle null user`), no trailers, no footer, no bot login, regular email. | `aiSources=['human']`, confidence 80. | Phase 2 default-human path. |
| `commit-codex-trailer.json` | `Co-Authored-By: Codex` trailer. | `aiSources=['codex']`. | P32 — session-join inference baseline (plus trailer fallback). |
| `commit-with-secret-leak.json` | Message contains `AKIAIOSFODNN7EXAMPLE` (AWS key pattern). | Pre-redaction `message` raw; after redaction pass `messageRedacted=true` and key replaced with `[REDACTED]`. | P20 redaction test. |

---

## sessions/

Collector-shaped `IngestSession` payloads (see `packages/shared`). Each fixture is one session row as it would be POSTed to `/api/ingest`. Tests use them to exercise lineage, prorate, and cwd-resolution paths without spinning up the collector.

```
IngestSession = {
  externalSessionId, source, startedAt, endedAt,
  tokensIn, tokensOut, cacheRead, cacheWrite,
  messages, errors, teacherMoments, frustrationSpikes,
  filesEdited: string[], intent, cwd, cwdResolvedRepo,
  branch?, model
}
```

| File | Purpose | Notable fields | Grounds |
|---|---|---|---|
| `session-claude-build.json` | Happy-path Claude build session. | `source='claude'`, `intent='build'`, `filesEdited.length=4`, `branch='feat/foo'`, `cwdResolvedRepo='pella-labs/repo'`. | Phase 2 lineage matcher (high-confidence link). |
| `session-codex-debug.json` | Codex debugging session. | `source='codex'`, `intent='debug'`, `filesEdited.length=2`. | P32 Codex inference test. |
| `session-cursor-edit.json` | Cursor session with many edits. | `source='cursor'`, `filesEdited.length=30`. | P31 Cursor opt-in test. |
| `session-cwd-monorepo.json` | Session cwd inside a monorepo subdir. | `cwd='/repos/mono/packages/web'`, `cwdResolvedRepo='org/mono'` (outermost). | P13 monorepo resolution test. |
| `session-cwd-worktree.json` | Session cwd in a `git worktree add` directory; `.git` is a file pointing via `gitdir:` to the main worktree. | `cwd='/tmp/wt-feat-x'`, `cwdResolvedRepo='pella-labs/repo'` resolved via gitdir indirection. | P13 worktree resolution test. |
| `session-cwd-unknown.json` | cwd outside any git repo. | `cwd='/tmp/scratch'`, `cwdResolvedRepo=null`. | P13 soft-signal — score gets `×0.6` multiplier. |
| `session-cross-utc-boundary.json` | Session straddles midnight UTC. | `startedAt='2026-04-10T23:50:00Z'`, `endedAt='2026-04-11T00:20:00Z'`. | P12 proration test (Phase 3 rollups). |

---

## sql/

DB seed scripts. Each script is idempotent (`TRUNCATE … CASCADE` at the top, then `INSERT`s) and produces a fully populated state matching Drizzle's `apps/web/lib/db/schema.ts`. Tests pipe these into a per-test Postgres schema via `pg_tmp` or the `vitest` setup file.

| File | Purpose | Shape | Grounds |
|---|---|---|---|
| `db-seed-minimal.sql` | Baseline state for most lineage/rollup tests. | 1 org (`pella-labs`, `provider='github'`), 2 users (one manager + one dev), 1 `apiToken` row each, 2 `pr` rows (one `state='merged'`, one `state='open'`), 10 `session_event` rows attached to the merged PR. | Phase 2/3 default fixture. |
| `db-seed-stacked-prs.sql` | Stacked PR chain. | 3 PRs where PR A's `baseBranch` = PR B's `headBranch`, and PR B's `baseBranch` = PR C's `headBranch`. `pr.stackedOn` populated on the children. | P11 stacked-PR detection + cost adjustment test. |
| `db-seed-cohort-suppression.sql` | Org under the cohort `k=5` threshold. | 1 org, 4 members. | Phase 7 cohort suppression test. |
| `db-seed-cohort-intersection.sql` | Org with two near-identical cohorts. | 1 org, 6 members. Two manager-defined cohorts of size 5 that differ by exactly 1 member. `cohort_query_log` pre-populated with one of them queried within the last 30 days. | P19 intersection guard test. |
| `db-seed-large-org.sql` | Sweep / load test fixture. | 25 users, 100 merged PRs, 500 `session_event` rows distributed across users + PRs. | Phase 2 `lineage/sweep` load test; Phase 3 backfill perf test (`<60s`). |
| `db-seed-model-pricing.sql` | Populated `model_pricing` table. | Rows for `claude-3-5-sonnet`, `claude-3-7-sonnet`, `claude-opus-4`, `gpt-4o`, `gpt-4o-mini`, `o1`, `o3`, with `effectiveFrom` timestamps reflecting actual April 2026 pricing windows. `priceVersion` increments per row. | P7 cost-from-tokens test; `priceFor(model, ts)` historical lookup test. |

---

## How to use these fixtures

1. **Build agents read this README** to know the exact filename, shape, and grounded expectations for every fixture before authoring it. The README is the contract; the JSON/SQL are the implementation.
2. **Fixture files do not exist until Phase 2 task T2.0 runs.** T2.0 is the very first Phase 2 task and blocks every test task. Sub-tasks T2.0a..T2.0f (see below) run in parallel — each produces one fixture group.
3. **Tests reference fixtures by relative path** from the repo root:
   ```ts
   const fx = loadFixture('commits/commit-claude-trailer.json');
   ```
   Never read directly with `fs.readFileSync` — always go through the helper so path resolution is centralized.
4. **Vitest helper** lives at `apps/web/lib/__tests__/_fixtures.ts` and exposes:
   ```ts
   export function loadFixture<T = unknown>(name: string): T;
   export function loadSqlFixture(name: string): string;
   ```
   `loadFixture` resolves relative to `dev-docs/fixtures/`, parses JSON, and caches the result. `loadSqlFixture` returns the raw SQL string for piping into a test DB.
5. **No fixture is ever mutated by a test.** If a test needs a variation, it shallow-clones via `structuredClone` and edits the clone.
6. **Adding a new fixture is a PRD change**, not an inline test change. Add a row to this README first, get the catalog reviewed, then add a corresponding T2.0 sub-task.

---

## Fixture creation tasks for Phase 2

The fixture catalog is produced as a single Phase 2 prep step. Each sub-task below is an atomic, parallel-safe unit of work for one build agent. All sub-tasks read this README as their spec.

| Task ID | Output | Files | Parallel-safe? |
|---|---|---|---|
| T2.0a | Webhook payload fixtures | All files under `dev-docs/fixtures/webhooks/` (9 files) | Yes — no shared state. |
| T2.0b | Commit attribution fixtures | All files under `dev-docs/fixtures/commits/` (13 files) | Yes. |
| T2.0c | Session fixtures | All files under `dev-docs/fixtures/sessions/` (7 files) | Yes. |
| T2.0d | SQL seed fixtures | All files under `dev-docs/fixtures/sql/` (6 files) | Yes — but must produce schema-compatible SQL, so depends on Phase 1 schema being merged. |
| T2.0e | Vitest fixture helper | `apps/web/lib/__tests__/_fixtures.ts` exposing `loadFixture` + `loadSqlFixture`. | Yes. |
| T2.0f | Catalog consistency check | A single Vitest test `apps/web/lib/__tests__/_fixture-catalog.test.ts` that asserts every fixture referenced in this README exists on disk and parses. | Sequential — must run after T2.0a..T2.0d. |

After T2.0a..T2.0f all complete, every downstream Phase 2/3/5/7 test task can assume the catalog is present and intact. Tests that fail because a fixture is missing must be rerouted to a fixture-creation bug, not patched inline.
