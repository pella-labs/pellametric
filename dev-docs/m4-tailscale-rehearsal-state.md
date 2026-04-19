# M4 Phase B.1 — Tailscale rehearsal handoff

> **Purpose:** context dump so a fresh Claude session can pick up the team-demo rehearsal without re-walking the last four hours of debugging.
> **Author:** Sebastian Garces
> **Drafted:** 2026-04-18

## Where we are

- M4 **Phase A** (three code PRs): ✅ landed — #68, #69, #70, #71 all merged. Lint cleanup #72 merged. README setup guide #74 open. Phase-B blocker fixes #73 + #75 merged.
- M4 **Phase B.1** (stand-up on Sebastian's Mac): ✅ stack running, OAuth sign-in round-trip works, `USE_FIXTURES=0` engaged, admin UI mints valid bearers.
- M4 **Phase B.2** (Tailscale): ✅ tailnet up, Sebastian's IP is **`100.88.123.96`** on `pella-labs.org.github`.
- M4 **Phase B.3** (teammate onboarding): 🚧 one teammate signed in but got the IC crash (now fixed by #75); have not yet onboarded anyone to run a collector.
- M4 **Phase B.4** (verify team-level views): ❌ not started — needs ≥3 teammates running collectors.

## Live state as of handoff

### Stack

- **Docker compose services** running via `docker-compose.dev.yml` on Sebastian's Mac:
  - `bematist-postgres` — `timescale/timescaledb:latest-pg16` on `127.0.0.1:5433`
  - `bematist-clickhouse` — `clickhouse/clickhouse-server:25.8-alpine` on `127.0.0.1:8123`
  - `bematist-redis` — `redis:7-alpine` on `127.0.0.1:6379`
- **Ingest** on `0.0.0.0:8000` — tailnet-reachable at `http://100.88.123.96:8000/v1/events`. Log file: `/tmp/ingest2.log`.
- **Web** on `0.0.0.0:3000` — tailnet-reachable at `http://100.88.123.96:3000`. Log file: `/tmp/web-tailnet.log`.
- **Collector binary** built at `./bin/bematist-darwin-arm64` (58 MB).

### GitHub OAuth app

- Registered with `Ov23lijQmaBGLgkMyE5Y` client ID (in `.env` alongside secret).
- **Homepage URL:** `http://100.88.123.96:3000`
- **Callback URL:** `http://100.88.123.96:3000/api/auth/callback/github`

### `.env` (locally modified, not committed — secrets)

Key vars added/changed during this session:

```bash
BETTER_AUTH_SECRET=5d7b56729dc618f26b84df4fd0f84ee1671aa06348750d180d444da2ff875d84
BETTER_AUTH_URL=http://100.88.123.96:3000
GITHUB_CLIENT_ID=Ov23lijQmaBGLgkMyE5Y
GITHUB_CLIENT_SECRET=<redacted — already in your .env>
USE_FIXTURES=0

# Dev-pin bypass commented out so real OAuth runs:
# BEMATIST_DEV_TENANT_ID=...
# BEMATIST_DEV_ACTOR_ID=...
# BEMATIST_DEV_ROLE=admin
```

### DB state (live)

- **Org:** one org, `anomkinds` — UUID `34de748a-a844-4ab7-a4a7-b3c464e3077a`.
  - (The slug was originally `anom_kinds` with an underscore — a leaked worker test fixture. Renamed via `UPDATE orgs` + #75's `getOrCreateDefaultOrg` guard prevents future regressions.)
- **Users (4 total, all linked to Better Auth):**
  | email | role |
  |---|---|
  | `gsgarces1@gmail.com` | `admin` |
  | `doa9200@gmail.com` | `ic` |
  | `pathaksandesh025@gmail.com` | `ic` |
  | `wkhori@gmail.com` | `ic` |
- **Developers (4 total):** one per user, `stable_hash = eng_<md5(email)[:12]>`.
- **Policies:** one row for `anomkinds` with `tier_default='B'`.
- **Ingest keys:** one minted key, id `pich2749xpic`, full bearer `bm_anomkinds_pich2749xpic_8f3e1be195b0aa9b90a3703960a7026f825beff538a574db370b2a8a6e2b9254` (already shared with Sebastian).
- **ClickHouse events:** ~2 synthetic events from smoke tests; real Claude Code events will flow once the collector runs against `~/.claude/projects/`.

### Bugs fixed on main (PR #75)

1. **Better Auth Drizzle field naming** — camelCase JS keys on `better_auth_*` tables (was snake_case, caused `expiresAt not found` 500).
2. **IC role crash on `/`** — redirect engineers to `/me/digest`.
3. **Alphanumeric slug guard** — `getOrCreateDefaultOrg` skips non-alphanumeric slugs.
4. **Destructive worker test** — `apps/worker/.../pg_notifier.test.ts` gated on `PG_INTEGRATION_TESTS=1`. CI sets it, local run skips (was wiping the dev DB via CASCADE).
5. **Real-DB query stubs** — `audit.getMyViewHistoryReal` and `insights.getWeeklyDigestReal` return empty instead of querying non-existent columns.
6. **Next.js dev CORS** — `allowedDevOrigins: ["100.88.123.96"]` in `next.config.ts`.

## What's still blocking Phase B.3/B.4

1. **No real Claude events visible yet.** Sebastian minted a key but hasn't run the collector against his `~/.claude/projects/`. Next step for him:
   ```bash
   cd ~/dev/gauntlet/analytics-research
   BEMATIST_ENDPOINT=http://localhost:8000 \
   BEMATIST_TOKEN=bm_anomkinds_pich2749xpic_8f3e1be195b0aa9b90a3703960a7026f825beff538a574db370b2a8a6e2b9254 \
   ./bin/bematist-darwin-arm64 serve
   ```
   Leave it running, watch `/sessions` at `http://100.88.123.96:3000/sessions` for his sessions to appear within 60s.

2. **Teammates haven't run collectors.** For each teammate Sebastian needs to:
   - Go to `/admin/ingest-keys` → select their engineer from the picker → Mint → copy the bearer.
   - Build or reuse the binary for their platform (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`).
   - Send both bearer + binary out-of-band (Slack DM, Tailscale file cp, AirDrop).
   - They run:
     ```bash
     BEMATIST_ENDPOINT=http://100.88.123.96:8000 \
     BEMATIST_TOKEN=<their bearer> \
     ./bematist-darwin-arm64 serve
     ```

3. **`/insights`, `/clusters`, `/outcomes`, `/alerts`** may still crash on `USE_FIXTURES=0` if their real-DB branches reference schema that doesn't exist. Same pattern as the audit + insights stubs in #75. Expect whack-a-mole when clicking around; stub each one the same way (`async (ctx, input) => { empty }` + a test that asserts pg is not called).

4. **OAuth app callback is pinned to the current tailnet IP.** If Sebastian's tailnet IP changes (restart, new network), he'll need to update the GitHub OAuth app's callback URL + `BETTER_AUTH_URL` in `.env` + restart web.

## Processes to know about

- **Ingest** PID and web PID rotate every time web restarts. Find them via:
  ```bash
  lsof -nP -i TCP:8000    # ingest
  lsof -nP -i TCP:3000    # web
  ```
- **Starting fresh** (if anything dies):
  ```bash
  # From repo root — terminal 1: ingest
  set -a && source .env && set +a
  cd apps/ingest && bun run src/index.ts > /tmp/ingest.log 2>&1 &

  # Terminal 2: web
  set -a && source .env && set +a
  cd apps/web && DASHBOARD_ENABLED=1 bun run dev > /tmp/web-tailnet.log 2>&1 &
  ```

- **Verify health:**
  ```bash
  curl -fsS http://100.88.123.96:3000/api/auth/ok   # {"ok":true}
  curl -fsS http://100.88.123.96:8000/healthz        # {"status":"ok"}
  curl -fsS http://100.88.123.96:8000/readyz | jq .deps
  ```

## Open PRs

- **#74** — README setup guide (docs-only, not yet merged).
- All other M4 PRs merged.

## Handy commands

```bash
# Re-mint a bearer for a user (replace uuids/emails as needed)
docker exec bematist-postgres psql -U postgres -d bematist -c "
  SELECT d.id AS engineer_id, u.email, o.slug FROM developers d
    JOIN users u ON u.id=d.user_id
    JOIN orgs  o ON o.id=d.org_id;
"

# See what event kinds actually landed in CH for the live org
docker exec bematist-clickhouse clickhouse-client --query "
  SELECT event_kind, count() FROM bematist.events
   WHERE org_id='34de748a-a844-4ab7-a4a7-b3c464e3077a'
   GROUP BY event_kind ORDER BY 2 DESC
"

# Tail the egress journal (what the collector has already sent)
./bin/bematist-darwin-arm64 audit --tail | head -20

# Doctor check
./bin/bematist-darwin-arm64 doctor
```

## Decisions locked during this session

- Works-council posture: teammates sign in with their pella-labs GitHub identity; they land as `role='ic'` and see `/me/digest`, not team rollups. Admin is Sebastian.
- No production deploy until M5 — Tailscale is the rehearsal substrate.
- Real-DB branches that don't match the schema are **stubbed to empty**, not hand-written — waiting for the respective Workstream writers (Workstream H for insights, audit-event logger for drills) to reshape. Tracked in #75's commit body.

## If you need to keep going from here

1. Verify the ingest + web are still running (tailnet URLs above).
2. Ask Sebastian what error he's seeing, or what URL he's on — most likely a stubbable real-DB schema mismatch; follow the pattern from audit.ts / insights.ts.
3. For new teammate onboarding, the bottleneck is getting the binary + bearer to them. Tailscale `file cp` is probably the cleanest.
4. The "Claude Code adapter parses real JSONL" fix from PR #73 is live — so the collector DOES work against real `~/.claude/projects/`. When events start flowing, confirm via the ClickHouse query above.
