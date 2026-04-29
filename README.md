# Pellametric

![Pellametric](apps/web/public/primary-logo.svg)

> Per-dev productivity metrics from Claude Code + Codex sessions, org-scoped via GitHub.

Pellametric is an open-source dashboard for engineering managers who want a real view of how their team uses AI coding assistants. It pairs a Next.js web app with a tiny Bun collector daemon that each developer runs locally. The collector streams Claude Code and Codex session metadata (plus optional Cursor events) to the web app; the web app rolls it up per developer and per GitHub org so managers get a dashboard without any self-reporting.

<!-- TODO: add screenshot showing the org dashboard -->

**Stack:** Next.js 16 · Postgres · Drizzle ORM · Better-Auth · Bun · Railway

---

## Quick start on Railway

Railway is the documented deploy target — the repo ships with a `Dockerfile` and `railway.toml` tuned for it.

1. Fork this repo on GitHub.
2. In Railway, **New Project → Deploy from GitHub repo** and pick your fork.
3. Add the **Postgres** plugin to the project. Railway will expose `DATABASE_URL` automatically.
4. In the service **Variables** tab, set the required env vars from [`.env.example`](./.env.example):
   - `BETTER_AUTH_SECRET` (run `openssl rand -hex 32`)
   - `BETTER_AUTH_URL` and `NEXT_PUBLIC_BETTER_AUTH_URL` (Railway-assigned URL)
   - `NEXT_PUBLIC_SITE_URL` (same URL)
   - `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (from a GitHub OAuth app)
   - `PROMPT_MASTER_KEY` (run `openssl rand -base64 32`)
   - Optional: `GITHUB_TOKEN` for higher GitHub API rate limits
5. Push to `main` to trigger the first deploy.
6. On first boot, run `bun run db:push` via the Railway shell (or locally against the production `DATABASE_URL`) to create the Drizzle tables.
7. Open the Railway-assigned URL and sign in with GitHub.

## Local development

```bash
git clone https://github.com/<you>/pellametric.git
cd pellametric
bun install
cp .env.example .env     # NOTE: .env, not .env.local — drizzle reads .env
# Fill in DATABASE_URL, BETTER_AUTH_SECRET, GITHUB_CLIENT_ID/SECRET, etc.
bun run db:push          # create tables
bun run dev              # http://localhost:3000
```

Package manager is `bun@1.3.9` (see root `package.json`). Don't mix in npm / pnpm / yarn — lockfiles will drift.

The collector daemon lives under `apps/collector`. For CLI flags and subcommands, run:

```bash
bun --filter='./apps/collector' run start -- help
```

## Architecture

```
apps/
  web/         Next.js 16 · better-auth (GitHub) · Drizzle · Postgres
  collector/   Bun binary — streams ~/.claude + ~/.codex sessions to /api/ingest
packages/
  shared/      Shared types
```

**Flow:**

1. Manager signs in with GitHub → picks org → becomes org admin.
2. Manager invites devs by GitHub login.
3. Dev accepts invite, visits `/setup/collector`, issues a token, pastes the install one-liner.
4. The collector runs as a per-user background service (launchd / systemd --user / Scheduled Task). It streams new session data every 10 s and re-starts at login.
5. Dashboard shows per-dev + org-rolled views.

## Installing the collector (as a dev)

```bash
# macOS / Linux
curl -fsSL https://pellametric.com/install.sh | sh -s -- --token pm_xxx

# Windows (PowerShell)
$env:PELLA_TOKEN="pm_xxx"; irm https://pellametric.com/install.ps1 | iex
```

One command. Downloads the binary, verifies SHA-256, writes `~/.pella/config.env` (mode 0600), installs + starts the OS service, and detaches. After install:

```bash
pella status    # running / stopped / not-installed
pella logs      # tail stdout/stderr (or journalctl on Linux)
pella stop      # stop the service (unit file preserved)
pella logout    # stop + remove config
```

The `curl … /collector.mjs | node - --token pm_…` fallback still works for one-shot backfills on machines where a service can't be installed.

## Environment variables

See [`.env.example`](./.env.example) for full annotations, generation commands, and where each variable is read.

| Variable                       | Required | Description                                                                 |
| ------------------------------ | -------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`                 | yes      | Postgres connection string. Read by Drizzle and drizzle-kit.                |
| `BETTER_AUTH_SECRET`           | yes      | Better-Auth server secret (32 bytes hex). App refuses to start without it.  |
| `BETTER_AUTH_URL`              | yes      | Server-side Better-Auth base URL.                                           |
| `GITHUB_CLIENT_ID`             | yes      | GitHub OAuth app client ID.                                                 |
| `GITHUB_CLIENT_SECRET`         | yes      | GitHub OAuth app client secret.                                             |
| `PROMPT_MASTER_KEY`            | yes      | 32-byte base64 key for at-rest prompt encryption.                           |
| `NEXT_PUBLIC_SITE_URL`         | yes      | Public site URL (inlined into client bundle at build).                      |
| `NEXT_PUBLIC_BETTER_AUTH_URL`  | yes      | Public Better-Auth URL used by the browser auth client.                     |
| `GITHUB_TOKEN`                 | no       | Lifts GitHub API rate limits for server-side repo/star lookups.             |
| `PELLA_COLLECTOR_DEFAULT_URL`  | no       | Build-time default upload URL baked into the collector.                     |
| `PELLA_TOKEN`                  | no       | Per-user collector ingest token. Normally set by `pella login`.             |
| `PELLA_URL`                    | no       | Override the collector's upload URL.                                        |
| `PELLA_SKIP_CURSOR`            | no       | Set to `1` to skip Cursor session parsing.                                  |
| `PELLA_BIN`                    | no       | Dev-only override for the `pella` binary path used by the daemon.           |

## Other platforms

Pellametric is a standard Next.js + Postgres app and runs anywhere that supports both. Railway is what we document; Vercel + a managed Postgres (Neon, Supabase, etc.), Fly.io, or self-hosted Docker all work with the same `.env` variables. The only runtime hard requirement beyond Node-compatible JS is Bun on the server (Next.js is started via `bun run start`); if you need a pure-Node runtime, swap the start command for `next start`.

## GitHub OAuth scopes

- `read:org` — list orgs the user belongs to
- `repo` — read private repos (to resolve local `git remote` → `owner/repo`)
- `read:user`, `user:email` — basic profile

## Contributing

PRs welcome. Before pushing:

```bash
bun run typecheck
bun run build
bun test
```

Keep any new `process.env.*` reference mirrored in [`.env.example`](./.env.example). Don't commit `.env` files or secrets. Follow the existing file organization — clear names over comments, small modules over large ones.

## License

MIT — see [LICENSE](./LICENSE).
