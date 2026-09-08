# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Bun workspaces monorepo (`bun@1.3.9`, `engines.bun >=1.3.4`). Three workspaces:

- `apps/web` — Next.js 16 (Webpack), React 19, better-auth (GitHub OAuth), Drizzle + `postgres-js`, Tailwind. Path alias `@/*` → `apps/web/*`.
- `apps/collector` — TypeScript CLI bundled two ways from the same source:
  - `src/bin.ts` → cross-compiled native binary via `bun build --compile` (5 targets, see `release.yml`). Distributed as `pella` and run as a per-user OS service.
  - `src/index.ts` → `apps/web/public/collector.mjs` via `build.ts` for the `curl … | node -` legacy one-shot fallback served at `/setup/collector`.
- `packages/shared` — wire types only (`IngestSession`, `IngestPrompt`, `IngestResponse`, `IngestPayload`). Imported as `@pella/shared`.

Other top-level dirs: `packaging/{launchd,systemd,windows}` hold service-unit templates rendered at install time by `apps/collector/src/daemon.ts`. `Dockerfile` + `railway.toml` deploy the web app to Railway.

## Commands

Run from repo root unless noted. All scripts are Bun-driven.

```bash
bun install                 # install all workspaces
bun run dev                 # next dev (apps/web) on $PORT or 3000
bun run build               # builds collector.mjs first, then apps/web (order matters — web's public/ consumes it)
bun run start               # next start

bun run db:push             # drizzle-kit push  — direct schema sync to $DATABASE_URL (no file migrations are committed)
bun run db:studio           # drizzle-kit studio

bun run typecheck           # tsc --noEmit across all workspaces
bun run test                # vitest run across all workspaces

# Single test file (run inside the workspace):
cd apps/web       && bunx vitest run lib/__tests__/aggregate.test.ts
cd apps/collector && bunx vitest run src/__tests__/cursor.test.ts

# Collector binary (cross-compiles from any host; codesigns darwin locally):
cd apps/collector && bun run build:darwin-arm64    # also: darwin-x64, linux-x64, linux-arm64, windows-x64

# Collector dev loop (no daemon — just runs `pella serve` in foreground):
bun --filter='./apps/collector' run dev
```

CI (`.github/workflows/ci.yml`) runs `typecheck` + `test` in a matrix and then `bun --filter='./apps/web' run build`. The web build needs all `BETTER_AUTH_*` / `GITHUB_*` / `DATABASE_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL` envs set (CI uses placeholders) because Next evaluates pages that read `process.env` at build time.

Releases: pushing a `v*` tag fires `release.yml`, which cross-compiles all 5 binaries on Ubuntu, ad-hoc-signs the darwin ones with `rcodesign` (Apple Silicon kernel SIGSTOPs unsigned arm64 binaries; `bun --compile` invalidates the upstream Bun stub signature), generates `SHA256SUMS`, and attaches everything to the GitHub Release. `install.sh` strips `com.apple.quarantine` on download since these aren't notarized.

## Architecture

The product is a per-dev productivity dashboard for Claude Code + Codex (+ Cursor) sessions, scoped by GitHub org.

### End-to-end flow

1. **Manager signs in** via better-auth GitHub OAuth (`apps/web/lib/auth.ts`), picks a GitHub org → row created in `org`, manager gets a `membership` with `role="manager"`.
2. **Manager invites devs** by GitHub login → `invitation` row. Dev signs in, accepts → `membership` with `role="dev"`. See `apps/web/lib/invite-accept.ts`.
3. **Dev mints an API token** at `/setup/collector` → `api_token` row stores only `sha256(token)`; the plaintext `pm_…` is shown once.
4. **Dev pastes a one-liner** that pipes `install.sh` (or `install.ps1`) to a shell. The installer downloads the right `pella-<target>` binary from a GitHub Release, verifies SHA-256 against `SHA256SUMS`, writes `~/.pella/config.env` (mode 0600) with `PELLA_TOKEN` + `PELLA_URL`, and registers the OS service.
5. **Service runs `pella serve`** under launchd (macOS) / `systemd --user` (Linux) / Scheduled Task (Windows). It walks `~/.claude/projects/**/*.jsonl` + `~/.codex/sessions/**/rollout-*.jsonl` (+ Cursor SQLite when `PELLA_SKIP_CURSOR` is unset), folds new bytes into per-session accumulator state every `PELLA_POLL_INTERVAL_MS` (default 10s), finalizes "dirty" sessions, and POSTs them to `/api/ingest`.
6. **Dashboard** (`apps/web/app/dashboard`, `app/org/[slug]`) reads `session_event` rows and runs `lib/aggregate.ts` to produce chart data per source.

