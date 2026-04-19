# Bematist — M5 handoff (2026-04-19)

Resume-from-clean-context doc for the cutover work that started the night of 2026-04-18. Read `m5-installer-plan.md` for the primary tomorrow-deliverable (Level 1 / 2 / 3 installer work). This file gives you everything to pick up where we left off.

---

## Where everything lives

| | URL / identifier |
|---|---|
| **Repo** | `github.com/pella-labs/bematist` (HEAD `414b00e`) |
| **Main branch** | Auto-deploys to Railway via `git push origin main` (no GH app auto-deploy wired yet — manual `railway up` for now) |
| **Binary release** | `https://github.com/pella-labs/bematist/releases/tag/v0.1.0` — darwin-arm64 + linux x64/arm64 + windows-x64 + install.sh + cosign sigs + SLSA L3 provenance |
| **Railway project** | `bematist` — `https://railway.com/project/4dcb584b-eeb7-4321-984a-50922a3a1b5f` |
| **Web (dev)** | `https://web-development-90fb.up.railway.app` — port 3000, auto-`bun run start` |
| **Ingest (dev)** | `https://ingest-development.up.railway.app` — port 8000 (JSON), 4318 (OTLP HTTP) |
| **Postgres (dev)** | internal `postgres-a6nm.railway.internal:5432` — public proxy `switchyard.proxy.rlwy.net:40404` |
| **Redis (dev)** | internal `redis.railway.internal:6379` — public proxy `roundhouse.proxy.rlwy.net:11713` |
| **ClickHouse Cloud (dev)** | `pdji63lhul.us-east-2.aws.clickhouse.cloud:8443` — DB `bematist` |
| **Web (prod)** | _not deployed_ — prod Postgres + Redis are provisioned, CH Cloud prod (`kvlgj4eh5t…`) is up but empty |
| **Vercel** | Sebastian's personal org has no bematist project; the org install for `pella-labs` didn't complete tonight. Railway is the current web home. |

Secrets are in `.env.railway.development` (gitignored). Do NOT commit that file.

---

## Your signed-in state

- **Sebastian** — admin of org `sebastiangarcesfaccbf` (id `fb61f18b-ccb6-421b-8e3b-2fe6fb454882`)
  - Email: `gsgarces1@gmail.com`
  - Developer row exists
  - Ingest key: `bm_sebastiangarcesfaccbf_hygtyclfnhyg_9ec5337736940286f14668faabba79a400ca0b15cd7a6f3917120f3cd1cca9cf`
- **Sandesh** (pathaksandesh025@gmail.com) and **Walid** (wkhori@gmail.com) are both in the `default` org as `ic` — they signed in but never completed the invite flow. The fixed `/join` direct-accept is deployed; they should click the invite URL tomorrow and it'll move them.

Current active invite:
- Token: `4nRu1cXNigrDFwBlCT26KUrLYdW0KuPvyGk5HUoPQgI`
- Role: **admin** (might want to revoke + regen as `ic`)
- Max uses: unlimited (`null`)
- Share URL: `https://web-development-90fb.up.railway.app/join/4nRu1cXNigrDFwBlCT26KUrLYdW0KuPvyGk5HUoPQgI`

---

## Resume dev locally

```sh
cd ~/dev/gauntlet/analytics-research
git pull

# Run web against Railway dev DB + CH Cloud dev
bun --env-file=.env.railway.development --filter='@bematist/web' dev

# Run your own collector (once the shell has env vars)
export BEMATIST_ENDPOINT=https://ingest-development.up.railway.app
export BEMATIST_TOKEN=bm_sebastiangarcesfaccbf_hygtyclfnhyg_9ec5337736940286f14668faabba79a400ca0b15cd7a6f3917120f3cd1cca9cf
export BEMATIST_LOG_LEVEL=info
export BEMATIST_POLL_TIMEOUT_MS=1800000
export BEMATIST_BATCH_SIZE=500
bematist doctor     # verify endpoint + ingest reachable
bematist serve      # backfills + tails Claude Code / Codex / Cursor
```

---

## Commands you'll reach for

| Task | Command |
|---|---|
| Deploy web after a change | `railway up --service web --environment development --detach` |
| Deploy ingest after a change | `railway up --service ingest --environment development --detach` |
| View web runtime logs | `railway logs -s web -e development --deployment` |
| View ingest runtime logs | `railway logs -s ingest -e development --deployment` |
| Apply a PG migration to Railway dev | `cd packages/schema && set -a && source ../../.env.railway.development && set +a && bun postgres/migrate.ts` |
| Apply a CH migration to Railway dev | `cd packages/schema && set -a && source ../../.env.railway.development && set +a && bun clickhouse/migrate.ts` |
| Inspect DB state | `bun --env-file=.env.railway.development /tmp/inspect-*.ts` (scripts from tonight live in `/tmp/` — rewrite as needed) |
| Re-sign a new release | `git tag v0.1.1 && git push origin v0.1.1` — fires `.github/workflows/release.yml` |

---

## Env vars that matter on Railway (web service, dev env)

Already set; don't need to touch unless debugging.

| Var | Value | Why |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway reference → resolves to internal private domain |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | Same |
| `CLICKHOUSE_URL` | `https://default:9mW9H~j5CUrI3@pdji63lhul.us-east-2.aws.clickhouse.cloud:8443` | CH Cloud dev — creds inline |
| `CLICKHOUSE_DATABASE` | `bematist` | |
| `BETTER_AUTH_SECRET` | (set) | Session signing |
| `BETTER_AUTH_URL` | `https://web-development-90fb.up.railway.app` | OAuth redirect base |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `https://web-development-90fb.up.railway.app` | Needed for Better Auth's callback URL trust check |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Railway-specific OAuth app (NEW client id — different from the localhost one) | Bound to `/api/auth/callback/github` on the Railway domain |
| `USE_FIXTURES` | `0` | Disables the fixture shim so real DB data shows |
| `BEMATIST_SINGLE_TRUST_DOMAIN` | `1` | Bypasses k-anonymity + cohort-floor display gates for single-dev testing |
| `NODE_ENV` | `production` | Signals Better Auth to use `__Secure-` prefixed cookies |

