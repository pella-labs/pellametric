# Pellametric Codebase Audit — Agent 1 (Auditor)

Comprehensive findings organized by the 6 principles for open-source readiness.

---

## 1. Secrets & Surprises

### Critical: Incomplete `.env.example` — Missing 9 Referenced Variables

**Severity:** CRITICAL
**Location:** `.env.example` (missing entries) vs code references
**Finding:** The `.env.example` file lists only 5 variables but the codebase references at least 13 user-configurable env vars. Developers cannot know what environment variables are required without reading source code.

**Missing entries:**
- `NEXT_PUBLIC_SITE_URL` — `apps/web/app/layout.tsx:12` (defaults to "https://pellametric.com")
- `NEXT_PUBLIC_BETTER_AUTH_URL` — `apps/web/lib/auth-client.ts:5` (required for client-side auth)
- `PROMPT_MASTER_KEY` — `apps/web/lib/crypto/prompts.ts:10` (REQUIRED: 32-byte base64, throws if missing)
- `GITHUB_TOKEN` — `apps/web/lib/github-profile.ts:13`, `github-stars.ts:22` (optional, lifts GitHub API quota)
- `PELLA_TOKEN` — `apps/collector/src/index.ts:17` (collector: API token for ingestion)
- `PELLA_URL` — `apps/collector/src/index.ts:20` (collector: backend URL, optional)
- `PELLA_COLLECTOR_DEFAULT_URL` — `apps/collector/build.ts:13` (build-time default, optional)
- `PELLA_SKIP_CURSOR` — `apps/collector/src/serve.ts:83` (feature flag, optional)
- `PELLA_BIN` — `apps/collector/src/daemon.ts:33` (dev-only override, optional)

OS-provided and not user-configurable (do NOT put in `.env.example`): `APPDATA` (Windows), `XDG_CONFIG_HOME` (Linux).

Additional contributor-surprise: `apps/web/drizzle.config.ts:1` does `import "dotenv/config"`, which reads `.env` NOT `.env.local`. A contributor who copies `.env.example → .env.local` (the common Next.js convention) will find `bun run db:push` silently using defaults. Must be loudly documented in `.env.example` and README.

**Proposed fix:** Update `.env.example` to list all 13 user-configurable vars with required-vs-optional annotations. See PLAN D-001 for the exact file content.

---

### Minor: `.DS_Store` Exists on Disk (Not Tracked)

**Severity:** MINOR
**Location:** `.DS_Store` at repo root, 6148 bytes (working directory only; verified via `git log --all -- .DS_Store` returns no commits).
**Finding:** `.DS_Store` is gitignored and has never been committed, but still exists on macOS. Working-tree hygiene only.

**Proposed fix:** Remove the file locally before release (`rm .DS_Store`); no `.gitignore` change needed. Tracked as PLAN P-003.

---

## 2. DRY Principle

### Major: Duplicated Error Handler Pattern

**Severity:** MAJOR
**Location:** API routes (`apps/web/app/api/**/route.ts`)
**Finding:** Corrected count — **7** route files repeat the same session-fetch-and-validate pattern (not 12; the original draft conflated total route files with authenticated ones):
- `const session = await auth.api.getSession({ headers: await headers() })`
- `if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })`

Enumerated exactly: `tokens/route.ts`, `prompts/route.ts`, `invite/route.ts`, `invite/accept/route.ts`, `orgs/route.ts`, `card/star-repo/route.ts`, `card/token/route.ts`.

The remaining 5 route files intentionally do NOT authenticate and must not be wrapped: `auth/[...all]/route.ts` (Better-Auth catch-all), `card/[id]/route.ts` (public card reads), `card/submit/route.ts` (public submit), `card/token-by-star/route.ts` (public lookup), `ingest/route.ts` (bearer-token ingest from collector).

**Proposed fix:** Higher-order wrapper `withAuth(handler)` + shared `apiError(error, detail?, status)` helper — see PLAN.md R-001 for the concrete spec. Rejected the original early-return `{ error } | { userId }` shape: it shadows the imported `auth` symbol and forces `"error" in auth` narrowing at every call site.

---

### Major: Duplicated GitHub API Fetch Patterns

**Severity:** MAJOR  
**Location:** `apps/web/lib/github-profile.ts:13-16`, `github-stars.ts:8-10`, `apps/web/app/api/card/token/route.ts:29-34`  
**Finding:** Three separate places construct GitHub API fetch headers with `Bearer ${token}` and handle errors differently. Token authorization should be centralized.

**Proposed fix:** Create `fetchGithub(path, token, options?)` utility wrapping common headers + error handling.

---

### Minor: Multiple Card/Token Utilities

**Severity:** MINOR  
**Location:** `apps/web/lib/card-backend.ts`, `card-token-mint.ts`, `card-backend.ts`  
**Finding:** Three utility files handle card tokens and slugs. Logic is split across `hashCardToken`, `mintCardToken`, `toCardSlug`, `isReservedCardSlug`.

