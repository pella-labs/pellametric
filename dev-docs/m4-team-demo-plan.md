# M4 — Team Demo Plan

> **Goal:** every teammate runs the Bematist collector on their own machine, sees their real Claude Code activity in a shared dashboard, without us deploying to a public VM yet. This is the **dress rehearsal before prod deploy** — if this works, prod is the same stack on a real domain with TLS.
> **Status:** drafted 2026-04-18 · not started
> **Strategy:** three real code PRs to close the unknowns, then Tailscale-tunnel + seed + onboard.

## Why this milestone

M3 shipped every code gate — perf, privacy, scoring, outcomes, adapters, compliance docs, policy-flip, signed-config validator. But the team still can't actually use Bematist because three load-bearing flows are either stubs or missing:

1. **No real signup.** Better Auth's session-cookie validation landed in PR #56, but there's no signup route, no GitHub OAuth, no magic-link flow — a teammate who visits the dashboard can't log in without us editing the DB.
2. **No real collector daemon.** `apps/collector/` has six adapter parsers but the entry point at `src/index.ts` has never been run against a live ingest. We don't know if the compiled binary actually polls, batches, retries, or persists an egress journal.
3. **No admin UI for ingest keys.** The seed script mints one key per org. There's no self-service "mint me a bearer" flow and no admin-only surface for Sebastian to invite teammates without running psql by hand.

Without those three, "team demo" is "Sebastian does surgery on the DB for each teammate" — not a rehearsal of anything that could ship.

## Non-goals

- Public hosting (VM, domain, TLS). That's M5-deploy.
- Production-grade auth (SSO/SAML/SCIM). GitHub OAuth is enough for now.
- Homebrew tap / signed distro install. `curl -L binary && chmod +x` is fine for the rehearsal.
- Multi-org or managed-cloud modes. One shared org with everyone on it.

---

## What's required — three real PRs

### 1. Better Auth real signup flow

**Problem:** `apps/web/lib/session.ts:getSessionCtx` validates a session cookie and looks up a user row, but nothing in the repo actually *creates* that row. Better Auth is listed in CLAUDE.md §5.2 but the signup / signin / signout routes aren't wired. Any teammate hitting `/` gets rejected by `getSessionCtx` because there's no way to get a valid cookie.