### Collector internals (`apps/collector/src/`)

- **No persisted cursor state.** On daemon restart we rebuild accumulator state from offset 0 of every file. The server's `onConflictDoUpdate` on `(userId, source, externalSessionId)` makes re-uploads idempotent — cold-start is correct but not minimal, and that's the deliberate trade.
- **Parsers** (`parsers/{claude,codex,cursor,intent}.ts`) fold JSONL/SQLite lines into a `SessionMap` keyed by external session id. Intent classification via regex + a small LLM-free heuristic (`intent.ts` — `TEACHER_RE`, `FRUSTRATION_RE`).
- **Repo resolution** (`parsers/repo.ts`) walks up from a session's `cwd` looking for `.git/config` and parses `origin` → `owner/name`. Sessions whose cwd doesn't resolve to a real GitHub repo are dropped client-side; the server would reject them anyway with "no membership for this org" since the org slug is matched against `owner.lowercase()`.
- **Daemon lifecycle** (`daemon.ts`) is the only platform-aware file. macOS: `launchctl bootstrap` + `kickstart -k` (NOT `-k -s` — `-s` means start-suspended-for-debugger and SIGSTOPs the process). Linux: `systemctl --user enable --now`, with a `loginctl` Linger check. Windows: `schtasks /Create /XML` (UTF-16 LE, BOM required).
- **Two entry points share the upload code path** (`upload.ts`, batch size 200): `src/bin.ts` (compiled binary CLI dispatching to `commands/{login,start,stop,status,logs,serve,runOnce}.ts`) and `src/index.ts` (legacy `node -` one-shot, bundled with `__DEFAULT_URL__` injected at `bun build` time so the served `collector.mjs` knows where to POST).

### Web app internals (`apps/web/`)

- **App router structure**: `(marketing)` route group + `marketing.css` for the public site, `dashboard` + `org/[slug]` for the authed product, `setup/{collector,org}` for onboarding, `deck` + `intro` for the pitch deck, `card` for shareable repo cards. API routes live under `app/api/`.
- **better-auth** is the source of truth for `user`/`session`/`account`/`verification` tables (`lib/db/schema.ts`). Drizzle owns everything else (`org`, `membership`, `invitation`, `api_token`, `session_event`, `pr`, `session_pr_link`, `prompt_event`, `response_event`, `user_prompt_key`, `upload_batch`). The `user` row is extended with `githubLogin` + `githubId` via better-auth's `additionalFields` so we can match invites by GitHub login without a separate join table.
- **Ingest auth model** (`app/api/ingest/route.ts`): bearer token → `sha256` → lookup in `api_token` → `userId`. Each session's `repo` is split into `owner/name`; `owner.lowercase()` must match the slug of an org the user is a member of. Rejected sessions come back in the response body, not as an error — we don't fail the batch.
- **Prompt encryption** (`lib/crypto/prompts.ts`): per-user 32-byte DEK is generated lazily, wrapped with `PROMPT_MASTER_KEY` (env, base64-encoded 32B) using AES-256-GCM, stored as `iv.tag.ciphertext` in `user_prompt_key`. Each prompt/response is then encrypted with that DEK. Managers see only aggregates — only the owning user's API path can decrypt their own ciphertext. The dedup index `prompt_uniq` on `(userId, source, externalSessionId, tsPrompt)` makes re-ingest a no-op.
- **Drizzle workflow**: there are no migration files in the repo. Schema changes go straight to the DB via `bun run db:push`. If you need versioned migrations, run `db:generate` to produce them under `apps/web/drizzle/` (currently uncommitted; `outputFileTracingRoot` is set to the repo root so Next can pick them up if added).
- **Aggregation invariants** (`lib/aggregate.ts`): each session is capped at `SESSION_CAP = 2h` for "active hours" so a tab left open overnight doesn't count as 12h of work, and overlapping intervals are merged per day so parallel sessions don't double-count. Cache hit % is `cacheRead / (cacheRead + tokensIn)` — `cacheWrite` is a separate cost dimension, not an input read.

### Required environment

```
# apps/web (server-side)
DATABASE_URL=postgresql://…
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=http://localhost:3000          # or production origin
GITHUB_CLIENT_ID=…                             # OAuth app callback: <BETTER_AUTH_URL>/api/auth/callback/github
GITHUB_CLIENT_SECRET=…
PROMPT_MASTER_KEY=<base64 of 32 random bytes>  # required to ingest prompts/responses

# apps/web (client bundle — inlined at next build time)
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# apps/collector (read from ~/.pella/config.env, overridable via process.env)
PELLA_TOKEN, PELLA_URL, PELLA_POLL_INTERVAL_MS, PELLA_SINCE, PELLA_SKIP_CURSOR
```