**Proposed fix:** Consolidate into single `card-utils.ts` (different from `_card/card-utils.ts` which is UI-only) or rename for clarity.

---

## 3. Dead Code Inventory

### Critical: Two Stale Planning Documents

**Severity:** CRITICAL  
**Location:** `plan.md` (329 lines), `CURSOR-ADAPTER-PLAN.md` (376 lines)  
**Finding:** Both files are detailed implementation/migration notes from internal development and feature branches. They reference internal commit hashes, make execution decisions for past work, and should not be in the public repo.

- `plan.md`: pnpm → bun migration plan (completed, Oct 2024)
- `CURSOR-ADAPTER-PLAN.md`: cursor adapter feature branch notes (merged, refers to PR #118)

**Proposed fix:** Move to `.archive/` or delete entirely. Not OSS documentation.

---

### Major: CardPage.tsx Inline SVGs (2036 lines)

**Severity:** MAJOR  
**Location:** `apps/web/app/(marketing)/_card/CardPage.tsx`  
**Finding:** Monolithic 2036-line component contains 300+ lines of inline SVG icon definitions (`FlameIcon`, `WrenchIcon`, `RocketIcon`, etc.) mixed with business logic for rendering card slides (8 slides, pagination, animations). Not dead code, but should be decomposed.

**Proposed fix:** Extract SVG icons to `icons.tsx`, create per-slide components (`SlideOne.tsx`, `SlideTwo.tsx`, etc.), reduce main to orchestration layer.

---

### Retracted: "Unused Dependencies" (three / motion / dotenv)

**Severity:** RETRACTED
**Location:** `apps/web/package.json`
**Finding:** The original draft claimed `three`, `motion`, and `dotenv` were unused. **All three are imported:**
- `three` — `apps/web/app/(marketing)/_components/Monogram.tsx:4-6` (plus `three/addons/environments/RoomEnvironment.js`, `three/addons/loaders/SVGLoader.js`) and `apps/web/app/(marketing)/_components/HeroGrid.tsx:4`.
- `motion` — `apps/web/app/deck/components/slide-frame.tsx:3` (`import … from "motion/react"`; `motion` is the new name for `framer-motion`).
- `dotenv` — `apps/web/drizzle.config.ts:1` (`import "dotenv/config"`; required by `bun run db:push`, `db:studio`, `db:generate`).

The original grep missed subpath imports (`three/addons/*`, `motion/react`) and side-effect imports (`dotenv/config`). Removing these would break the build.

**Proposed fix:** None — do not remove. If a real bundle-size audit is wanted, run `depcheck` or `knip` against the full workspace; listing candidates from a bare grep is not sufficient.

---

## 4. Naming & Comments

### Major: God-Files in UI Layer

**Severity:** MAJOR  
**Location:** `apps/web/components/org-dashboard.tsx` (440 lines)  
**Finding:** Large component mixes chart initialization, data aggregation, and rendering. 

**Proposed fix:** Extract chart logic to `ChartPanel.tsx`, filter/sort logic to hooks.

---

### Minor: Abbreviation Soup in Collector

**Severity:** MINOR  
**Location:** `apps/collector/src/` (throughout)  
**Finding:** Variable names like `ts`, `sid`, `cwd`, `tk`, `m`, `r`, `accToken` are valid in tight scopes but reduce clarity for new readers.

**Proposed fix:** Expand abbreviations in public-facing code: `timestamp`, `sessionId`, `currentWorkingDir`, `token`, `message`, `response`, `accessToken`.

---

### Minor: Over-Generic Naming

**Severity:** MINOR  
**Location:** `apps/web/lib/aggregate.ts` (328 lines)  
**Finding:** File aggregates session stats and serves as a catch-all for formatting/calculation utilities. Name is accurate but could be more specific: `session-aggregation.ts` or `stats-formatter.ts`.

**Proposed fix:** Rename to `session-stats.ts` or `aggregate-sessions.ts` for clarity.

---

## 5. Small Surface Area & Clear Boundaries

### Major: Boundary Violations in API Routes

**Severity:** MAJOR  
**Location:** `apps/web/app/api/` (all 12 route.ts files)  
**Finding:** Every route handles its own:
- Session validation
- GitHub token lookup  
- Database queries
- Error responses

No shared error boundary or middleware. Client/server boundary is clear (no issues), but route coupling is high.

**Proposed fix:** Implement middleware layer for auth + error handling. Group routes by resource (`/api/v1/tokens/`, `/api/v1/sessions/`, etc.).

---

### Minor: Inconsistent Error Response Shapes

**Severity:** MINOR
**Location:** API routes
**Finding:** Error responses vary:
- `{ error: "msg" }` — most routes
- `{ error: "validation", issues: […] }` — `ingest/route.ts:77` (keep: `issues` is a meaningful zod payload for a single known consumer)
- `{ error, detail: "..." }` — `orgs/route.ts:27`

**Proposed fix:** Standardize to `{ error: string; detail?: string }` (NOT `{…, status}` — the HTTP status is already on `NextResponse`; duplicating it in the body is a common mistake). Apply across all 12 route files via a shared `apiError(error, detail?, status?)` helper. See PLAN R-001 — this task has been merged with auth-middleware consolidation to avoid both agents editing the same 7 files.

---

### Minor: No "Use Client" Violations Detected

**Severity:** NONE  
**Finding:** All 11 client components properly import from `auth-client` (not `auth`), and server-only modules are not imported in components. Clean boundary.

---

## 6. Consistency is the Feature

### Major: Inconsistent Data-Fetching Patterns in Web App

**Severity:** MAJOR  
**Location:** `apps/web/app/` (RSC pages vs client components)  
**Finding:** 
- Server-rendered pages (`org/[slug]/page.tsx`, `page.tsx`) fetch data directly in component
- Client components (`org-dashboard.tsx`, `sessions-list.tsx`) use `useEffect` + fetch in browser
- No abstraction for retry, caching, or error boundaries

**Proposed fix:** Create shared fetch utility with retry logic and implement Server Components consistently for data queries (reduce client fetches).

---

### Retracted: Collector CLI `console.*` Usage

**Severity:** RETRACTED (was MAJOR)
**Location:** `apps/collector/src/` (~47 `console.*` calls across 14 files)
**Finding:** The original draft proposed wrapping every `console.log/error/warn` in a `logger` abstraction. On review this is a speculative no-op (principle 2 violation) — each call is a distinct user-facing CLI message, the wrapper signature would be narrower than `console.log`'s real variadic signature (introducing bugs), and a CLI that prints progress to stdout is the idiomatic home of raw `console.*`. "Allows future structured logging" is the banned justification.

The `console.error` calls in 3 API routes (`card/token`, `card/star-repo`, `card/token-by-star`) are a separate, real issue — those are debug prints in production server paths, not CLI output. Tracked as PLAN P-004.

**Proposed fix:** None for the collector. Remove the 3 API-route debug prints (PLAN P-004). Revisit a collector logger only when a second concrete consumer exists.

---

### Minor: Inconsistent Sorting/Filtering in Tables

**Severity:** MINOR  
**Location:** `apps/web/components/team-tables.tsx`, `sessions-list.tsx`  
**Finding:** Each table implements its own sort/filter logic. No shared column definitions or sorting utilities.

**Proposed fix:** Create `table-utils.ts` with shared sort/filter strategies and column metadata.

---

## Summary by Principle

| Principle | Critical | Major | Minor |
|-----------|----------|-------|-------|
| 1. Secrets | 1 | 0 | 1 |
| 2. DRY | 0 | 3 | 1 |
| 3. Dead Code | 1 | 1 | 1 |
| 4. Names | 0 | 1 | 2 |
| 5. Boundaries | 0 | 1 | 1 |
| 6. Consistency | 0 | 2 | 1 |
| **TOTAL** | **2** | **8** | **7** |

---

## High-Risk Items (Must Fix Before OSS Release)

1. **DELETE `scripts/migrate-cards.mjs` + ROTATE DB CREDS + HISTORY SCRUB.** The file contains plaintext production Postgres passwords for two Railway DBs (committed in d823576). Highest-priority principle 1 violation. PLAN P-002.
2. **Dockerfile bakes `BETTER_AUTH_SECRET=build_placeholder_secret` as `ENV`.** If the Railway deploy env does not override it, sessions are forgeable. PLAN D-005.
3. **Add `LICENSE` (MIT).** No `LICENSE` file exists. PLAN D-003.
4. **Update `.env.example`** with all 13 user-configurable variables + note that drizzle reads `.env` not `.env.local`. PLAN D-001.
5. **Delete planning documents** (`plan.md`, `CURSOR-ADAPTER-PLAN.md`). PLAN P-001.
6. **Consolidate auth middleware + error-response shape** across 7 authenticated routes + 12 total route files (combined into a single task to avoid colliding edits). PLAN R-001.
7. **Decompose `CardPage.tsx`** (2036 lines). PLAN R-003.
8. **Evaluate `apps/web/public/collector.mjs`** (950-line build artifact committed to git). PLAN P-005.

---

## Corrections (post-Challenge)

Retracted or revised after the Challenger pass:
- "Three unused deps (`three`/`motion`/`dotenv`)" — ALL used. Retracted; removing them would break the build.
- "12 routes repeat auth pattern" — actually 7 (enumerated above). 5 routes are intentionally public.
- "Wrap collector `console.*` in a logger" — retracted as a speculative abstraction.
- "Consolidate 3 card utility files" — only 2 exist in `lib/`. Reduced to a rename of `card-backend.ts` → `card-tokens.ts`.
- "`fetchGithub()` wrapper over 3 sites" — reduced to a `githubHeaders(token)` helper (only the headers are really duplicated; response shapes differ).

## Total Findings (revised): 16

- **Critical:** 4 (DB creds in history, Dockerfile placeholder secret, LICENSE missing, `.env.example` incomplete)
- **Major:** 5
- **Minor:** 7

All findings are actionable and prioritized for Agents 2/3/4 in PLAN.md.

