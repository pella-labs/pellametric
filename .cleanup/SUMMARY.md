# Cleanup Summary

Branch: `chore/opensource-cleanup`. This is the Verifier's final report on
the crew's pass over `pellametric` to prepare it for open-source release.

## What changed (by phase)

### Audit + Challenge

- Auditor (`REVIEW.md`) enumerated 6 Pruner, 6 Refactorer, and 5 Docs tasks
  around secrets, dead code, duplication, and missing OSS scaffolding.
- Challenger (`CHALLENGE.md`) filed 8 must-fix objections, notably:
  - P-002's "remove unused deps" (`three`, `motion`, `dotenv`) would have
    broken the build — all three are actively imported. Deleted from plan.
  - The "12 repeated auth routes" was actually 7; the other 5 are
    intentionally unauthenticated (ingest, public card reads, Better-Auth
    catch-all). Refactorer warned off them.
  - R-001's `{ error } | { userId }` shape was an anti-pattern; replaced
    with a `withAuth` HOF.
  - R-005 (`logger` no-op wrapper) deleted as a speculative abstraction.
  - New Dockerfile finding (A-2): `BETTER_AUTH_SECRET=build_placeholder_secret`
    was baked via `ENV`, runtime-visible. Scheduled for D-005.
- Team lead decisions (`DECISIONS.md`) resolved SecurityLead vs
  ReleaseLead: PROCEED on credential rotation as a manual P0; HOLD on
  history scrub and `collector.mjs` un-tracking.

### Pruner (3 commits)

- `3f8774a` deleted stale internal planning docs (`plan.md`,
  `CURSOR-ADAPTER-PLAN.md`) — internal pnpm→bun migration notes and a
  merged feature-branch plan, not OSS docs.
- `9f84459` deleted `scripts/migrate-cards.mjs` — a one-shot migration
  with plaintext production Railway Postgres credentials and a
  hardcoded `/Users/san/…` path. No references in scripts, Dockerfile,
  or source. Credentials remain in git history; see P0 items below.
- `0e89582` removed 3 stray `console.error` calls from
  `apps/web/app/api/card/{token,star-repo,token-by-star}/route.ts`.

### Refactorer (4 commits)

- `2be342b` introduced `apps/web/lib/api/with-auth.ts` and
  `apps/web/lib/api/error.ts`; unified auth + error shapes across 12
  API routes (7 authenticated via `withAuth`, 5 public routes adopt
  `apiError` only). `ingest` kept its `{ error, issues }` zod shape
  intentionally.
- `fb5462f` extracted `apps/web/lib/github-headers.ts` — shared
  `Authorization` / `Accept` / `User-Agent` builder for GitHub calls.
  Scoped-down from the original R-002 `fetchGithub()` wrapper.
- `ef4fc95` decomposed `CardPage.tsx` (2000+ lines) into `icons.tsx`
  + a single slide dispatcher (`slides.tsx`). Did NOT create 8
  near-duplicate slide component files (Challenger S-1 avoided).
- `971f6dd` renamed `apps/web/lib/card-backend.ts` → `card-tokens.ts`
  and updated imports. `card-token-mint.ts` left separate (different
  concern).

### Docs (4 commits)

- `c8bf5c9` completed `.env.example` with all 14 variables the apps
  read (`DATABASE_URL`, `BETTER_AUTH_*`, `GITHUB_*`, `PROMPT_MASTER_KEY`,
  `NEXT_PUBLIC_*`, `PELLA_*` including `PELLA_BIN`), each annotated
  required/optional with generation commands. Notes that
  `drizzle.config.ts` reads `.env` (not `.env.local`).
- `cd4ae1e` rewrote `README.md` for OSS release: Railway quick-start,
  local-dev flow, architecture, collector install snippet, env-var
  table matching `.env.example`, OAuth scopes, and Contributing
  section.
- `70581d0` added `LICENSE` (MIT, `Copyright (c) 2026 Pella Labs`)
  and `"license": "MIT"` to root + all three workspace `package.json`
  files.
- `696d6f0` switched Dockerfile placeholders from `ENV` to `ARG` and
  added a runtime fail-fast guard at the top of
  `apps/web/lib/auth.ts` that throws if `BETTER_AUTH_SECRET` is
  missing or equals `"build_placeholder_secret"`, gated on
  `NEXT_PHASE !== "phase-production-build"` so `next build` still
  succeeds.

### Verifier (2 fix commits + this summary)

- `b06f853` broadened `.gitignore` from `.env` + `.env.local` +
  `.env.*.local` to `.env` + `.env.*` (with `!.env.example`). Now
  catches `.env.production`, `.env.staging`, etc.
- `a3da1e5` removed the broken `"lint": "next lint"` script from
  `apps/web/package.json` — `next lint` was removed in Next 16 and
  the script errored on invocation. No ESLint config was wired up,
  so nothing to replace it with; `typecheck` is the actual quality
  gate. eslint devDeps left in place for future opt-in.

## Verification results

Commands were run from the repo root on `chore/opensource-cleanup`.

