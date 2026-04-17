# Bematist

> Repo slug for **DevMetrics** — open-source AI-engineering analytics platform. See `dev-docs/PRD.md` (locked) and `CLAUDE.md` (conventions).

## Quickstart

```bash
bun install                                          # install workspace deps
cp .env.example .env                                 # fill in secrets (gitignored)
docker compose -f docker-compose.dev.yml up -d       # postgres + clickhouse + redis

bun run db:migrate:pg                                # drizzle migrations
bun run db:migrate:ch                                # clickhouse migrations

bun run lint                                         # biome
bun run typecheck                                    # tsc --noEmit across all workspaces
bun run test                                         # bun test
```

All root scripts that need env vars load `.env` automatically via Bun's `--env-file` flag (see root `package.json`). Filtered subprocesses inherit the env from the parent.

## Layout

```
apps/      # web, ingest, collector, worker
packages/  # schema, sdk, api, otel, ui, redact, embed, scoring, clio, fixtures, config
contracts/ # cross-workstream seam contracts (01..09)
dev-docs/  # PRD (locked), summary (decisions), archived research
legal/     # compliance templates (Sprint 3+)
infra/     # otel-collector config (optional sidecar)
```

## Workstreams

Five people, five owners — see `WORKSTREAMS.md`. **Sebastian** owns Foundation (this PR).

## Branch protection

Configure in GitHub → Settings → Branches → `main`:

- Require pull request before merging.
- Require status check: `ci / build` (the only job defined in `.github/workflows/ci.yml`).
- Dismiss stale reviews, require branches to be up to date.

## Host port mapping (dev)

The dev Postgres binds to host port **5433** (not 5432) to avoid collision with other projects. Container still listens on 5432. `DATABASE_URL` in `.env.example` reflects this.

### Per-dev port overrides

If the default ports (5433 pg, 6379 redis, 8000 ingest, 3000 web) still collide with other projects on your machine, create `docker-compose.dev.local.yml` and remap host ports there (gitignored via `docker-compose.*.local.yml`). Example:

```yaml
services:
  postgres:
    ports: ["5435:5432"]
  redis:
    ports: ["6381:6379"]
```

Then bring the stack up with both files merged:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.dev.local.yml up -d
```

Update the matching URLs (e.g. `DATABASE_URL`, `REDIS_URL`) in your `.env` to use the remapped ports. The tracked `docker-compose.dev.yml` stays at upstream defaults.

## Locked rules

- Product name is **DevMetrics**; repo slug is `bematist`; workspace packages are `@bematist/*` per decision from Sprint 0 kickoff.
- Tier-B privacy default (not C). See `CLAUDE.md` §"Privacy Model Rules".
- No Pharos anything (PRD §D1).