**Required:**
- Better Auth instance configured with **GitHub OAuth** (simplest real provider — no email delivery infra needed).
- Routes: `POST /auth/sign-up`, `POST /auth/sign-in`, `POST /auth/sign-out`, `GET /auth/callback/github`.
- User persistence: `users` table already exists in Postgres (`packages/schema/postgres/`); Better Auth's `user` / `session` / `account` tables must be added via a new Drizzle migration without breaking existing schema.
- First-user-becomes-admin bootstrap (or seeded admin) so there's a way in.
- Sign-in UI at `/auth/sign-in` — minimal shadcn form, one GitHub button.
- Redirect behavior: logged-out visitors to `/*` → `/auth/sign-in`; logged-in visitors to `/auth/sign-in` → `/`.
- `getSessionCtx`'s prod path must resolve a user's `org_id` + `role` from the Better Auth user row (the dev-UUID fallback from PR #56 keeps working locally).

**Acceptance:**
- Sebastian can sign up at `http://localhost:3000/auth/sign-up` with his GitHub account, land on the dashboard, and see his org.
- A second teammate can be invited (via seeded `users` row with their GitHub email) and sign in via the same flow.
- Sign-out clears the session and redirects to sign-in.
- `bun run test` has at least 5 new unit tests covering the auth routes.

**Out of scope:**
- SAML / WorkOS / SCIM (Phase 4 per CLAUDE.md).
- Email magic-links (can add later if GitHub OAuth turns out too restrictive).
- Role-based permissions beyond admin/IC.

**Files (expected):** `apps/web/lib/auth.ts` (new — Better Auth config), `apps/web/app/auth/**` (new — sign-in, sign-up, callback routes), `apps/web/app/auth/sign-in/page.tsx` (new), `packages/schema/postgres/migrations/00NN_better_auth_tables.sql` (new), `apps/web/lib/session.ts` (extend prod branch to read Better Auth user), `.env.example` (add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_URL`).

---

### 2. Collector daemon — real, not scaffolding

**Problem:** `apps/collector/src/index.ts` exists but has never been run against a live ingest. The six adapters under `apps/collector/src/adapters/` parse events correctly (golden fixtures prove this in CI), but there's no proven main loop that (a) schedules adapter polls, (b) batches events, (c) POSTs to ingest with retry, (d) handles offline/backlog replay, (e) writes the Bill-of-Rights-mandated egress journal.

**Required:**
- `bun build --compile src/index.ts -o ./bin/bematist` produces a working binary on macOS arm64, macOS x64, and Linux x64.
- Binary reads config from env + optional `~/.bematist/config.yaml`:
  - `BEMATIST_ENDPOINT` — ingest URL (default `http://localhost:8000`)
  - `BEMATIST_TOKEN` — bearer (required)
  - `BEMATIST_DATA_DIR` — egress journal + state dir (default `~/.bematist`)
  - `BEMATIST_LOG_LEVEL` — default `warn`
  - `BEMATIST_DRY_RUN` — `1` = log without sending (required per CLAUDE.md Bill of Rights)
- Main loop:
  - Detect which adapters apply on this machine (Claude Code present? Cursor SQLite present? etc.).
  - Poll each active adapter on its natural cadence (JSONL tail for Claude Code/Codex, SQLite diff for Cursor, four-stream tail for Continue.dev).
  - Batch events (configurable, default 10 per request) and POST to `/v1/events`.
  - Retry with exponential backoff on 5xx / network errors; surface 4xx immediately (auth failure should not retry forever).
  - Write every outgoing batch to `~/.bematist/egress.jsonl` (append-only) for the `bematist audit --tail` command.
  - Persist per-adapter cursor state in `~/.bematist/state/` so a restart resumes where it left off.
- CLI surface (subset of CLAUDE.md §Commands):
  - `bematist status` — active adapters, last event, queue depth, version
  - `bematist dry-run` — logs what would be sent, sends nothing (default on first run per CLAUDE.md)
  - `bematist audit --tail` — streams the egress journal
  - `bematist doctor` — checks ulimit, ingest reachability, adapter health
- Graceful shutdown on SIGINT/SIGTERM: flush in-flight batches, persist cursor state, no partial writes.
- **Crash dumps disabled** (`ulimit -c 0` + `RLIMIT_CORE=0`) per CLAUDE.md §Security Rules.

**Acceptance:**
- Sebastian runs `./bin/bematist` against local docker-compose stack with his own bearer + his real `~/.claude/projects/` data; events appear in `events` table within 60s.
- Ingest restarts → collector queues events → ingest comes back → events flush with no loss.
- Collector restarts → resumes from cursor, no duplicate events (client_event_id + Redis SETNX dedup handles it).
- `bematist dry-run` on a machine with Claude Code data prints the first 10 events it *would* send, exits 0, sends nothing.
- `bematist audit --tail` shows every byte that left the machine in the last session.
- Contract tests (`packages/fixtures/` golden) still pass.
- Binary size reasonable (< 100MB).

**Out of scope:**
- `bematist install` distro-package command (Homebrew/apt/AUR/Choco) — M5.
- `bematist erase` GDPR flow — already shipped server-side; CLI can wait.
- `bematist export --compliance` — Phase 2.
- Auto-update.

**Files (expected):** `apps/collector/src/index.ts` (rewrite to real daemon), `apps/collector/src/loop.ts` (new — main loop), `apps/collector/src/egress/journal.ts` (new), `apps/collector/src/egress/httpClient.ts` (new — retry + backoff), `apps/collector/src/cli/` (new — status/dry-run/audit/doctor subcommands), `apps/collector/src/config.ts` (new — env + YAML resolution).

---

### 3. Admin UI for ingest-key minting

**Problem:** Today the only way a teammate gets an ingest bearer is Sebastian running `bun run db:seed` or writing raw SQL. For a team demo we need a self-service surface (admin mints, teammate picks up) that matches what real usage will look like.

**Required:**
- `/admin/ingest-keys` page — admin-only (role check in `getSessionCtx`).
- List view: active keys by engineer, created-at, last-used-at, revoke button.
- Create form: pick an engineer from the org's `developers` table, mint a new key, display the **full bearer exactly once** (copy-to-clipboard), only the sha256 hash is stored.
- Revoke flow: soft-delete (mark `revoked_at`), subsequent ingest requests using that bearer get 401.
- Audit log entry on mint + revoke (existing `audit_log` table).
- **Optional** but nice: `/admin/invite` form — pick a GitHub email, create `users` row + `developers` row + ingest key in one step, show the teammate an invite link with the bearer embedded (single-use display).

**Acceptance:**
- Sebastian at `/admin/ingest-keys` mints a key for teammate X; teammate X uses that bearer in `BEMATIST_TOKEN` and events flow successfully.
- Revoking the key causes the teammate's next batch to 401 within 60s (or whatever the bearer cache TTL allows).
- Non-admin users hitting `/admin/*` get redirected to `/` (not 500, not 404).
- Cross-tenant probe: admin at Org A cannot mint keys for Org B engineers (INT9-style test).

**Out of scope:**
- Programmatic API for key minting — just the UI.
- Multi-use invite links (one bearer per invite).
- Key rotation policies, expiration, MFA for minting.

**Files (expected):** `apps/web/app/admin/ingest-keys/page.tsx` (new), `apps/web/app/admin/ingest-keys/actions.ts` (new — Server Actions for mint/revoke), `apps/web/app/admin/_components/` (new — shadcn forms), `packages/api/src/queries/ingestKeys.ts` (new — list + create + revoke), `packages/api/src/schemas/ingestKey.ts` (new — zod inputs).

---

## After the three PRs land — Phase B execution plan

### B.1 — Stand up the stack on Sebastian's machine (~30min)

```bash
# Spin up the prod-template compose
docker compose -f docker-compose.yml up -d

# Migrations + seed one real org with Sebastian as admin
bun run db:migrate:pg
bun run db:migrate:ch
bun run db:seed              # minimal seed, NOT seed:perf — we want real data, not synthetic

# Build the collector locally
cd apps/collector
bun build --compile src/index.ts -o ../../bin/bematist-darwin-arm64

# Sign up as Sebastian via GitHub OAuth at http://localhost:3000/auth/sign-up
# Go to /admin/ingest-keys → mint a key for yourself
# Run the collector against localhost
BEMATIST_ENDPOINT=http://localhost:8000 \
BEMATIST_TOKEN=bm_<your-bearer> \
./bin/bematist-darwin-arm64
```

Expected: within 60s, `/dashboard/sessions` shows your last Claude Code sessions with real token counts.

### B.2 — Tailscale for multi-machine (~15min)

1. Install Tailscale on Sebastian's Mac. Auth via the Bematist-Labs org account.
2. Note your tailnet IP (likely `100.x.y.z`) — this replaces `localhost` for teammates.
3. Expose the docker-compose stack to the tailnet:
   - Ingest: `0.0.0.0:8000` (already the compose default)
   - Web: `0.0.0.0:3000`
4. Set `BETTER_AUTH_URL=http://<your-tailnet-ip>:3000` in the compose `.env` and restart web so OAuth redirects land correctly.

### B.3 — Onboard teammates (~15min per teammate)

For each teammate:

1. Sebastian at `/admin/invite` or `/admin/ingest-keys` mints a key for them.
2. Teammate installs Tailscale, joins the tailnet.
3. Teammate `curl`s the collector binary (we'll share via a private GitHub release or direct scp).
4. Teammate runs:
   ```bash
   BEMATIST_ENDPOINT=http://<sebastian-tailnet-ip>:8000 \
   BEMATIST_TOKEN=bm_<their-bearer> \
   ./bematist
   ```
5. Teammate browses to `http://<sebastian-tailnet-ip>:3000`, signs in with GitHub, sees their own `/me` page.

### B.4 — Verify team-level views work (~30min)

Once ≥3 teammates are feeding events:

- `/teams/<slug>` — 2×2 manager view renders with color dots for each IC.
- `/sessions` — Sebastian sees his own sessions; admin view shows all sessions.
- `/outcomes` — once teammates start making commits/PRs, GitHub App webhook fires and outcomes roll up.
- `/insights` — weekly digest runs (may need to manually trigger via worker).
- k-anonymity floors: with only 3 ICs, `/teams` should render "insufficient cohort (k<5)" — verify the gate message is clear, not broken.

---

## Phase C — prod-readiness gates (checkpoint before M5-deploy)

Before flipping to a real VM with a domain:

- **Data persistence:** `docker compose down && docker compose up` preserves events, users, ingest keys. Volumes wired in `docker-compose.yml`.
- **Offline replay:** teammate runs collector while ingest is down for 10min; when ingest returns, backlog flushes without data loss.
- **Privacy tier enforcement:** one teammate configures Tier A (counters only), verify dashboard shows only aggregate data for them, never prompt text.
- **GDPR erase:** admin runs `bematist erase --user <id>` (or CLI equivalent); partition drops within 7 days.
- **Audit log:** every `/admin` action + every prompt-text reveal writes to `audit_log`. Admin can view at `/admin/audit`.
- **Per-dev binary SHA check** — dashboard shows the SHA256 of each teammate's collector binary. Alert on non-canonical builds (CLAUDE.md §Security Rules).

If any of those fail, they become M4 follow-ups, not M5 blockers.

---

## Timeline estimate

| Phase | Scope | Realistic wall-clock |
|---|---|---|
| A.1 — Better Auth real | One PR, parallel-agent-friendly | 3–4 hours |
| A.2 — Collector daemon real | One PR, largest of the three | 6–8 hours |
| A.3 — Admin UI for keys | One PR, smallest | 2–3 hours |
| B.1 → B.4 — run the rehearsal | manual, needs teammates available | ~2 hours including teammates' setup |
| C — verify prod-readiness | manual checklist | 2 hours |
| **Total to "team is using Bematist"** | — | **~1 full day if PRs run in parallel, ~2 days serial** |

---

## Execution strategy

All three PRs are mostly disjoint file-scope-wise. Spawn three Opus 4.7 agents in parallel (isolated worktrees), each with the brief from its section above. Follow the same pattern M3 used — standard preamble, OWNS / DO NOT TOUCH scopes, merge-blocker gates, PR not merged until human review.

**Expected collisions:**
- `apps/web/lib/session.ts` — auth PR extends prod branch; no other agent touches it.
- `.env.example` — auth PR adds `GITHUB_*`; admin-UI PR might add nothing. Safe.
- `packages/api/src/queries/` — admin-UI PR adds `ingestKeys.ts`; other agents don't touch. Safe.
- `packages/schema/postgres/migrations/` — auth PR adds one migration; admin-UI probably touches the same directory. Serialize the migration numbering manually if both land close.

---

## Unknowns (resolve during Phase A execution, not before)

- **Does Bun's `build --compile` produce a binary that can exec shell helpers** (e.g. reading Cursor's SQLite via a forked copy)? If not, the collector might need to be Bun-runtime rather than compiled. Fallback: ship Bun + the scripts together in a zip.
- **Does Better Auth 1.5+ play nicely with Next.js 16 standalone output?** If not, may need to downgrade Next to 15.x or wait for a Better Auth patch.
- **Is the current `audit_log` table RLS-scoped so cross-tenant admins can't see each other's audit entries?** Check before #3 ships.

---

## Definition of done for M4

- [ ] PR 1 (Better Auth real) merged, tests green, OAuth round-trip works on Sebastian's machine
- [ ] PR 2 (Collector daemon real) merged, binary builds for macOS arm64 + x64, daemon runs for 1hr against local ingest without crashing, egress journal populated
- [ ] PR 3 (Admin UI for keys) merged, Sebastian can mint + revoke a key via the UI, non-admin redirect works
- [ ] At least 3 teammates (including Sebastian) have run the collector on their own machines via Tailscale and are visible as distinct engineers in the dashboard for ≥ 24 hours
- [ ] `docs/team-demo-transcript.md` (or similar) captures the flow end-to-end with real screenshots + logs — **this is the rehearsal artifact that proves we're ready for M5-deploy**