| Gate                              | Result                                           |
| --------------------------------- | ------------------------------------------------ |
| `bun install`                     | pass (bun.lock drifts for untracked remotion; not committed) |
| `bun run typecheck`               | pass (all 4 workspaces exit 0)                   |
| `bun run build`                   | pass (exit 0; auth fail-fast correctly gated on build phase) |
| `bun run test`                    | pass (38 collector + 27 web tests, 65 total)     |
| lint                              | n/a — no lint configured after removing broken `next lint` |
| gitleaks                          | n/a — not installed; grep fallback used          |
| secret scan (working tree)        | 0 real hits (7 grep lines, all placeholders in docs/examples) |
| secret scan (git history)         | 0 new real hits beyond the already-known `d823576` |
| `.env.example` tracked            | yes                                              |
| `.gitignore` blocks `.env*` broadly | yes (after fix commit `b06f853`)                |
| no `.env*` tracked                | yes (only `.env.example` tracked)                |
| README walkthrough                | pass — `bun install`, `cp .env.example .env`, `bun run db:push`, `bun run dev` all defined; env table matches `.env.example` row-for-row; logo path `apps/web/public/primary-logo.svg` exists |
| `BETTER_AUTH_SECRET` fail-fast    | verified at top of `apps/web/lib/auth.ts`, correctly gated on `NEXT_PHASE !== "phase-production-build"` |

Secret-scan grep working-tree hits (for reference, all benign):

- `.cleanup/CHALLENGE.md`, `.cleanup/PLAN.md` — internal meta-references
- `.env.example` — `postgresql://user:pass@host:5432/pellametric` placeholder
- `.github/workflows/ci.yml` — `postgresql://user:pass@localhost:5432/db` CI placeholder
- `Dockerfile` — `ARG DATABASE_URL=postgresql://user:pass@localhost:5432/db` build-only placeholder

## Open P0 items (user must do BEFORE making the repo public)

1. **Rotate Railway Postgres credentials** for `switchyard.proxy.rlwy.net`
   and `shinkansen.proxy.rlwy.net`. Both source and destination DB
   passwords were committed in `d823576` ("feat(card): implement dynamic
   card loading and API endpoint") inside `scripts/migrate-cards.mjs`.
   That file has been deleted from the working tree in commit `9f84459`,
   but the credentials remain in git history. **DO NOT PUBLISH THE REPO
   UNTIL THESE ARE ROTATED.** Treat them as compromised.
2. **(Optional) Scrub history after rotation.** If you want the commit
   body removed before publishing, run something like
   `git filter-repo --path scripts/migrate-cards.mjs --invert-paths`
   followed by a coordinated force-push. Deferred per DECISIONS §2 —
   all collaborators must re-clone, in-flight PRs must be rebased.
   Rotation alone is sufficient for safety; history scrub is cosmetic
   once the creds are dead.
3. **Re-verify no in-flight PRs or branches** still reference removed
   files (`scripts/migrate-cards.mjs`, `plan.md`, `CURSOR-ADAPTER-PLAN.md`)
   before the repo goes public. Rebases may be required.

## Other follow-ups (not release blockers)

- Add a real screenshot to `README.md` (the current HTML comment
  `<!-- TODO: add screenshot showing the org dashboard -->` is a
  deliberate placeholder).
- Consider moving `apps/web/public/collector.mjs` to build-time
  generation (gitignore + regenerate during the Docker build step).
  See DECISIONS §4: HOLD per SecurityLead because the endpoint
  `/setup/collector` serves it at runtime and un-tracking without
  re-wiring the deploy pipeline is a deploy risk. Revisit in a
  separate PR.
- Untracked `apps/remotion/` workspace is present in the working
  tree but not committed. Pre-existing WIP; out of this crew's
  scope — review separately. (It did cause `bun.lock` to drift
  during `bun install`; we reverted the drift rather than commit it.)
- No ESLint config is wired up in the repo. If desired, add a flat
  `eslint.config.js` and a standalone `"lint": "eslint ."` script.
  The eslint devDeps are already installed.

## What was explicitly NOT touched

- `.github/workflows/` — untouched per hard rules.
- `packaging/`, `railway.toml`, `.railwayignore` — not in scope.
- `apps/remotion/` — untracked and out of scope.
- Git history — no rewrites (HOLD per DECISIONS §2).
- `apps/web/public/collector.mjs` — HOLD per DECISIONS §4.

## Commits produced by this crew (chronological)

```
d473988 chore: audit report and cleanup plan
e305d18 chore: revise cleanup plan after challenge
5d744e6 chore: council decisions on release blockers
3f8774a chore: delete stale internal planning docs
9f84459 chore: remove one-shot migration script with leaked credentials
0e89582 chore: remove stray console.error from api routes
2be342b refactor: unify api auth + error helpers
fb5462f refactor: extract github request headers helper
ef4fc95 refactor: decompose CardPage into icons and slide dispatcher
971f6dd refactor: rename card-backend to card-tokens
c8bf5c9 docs: complete .env.example with all referenced variables
cd4ae1e docs: rewrite README for open-source release
70581d0 docs: add MIT license
696d6f0 fix: make BETTER_AUTH_SECRET runtime-required with fail-fast guard
b06f853 fix: broaden .env* ignore pattern to cover all env variants
a3da1e5 fix: remove broken 'next lint' script (removed in Next 16)
```

Plus this `chore: verification pass and cleanup summary` commit.