GitHub OAuth scopes: `write:org`, `repo`, `read:user`, `user:email`. `write:org` is needed by `app/api/invite/route.ts` to invite users to the GitHub org via `PUT /orgs/{org}/memberships/{login}`; it implies `read:org` so older code paths still work.

## Conventions worth knowing

- Commit style is conventional commits (`feat(web): …`, `fix(collector): …`, `chore: …`). PR titles are validated by `.github/workflows/pr-title.yml`.
- Bun is the package manager and runtime — don't introduce `npm`/`pnpm`/`yarn` lockfiles, and don't add Node-specific shebangs to the compiled-binary code path (`bin.ts`); that one runs under the embedded Bun runtime.
- The collector intentionally has no persisted cursor; do not add one without also adding a story for migrating users who restart mid-session. Server-side idempotency is what makes restarts safe.

## Insights revamp (Phase F0–F6)

A second-generation UI ships behind `PELLAMETRIC_INSIGHTS_REVAMP_UI=1`. When
the flag is off, the legacy `/org/[provider]/[slug]/page.tsx` renders exactly
as before; when on, the same route returns the new design-council overview.

### New routes
- `/org/[p]/[slug]` — KPI strip + Spend×Throughput scatter + attribution mix + top PRs + top devs (server-rendered)
- `/org/[p]/[slug]/insights` — PostHog-style builder (8 modes, URL state via `?q=<base64>`)
- `/org/[p]/[slug]/devs` — leaderboard; `/devs/[login]` redirects to legacy `/dev/[login]`
- `/org/[p]/[slug]/waste` — stuck + abandoned sessions
- `/org/[p]/[slug]/intent` — calendar heatmap + intent frequency table
- `/org/[p]/[slug]/benchmark` — within-org P50/P10 vs your org (k≥5 floor)
- `/me/[p]/[slug]` — Sankey hero session→PR + KPI strip + heatmap
- `/me/[p]/[slug]/sessions` — paginated personal session list (filterable)
- `/me/[p]/[slug]/prs` — caller's authored PRs
- `/me/[p]/[slug]/sessions/[id]` — H1 fix: prompts decrypt only on click, via `/api/me/sessions/[id]/prompts` (rate-limited, owner-only, `Cache-Control: no-store`)
- `/dev/components` (DEV_AUTH_BYPASS=1 or non-prod) — chart + data primitive showcase

### Key invariants
- `lib/pricing.ts` is client-safe (no DB imports). Server-only DB pricing in `lib/pricing-db.ts`.
- `lib/insights/query-types.ts` is client-safe (types + URL codec). Server-only compiler in `lib/insights/query.ts`.
- `lib/crypto/prompts.ts` and `lib/aggregate.ts` must remain byte-identical to main (CI gates).
- No `/api/me/prompt-key` route — ever. The P18 boundary keeps the DEK server-side.
- `apps/web/app/api/dev/` is gitignored (mint-session is local-only).
- Tailwind v4 canonical only: `bg-(--token)`, `bg-linear-to-r`. Never `bg-[var(...)]` or `bg-gradient-to-r`.

### New tables (applied to Railway)
- `pr.previous_filenames jsonb` (P10 rename-aware Jaccard)
- `saved_insight (id, orgId, userId, scope, name, queryJson)` — org-scope visible to all org managers; user-scope visible to owner only
- `saved_dashboard` + `dashboard_pinned_insight` (skeleton — UI lives in future iterations)

### Demo data
`bun --filter='./apps/web' run seed:demo` seeds a believable org. Script
refuses to run unless `DATABASE_URL` is local or `DEMO=1` is set.

### Cohort guard
External scheduler hits `POST /api/internal/cohort-guard` hourly (bearer
`INTERNAL_API_SECRET`). Scans `cohort_query_log` for the same manager making
multiple distinct-cohort queries that overlap by ≥ k-1 (= 4) members; posts
to `LINEAGE_ALERT_WEBHOOK`.

### Keyboard chords (manager layout)
`g o` (Overview) · `g i` (Insights) · `g p` (PRs) · `g d` (Devs) · `g w` (Waste) · `g n` (Intent) · `g b` (Benchmark) · `?` (help) · `Esc` (close).

