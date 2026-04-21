# pella-metrics

Per-dev productivity metrics from Claude Code + Codex sessions, org-scoped via GitHub.

## Architecture

```
apps/
  web/         Next.js 14 · better-auth (GitHub) · Drizzle · Postgres
  collector/   Node CLI — reads ~/.claude + ~/.codex, uploads to web
packages/
  shared/      Shared types & parsers
```

## Flow

1. Manager signs in with GitHub → picks org → becomes org admin.
2. Manager invites devs by GitHub login.
3. Dev accepts invite, copies auth token from dashboard.
4. Dev runs `pella-metrics collect` → parses local session files → filters to org repos → uploads.
5. Dashboard shows per-dev + org-rolled views.

## Setup

```bash
cd /Users/san/Desktop/pella-metrics
pnpm install

# Create GitHub OAuth app:
# Homepage:  http://localhost:3000
# Callback:  http://localhost:3000/api/auth/callback/github
# Fill GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET in .env

# Generate auth secret:
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"  # put in .env

# Push schema to Railway Postgres:
pnpm db:push

# Run dev server:
pnpm dev
```

## Collector (dev's machine)

```bash
cd apps/collector
pnpm build
pnpm start -- --token YOUR_TOKEN_FROM_DASHBOARD
```

## Scopes required on the GitHub OAuth app

- `read:org` — list orgs the user belongs to
- `repo` — read private repos (to resolve local `git remote` → `owner/repo`)
- `read:user`, `user:email` — basic profile

## Tables

See `apps/web/lib/db/schema.ts` for the full Drizzle schema.