---

## Bugs fixed the night of 2026-04-18 (commits on `main`)

| Commit | Bug | Fix |
|---|---|---|
| `384f311` | Middleware didn't recognize `__Secure-better-auth.session_token` (prod HTTPS prefix), bounced signed-in users back to sign-in | Check both prefixed + unprefixed cookie names |
| `c828836` | `getSessionCtx()` had the same blind spot | Same dual-check in `apps/web/lib/session.ts` |
| `153191b` | Post-auth route redirects leaked `localhost:3000` into `Location` headers (Railway proxy shows internal origin in `req.url`) | `absoluteUrl()` helper prefers `BETTER_AUTH_URL` → `x-forwarded-{proto,host}` → `req.url` |
| `0c5a592` | Better Auth `callbackURL` as relative path dropped the path on OAuth round-trip | Pass full URL built from `window.location.origin` |
| `f602be5` | `/welcome` RSC crashed on `cookies().delete()` (Next 16 restriction) | Rely on 120s cookie TTL; mutation moves to Server Action as follow-up |
| `3e9a5ed` | Invite was single-use; manager onboarding 100 devs needed 100 links | Added `max_uses` (NULL = unlimited) + `uses` counter + UI field |
| `41a0f8f` | Already-signed-in invitees had `signIn.social` no-op their callbackURL — landed on `/me/digest` instead of accepting | `/join/[token]` page checks session server-side; signed-in → direct Link to `/post-auth/accept-invite` (skips OAuth) |
| `414b00e` | Every event returned `ORG_POLICY_MISSING` — the trigger to auto-create a `policies` row on `orgs` INSERT was in an orphan `sprint1` SQL file never picked up by Drizzle's journal | Moved trigger to `custom/0005_policies_default_provision.sql` + backfilled existing orgs |

---

## Follow-ups queued (nothing in flight)

### Urgent (blocks team demo polish)
1. **Level 1 installer persistence** — see `m5-installer-plan.md`. Biggest UX cliff: users have to `export` env vars manually after running the one-liner.
2. **Test `invites.test.ts` stubs** — SQL-matching stubs in `packages/api/src/queries/invites.test.ts` broke when we added `max_uses` / `uses` columns. 9 tests fail. Runtime + typecheck are green; tests need updating to new SQL shape.

### Soon
3. **Level 2 installer daemon** — launchd (macOS) / systemd (Linux) user unit. See `m5-installer-plan.md`.
4. **Revoke the admin-role invite + mint an `ic` one** for future teammates.
5. **Real-Postgres cross-tenant probe for `org_invites`** (invites teammate's follow-up note).
6. **E2E test `/privacy` behavior** when `BEMATIST_COMPLIANCE_ENABLED=false` (currently expects 200 — will fail with flag off).

### Later
7. **darwin-x64 back in release matrix** once macos-13 runner queue normalizes.
8. **Distro packages render scripts** — `packaging/{homebrew,aur,choco}/render.sh` all hard-code `darwin-x64`; make them skip gracefully when the arch is absent.
9. **Prod migrations** — the prod environment is provisioned but empty. Hold until onboarding is locked.
10. **Vercel deploy** — decide Railway vs Vercel for public hosting. Right now web is on Railway; Vercel was set up at some point but never fully wired.
11. **GitHub app auto-deploy** — Railway's GitHub App is now installed on `pella-labs`. Wire each Railway service to the repo so `git push` → auto-deploy (right now it's manual `railway up`).
12. **`BEMATIST_SINGLE_TRUST_DOMAIN=1`** — remove once there are ≥5 engineers on a team. For managed cloud, this should NEVER be set.

---

## Known gotchas

- **Invites are org-scoped by token only.** Anyone holding an invite URL can join — there's no email-gated constraint. This is by design for the tonight flow (team links). Admins revoke via `/admin/invites`.
- **Audit log is append-only.** A PG trigger blocks UPDATE/DELETE on `audit_log`. To wipe dev accounts you have to `ALTER TABLE audit_log DISABLE TRIGGER USER` around the wipe. Never on prod.
- **Ingest's policy-flip admin route returns 500** until `SIGNED_CONFIG_PUBLIC_KEYS` is set. Not blocking for normal ingest (events still flow); just don't try the `/v1/admin/policy-flip` surface until you generate the Ed25519 keys.
- **Collector is silent by default.** `BEMATIST_LOG_LEVEL=warn` suppresses info logs. Set `=info` to see poll + flush activity.
- **Better Auth rate limiter is in-memory.** A fresh deploy resets it — useful when "too many requests" sticks.

---

## Quick sanity checklist when things look broken

1. **Is ingest healthy?** `curl -fsS https://ingest-development.up.railway.app/healthz` → `{"status":"ok"}`
2. **Is web healthy?** `curl -s -o /dev/null -w '%{http_code}\n' https://web-development-90fb.up.railway.app/home` → `200`
3. **Do I have a policy row for my org?** Run the inspect script in `/tmp/check-policy.ts` (recreate from git history if gone).
4. **Are my collector env vars actually exported?** `bematist doctor` should print `endpoint: https://ingest-development...` — not `http://localhost:8000`.
5. **Any ingest errors?** `railway logs -s ingest -e development --deployment | tail -30`
6. **Any web errors?** `railway logs -s web -e development --deployment | tail -30`
