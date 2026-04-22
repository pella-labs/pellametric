# pella-metrics

Per-dev productivity metrics from Claude Code + Codex sessions, org-scoped via GitHub.

## Architecture

```
apps/
  web/         Next.js 16 · better-auth (GitHub) · Drizzle · Postgres
  collector/   Bun binary — streams ~/.claude + ~/.codex sessions to /api/ingest
packages/
  shared/      Shared types
```

## Flow

1. Manager signs in with GitHub → picks org → becomes org admin.
2. Manager invites devs by GitHub login.
3. Dev accepts invite, goes to `/setup/collector`, issues a token, pastes the install one-liner.
4. The collector runs as a per-user background service (launchd / systemd --user / Scheduled Task). It streams new session data every 10 s and re-starts automatically at every login.
5. Dashboard shows per-dev + org-rolled views.

## Install the collector (as a dev)

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

## Develop the web app

```bash
bun install

# Create GitHub OAuth app:
# Homepage:  http://localhost:3000
# Callback:  http://localhost:3000/api/auth/callback/github
# Fill GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET in .env

# Auth secret:
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"  # put in .env

# Push schema to Railway Postgres:
bun run db:push

# Dev server:
bun run dev
```

## Build the collector binaries

```bash
cd apps/collector
bun run build:darwin-arm64   # + darwin-x64, linux-x64, linux-arm64, windows-x64
# outputs bin/pella-<target>[.exe]
```

`bun build --compile` cross-compiles from any host (Bun downloads each target runtime on demand). In CI, `.github/workflows/release.yml` builds all 5 targets on `v*` tag push, attaches them + `SHA256SUMS` to a GitHub Release.

## Scopes required on the GitHub OAuth app

- `read:org` — list orgs the user belongs to
- `repo` — read private repos (to resolve local `git remote` → `owner/repo`)
- `read:user`, `user:email` — basic profile

## Tables

See `apps/web/lib/db/schema.ts` for the full Drizzle schema.
