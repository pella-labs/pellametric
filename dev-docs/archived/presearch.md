# DevMetrics — Pre-Implementation Research

**Date:** 2026-04-16
**Mode:** Greenfield
**Lead:** team-lead (presearch v2)
**Working dir:** `/Users/sebastian/dev/gauntlet/analytics-research`
**Status:** Loop 1, 1.5, 2 drafted. Loop 3 + Loop 6 in progress.

> Companion docs: [`research-brief.md`](./research-brief.md), [`PRD.md`](./PRD.md), root [`CLAUDE.md`](../CLAUDE.md)

---

## Loop 1 — Constraints (LOCKED)

### 1.1 Domain & use cases

**Problem:** Engineering managers running teams of AI-coding developers (any IDE/ADE) have zero cross-developer visibility into where their LLM spend is going, who is efficient, what prompts work, and how token usage correlates with shipped output. Today they look at API bills and shrug.

**Users:**
- **Primary:** Engineering manager / VP Eng (the dashboard viewer + decision maker)
- **Secondary:** Developer (the source of telemetry, sometimes a self-improvement viewer)
- **Tertiary:** Finance / FinOps (cost attribution, budget enforcement)

**Top 5 use cases (manager outcomes):**
1. "Show me which 5 prompt patterns produced the most-merged PRs this sprint."
2. "Why is dev X consuming 3× the tokens of dev Y for similar work?"
3. "What's our cost per merged PR by repo and by model? Is it trending up?"
4. "Which developers are stuck in retry loops (high tool-use failure ratio)?"
5. "Who on my team should run a coaching session on prompt engineering this Friday?"

**Greenfield:** yes. References to mine: `pinakes` (multi-IDE install pattern, SQLite/Drizzle, MCP, privacy tests), `grammata` (local LLM session readers — building block).

### 1.2 Scale & performance

| Metric | Demo | Small org | Target | Stretch |
|---|---|---|---|---|
| Devs per deployment | 10 | 100 | **10k** | 50k |
| Sessions/dev/day | 5 | 8 | 8 | 8 |
| Events/session (turns + tools) | 50 | 100 | 100 | 200 |
| Events/day | 2.5k | 80k | **8M** | 80M |
| Events/year | ~1M | ~30M | **~3B** | ~30B |
| Dashboard p95 query latency | <2s | <2s | **<2s** | <1s |
| Ingest p99 (event accept) | <100ms | <100ms | **<100ms** | <50ms |
| Manager-page TTFB | <500ms | <500ms | **<500ms** | <200ms |

**Locked:** target 10k devs day one (per user direction "let's go with scale"). Drives DB choice toward ClickHouse-class OLAP for events.

### 1.3 Budget & cost

| Category | Budget | Notes |
|---|---|---|
| Total dev spend (presearch + build) | TBD by user | tracked via DevMetrics itself once Phase 1 ships (eat our dogfood) |
| Self-host cost @ 100 devs | <$200/mo target | single small VM viable |
| Self-host cost @ 10k devs | <$2k/mo target | ClickHouse + Postgres + Bun web |
| Managed cloud LLM cost (insight engine) | $0 default | BYO API key; optional |
| Managed cloud per-dev cost | <$3/mo at 10k scale | unit economics for paid SaaS |

**Trading money for time:** managed-cloud option = recurring revenue justifying ongoing maintenance; self-host = zero recurring cost for orgs that own their data.

### 1.4 Time to ship

| Milestone | Target | Scope |
|---|---|---|
| Phase 1 (collector + ingest spike) | Week 2 | Claude Code + Cursor + local Postgres, manager can see one chart |
| Phase 2 (multi-tool, all 6 IDEs) | Week 4 | Codex + OpenCode + Goose + Copilot output |
| Phase 3 (manager dashboard MVP) | Week 6 | leaderboard + cost-per-PR chart |
| Phase 4 (insight engine + prompt clusters) | Week 8 | "twin finder" + recommendations |
| Phase 5 (self-host packaging) | Week 10 | docker-compose + curl-installer |
| Phase 6 (managed cloud beta) | Week 14 | hosted version + auth + billing |
| OSS public launch | Week 16 | GitHub release + show HN + docs site |

(Calendar weeks from kickoff. Iteratively re-baseline at Phase 1 completion.)

### 1.5 Data sensitivity (CRITICAL)

**Tier system, default = Tier C (per user):**

| Tier | What ships off the dev machine | Default for | Rationale |
|---|---|---|---|
| **A — counts only** | Token counts, model, tool name, timing, file paths, derived metrics. **No prompt content, no diffs.** | Highly regulated orgs | Strictest privacy |
| **B — hashed prompts** | A + SHA-256 of prompt + first 200 chars + cluster ID + hashed file content | Orgs allowing pattern analytics | Lets us cluster "what prompts work" without leaking secrets |
| **C — full prompts (DEFAULT)** | A + B + full prompts + tool inputs/outputs + system prompts + sub-agent transcripts | All orgs **by default** | Maximum manager insight; safe because data stays in self-hosted org infra |

**Default Tier-C retention: 30 days** in the OSS template (down from initial 180d draft per Challenger E2 — long retention of full prompt text invites GDPR scrutiny). Orgs can extend explicitly. Tier-A retention managed via partition drops (not TTL — see §2.3 amendment).

**Per-org policy file** (`devmetrics.policy.yaml` in repo root, optionally signed) overrides per-repo and per-developer:

```yaml
version: 1
default_tier: C
overrides:
  - repo_glob: "**/proprietary-billing/**"
    tier: A
    redact:
      - "BEGIN PRIVATE KEY"
      - "AKIA[A-Z0-9]{16}"
  - developer_email: "alice@corp.com"
    tier: B   # alice opted out of full prompt egress
```

**Server-side secret redaction (LOCKED — amended per Challenger E5):** ingest server runs **TruffleHog + gitleaks community rule sets** against `prompt_text`, `tool_input`, `tool_output`, AND `raw_attrs` on every event before persist. Caught secrets are replaced with `<REDACTED:type:hash>` and increment `redaction_count UInt8` on the row. Rules ship server-side so they update without redeploying every dev's collector. (Built-in regex on the dev side is a *first-pass* defence; the source of truth is the server scan.)

**Why C-by-default works:** the deployment-default is self-host. Data never leaves the org's perimeter. Egress is a within-org policy choice, not a third-party data-share. Managed cloud users explicitly opt-in.

### 1.6 Team & skill

| Skill | Level | Impact |
|---|---|---|
| TypeScript | Expert | Lock in Bun + TS end-to-end |
| Bun | Comfortable | Use Bun-native APIs (fetch, SQL, `Bun.serve`) |
| Next.js | Expert | Next.js 16 standalone for dashboard |
| ClickHouse | Growing | Use ClickHouse Cloud SDK + drizzle-clickhouse if available, otherwise plain SQL via `@clickhouse/client` |
| OpenTelemetry | Comfortable | Bundle official OTel collector binary; don't reinvent |
| MCP | Expert (from pinakes) | Optional MCP server adapter for IDEs not covered by hooks |
| Bun Docker | Growing | Use official `oven/bun` image, multi-stage with `bun build --compile` |

### 1.7 Reliability & verification

| Concern | Requirement |
|---|---|
| Cost of wrong cost calculation | Medium — managers will distrust the tool. Pricing data must come from a versioned, auditable source (LiteLLM JSON, pinned). |
| Cost of leaking a prompt accidentally | High — single incident kills trust. Every Tier transition (C→A) must be reversible at view-time, not collection-time, so we can purge on demand. |
| Cost of dropping events | Low — analytics, not billing. ≤0.1% loss tolerable. |
| Audit log for "what left my machine" | Required at Tier C. Local SQLite "egress journal" the dev can `devmetrics audit` against. |
| Required human-in-loop | None at runtime; manager review of insights before acting on them is encouraged but not blocking. |

### 1.8 Evaluation criteria (self-defined since no external rubric)

| # | Criterion | Weight | Definition |
|---|---|---|---|
| E1 | **Time-to-first-insight** | High | <10 min from `curl install` on first machine to a useful chart in the manager dashboard |
| E2 | **Multi-IDE coverage** | High | Day-one support for Claude Code + Cursor + Codex + OpenCode + Goose + Copilot |
| E3 | **Manager-actionable insight quality** | High | Dashboard surfaces ≥3 novel insights per week per team that a manager would act on |
| E4 | **Self-host UX** | High | <30 min from `docker compose up` to live dashboard with first dev pushing data |
| E5 | **Privacy auditability** | High | Dev can see exactly what bytes left their machine (audit log + dry-run mode) |
| E6 | **Performance at 10k devs** | Medium | p95 dashboard <2s, p99 ingest <100ms, sustained 100 events/sec |
| E7 | **Code/architecture quality** | Medium | Test coverage >80%, OTel-conventions-compliant, contributable by community |
| E8 | **OSS adoption signal** | Medium (deferred) | 1k GitHub stars within 90 days of public launch |

---

## Loop 1.5 — Innovation Discovery

### 1.5.1 Brainstorm

| # | Innovation | Category | Effort | Impact | Class |
|---|---|---|---|---|---|
| I1 | **Prompt Twin Finder** — Given any session, surface the top-3 sessions across the org that solved a similar prompt with fewer tokens, side-by-side | Novel AI | M | **Critical** | **CORE** |
| I2 | **Cost-per-merged-PR** chart with Git correlation | Domain | M | **Critical** | **CORE** |
| I3 | **One-line cross-IDE installer** — `curl -fsSL devmetrics.sh \| sh` detects every IDE installed and configures all of them | UX | L | High | **CORE** |
| I4 | **Privacy audit log** — local SQLite "egress journal"; `devmetrics audit --tail` shows exactly what shipped, ever | Production | L | High | **CORE** |
| I5 | **Efficiency leaderboard** ranked by tokens-per-merged-PR (not raw output — anti-gamification) | UX | L | High | **CORE** |
| I6 | **Live wall mode** — full-screen real-time SSE feed of team activity (great for war rooms / demos) | UX | L | Medium | **STRETCH** |
| I7 | **Model-routing recommendations** — "you used Opus for 80% of trivial tasks; switching to Haiku saves $X" | Data | M | High | **CORE** |
| I8 | **Anomaly alerts** — Slack DM when a dev's per-session token spend deviates 3σ from their baseline | Production | M | High | **STRETCH** |
| I9 | **Manager 1:1 prep doc** — auto-generated weekly per-developer markdown with talking points | UX | M | High | **STRETCH** |
| I10 | **Session replay** — scrub-bar timeline of any session showing each turn + tools + tokens | Demo polish | H | Medium | **STRETCH** |
| I11 | **Embedding-based work classification** — replaces codeburn's hand-rolled 13-category heuristic with prompt-embedding clusters | Domain | M | Medium | **CORE** |
| I12 | **Dual-flavor self-host**: heavy Docker Compose (ClickHouse) for orgs >100 devs, single-binary (DuckDB+SQLite) for ≤20 devs | Production | M | High | **CORE** |
| I13 | **Tool-call-waste detector** — same file Read 5× in one session, expensive Grep that should've been a glob, etc. | Data | M | Medium | **STRETCH** |
| I14 | **Eat-our-own-dogfood** — DevMetrics instruments itself; the dev team's own metrics show on the platform | Demo polish | L | Medium | **CORE** |
| I15 | **Repo-relative benchmarking** — "your bug-fix sessions in `payments/` are 1.4× more expensive than the org median for similar repos" | Domain | H | High | **STRETCH** |

### 1.5.2 Classification rationale

**CORE** (must ship for the wedge to be defensible vs codeburn/tokscale): I1, I2, I3, I4, I5, I7, I11, I12, I14
**STRETCH** (built if time permits, assigned to Phase 4–6): I6, I8, I9, I10, I13, I15
**CUT (now):** none — every brainstormed innovation is at least STRETCH

> Every CORE innovation MUST appear in a specific phase in Loop 4.

---

## Loop 2 — Architecture Decisions

### 2.1 Core architecture pattern

**Locked:** Distributed-collector → centralized-ingest → analytical store + control-plane → dashboard.

```
+----------------+      +----------------+      +-------------+       +-----------+
| Dev machine    |      | Ingest server  |      | Postgres    |       | Next.js   |
|                |      | (Bun + OTel    |      | (control)   |<----->| Dashboard |
| - Hooks        | OTLP |  Collector     |      |             |       |           |
| - File watcher |----->| sidecar)       |----->+-------------+       +-----------+
| - MCP adapter  | HTTPS|                |             ^                    ^
|                |      |                |             |                    |
| Local SQLite   |      |                |      +-------------+             |
| (egress queue) |      |                |----->| ClickHouse  |<------------+
+----------------+      +----------------+      | (events)    |  read-only
        ^                                       +-------------+
        |
   PgBoss (optional Git poller)
```

Rationale: matches Langfuse's proven pattern (Postgres for control plane, ClickHouse for events), but Bun-native and tuned for coding-agent telemetry shape.

### 2.2 Tech stack (LOCKED)

| Layer | Choice | Alts considered | Why | Validation |
|---|---|---|---|---|
| Runtime (server) | **Bun ≥1.2.x** | Node 24, Deno | Locked by user; `Bun.serve`, `Bun.sql`, native fetch, fastest startup, single-binary `bun build --compile` | User pref + bun.sh perf benchmarks |
| Runtime (collector) | **Bun (compiled binary via `bun build --compile`)** | Node, Rust, Go | Single language across stack; Bun compiles to single binary so collector ships with no Node dep | Bun.sh docs |
| Web framework | **Next.js 16 (App Router, `output: 'standalone'`)** | Remix, Astro, SvelteKit | Locked by user; standalone Docker output | User pref |
| UI components | **shadcn/ui + Tailwind v4** | Mantine, Tremor-only | shadcn = ownable code; Tremor blocks for chart compositions | shadcn-ui.com |
| Charts | **Tremor v3 + Recharts (under the hood)** | visx, Apache ECharts, Plotly | Tremor's analytics-tuned chart components; Recharts is well-known and small | tremor.so |
| Tables | **TanStack Table v8 (virtualized)** | AG Grid, Material React Table | OSS, headless, perfect for 10k-row dashboards | tanstack.com |
| Motion | **motion (formerly Framer Motion)** | tailwind-css transitions only | Used in demo-polish features (replay scrubber, leaderboard transitions) | motion.dev |
| Realtime | **Server-Sent Events (SSE)** | WebSocket, polling, Pusher | One-directional fits dashboard live feed; trivially scales to 10k connections per Bun node | bun.sh/docs/api/http |
| Control DB | **PostgreSQL 16** | MySQL, SQLite | Mature; org/user/policy/auth lives here; tx semantics matter | postgres.org |
| Event DB | **ClickHouse 25** | Postgres+TimescaleDB, DuckDB-as-server, Druid | Best-in-class OLAP, proven at Langfuse for same workload, cheap at 10k devs scale | clickhouse.com |
| Embedded mode DB | **Single-container Postgres + Timescale extension** (NOT DuckDB) | DuckDB+SQLite (rejected — single-writer contention, see Challenger A4) | One Postgres process, well-understood; scales to ≤50 devs in embedded mode (was ≤20 with DuckDB plan; revised UP because single-process Postgres is sturdier) | timescale.com |
| ORM (Postgres) | **Drizzle ORM** | Prisma, raw SQL | Same as pinakes, Bun-friendly, type-safe migrations | orm.drizzle.team |
| Client (ClickHouse) | **`@clickhouse/client` (HTTP) + plain SQL**, with **24h soak test in CI before locking**; Plan B = tiny Go side-car for hot path if Bun↔CH proves flaky | Drizzle (no CH dialect), Waddler (new) | Bun's ClickHouse story is rough (open bun#26138; chDB-Bun experimental). Pin client; have Plan B documented. (Amended per Challenger A1/B1) | clickhouse.com |
| Cache / rate limit | **Redis 7 (Valkey 8 fallback)** | KeyDB, Bun-native KV | Standard; we keep deps minimal (only Redis when cache needed) | valkey.io |
| Async jobs (crons only) | **PgBoss** for low-frequency scheduled jobs (LiteLLM refresh, GitHub backfill, weekly digest, partition drops, GDPR erasure) | BullMQ on Redis | Per-event downstream work goes to ClickHouse MV or Redis stream — NOT PgBoss. (Amended per Challenger A2/B3) | github.com/timgit/pg-boss |
| Per-event jobs | **ClickHouse Materialized View** (cluster assignment) + **Redis stream** (anomaly trigger fan-out) | PgBoss per-event | Avoids 800k+ PgBoss enqueues/day at 8M event/day workload | redis.io/docs/data-types/streams |
| OTel collector | **Optional sidecar** in default deploy; Bun ingest speaks OTLP HTTP/Protobuf natively | Always-on collector | Removes a container from default self-host (helps E4 30-min target). Orgs that want collector batching can enable it. (Amended per Challenger B4) | opentelemetry.io |
| Auth | **Better Auth** | Auth.js / NextAuth, Clerk, WorkOS | OSS, Bun-friendly, native orgs/teams/RBAC, extensible | better-auth.com |
| Embedding model | **Provider-abstracted (`packages/embed`)**: default = **OpenAI `text-embedding-3-small` @ 512d (Matryoshka-truncated)** via BYO key; opt-in upgrade = **Voyage-3** (code-trained, BYO); air-gapped fallback = **`nomic-embed-text` via Ollama** if detected, else bundled **Xenova MiniLM-L6** | All-local-only | OpenAI default chosen because Twin Finder + cluster quality is the manager-facing wow; cost ~$5/mo (100 devs) → ~$250/mo (10k devs) with batched dedup; org owns key + bill on self-host. (Amended 2026-04-16 per user direction "service after capstone — decent model OK".) | platform.openai.com/docs/guides/embeddings |
| Embedding cache | **Postgres table** `embedding_cache(prompt_hash PK, model, dim, vector, created_at, hit_count)` + Redis L1 LRU | per-event recompute | 80%+ cache hit on coding prompts (boilerplate repeats); critical for cost control | — |
| Insight LLM (managed cloud) | **Anthropic Claude Haiku 4.5** | Sonnet, GPT-5 | Fast + cheap; clear win for summarization-style insight generation | docs.anthropic.com |
| Pricing data | **LiteLLM `model_prices_and_context_window.json`** | Hand-curated | Community-maintained, covers all providers, versioned | github.com/BerriAI/litellm |
| Logging | **pino** | winston, console | Same as pinakes, structured JSON, Bun-fast | github.com/pinojs/pino |
| Testing | **Bun's built-in `bun test`** | Vitest, Jest | Bun-native, fast | bun.sh/docs/cli/test |
| E2E testing | **Playwright** | Cypress | Better Bun support, multi-browser | playwright.dev |
| Lint/format | **Biome** | ESLint+Prettier | Bun-fast, single tool | biomejs.dev |
| Container | **`oven/bun:1.2-alpine`** + multi-stage | node, distroless | Tiny final image (~80MB), Bun official | hub.docker.com/r/oven/bun |
| CI | **GitHub Actions** | Buildkite, Circle | Standard for OSS; free for public repos | github.com |

> **Do not add new dependencies without justification.** Every new dep needs a sentence in §2.2.

### 2.3 Data architecture

**OTel-aligned event model.** All ingest events shaped to `gen_ai.*` semantic conventions plus `dev_metrics.*` extensions for IDE/repo/git/dev attribution.

#### ClickHouse `events` table (POST-CHALLENGER amendments locked)

```sql
CREATE TABLE events (
  -- attribution
  org_id            UUID,
  dev_id            UUID,
  repo_id           UUID NULL,
  branch            LowCardinality(String) NULL,        -- amended C3
  pr_number         Nullable(UInt32),                   -- amended C3 (denormalized for fast joins)
  commit_sha        Nullable(FixedString(40)),          -- amended C3
  session_id        String,
  turn_id           String,
  parent_turn_id    Nullable(String),
  client_event_id   UUID,                               -- amended A3 (idempotency key, ReplacingMergeTree dedup)
  schema_version    UInt8,                              -- amended C3 (track wire-format version)
  ide               Enum8('claude-code'=1,'cursor'=2,'codex'=3,'opencode'=4,'goose'=5,'copilot'=6,'other'=99),
  -- 'pi' enum value REMOVED per Challenger D — Pi cut from MVP
  ts                DateTime64(3),
  -- gen_ai.* (OTel)
  operation         Enum8('chat'=1,'execute_tool'=2,'invoke_agent'=3,'embeddings'=4,'completion'=5),
  provider          LowCardinality(String),
  model_request     LowCardinality(String),
  model_response    LowCardinality(String),
  input_tokens      UInt32,
  output_tokens     UInt32,
  cache_read_tokens UInt32 DEFAULT 0,
  cache_write_tokens UInt32 DEFAULT 0,
  reasoning_tokens  UInt32 DEFAULT 0,
  finish_reason     Nullable(String),
  duration_ms       UInt32,
  cost_usd_micro    UInt64,
  cost_estimated    Bool DEFAULT false,                 -- amended D (Cursor Auto-mode flag)
  -- coding-agent extension
  tool_name         Nullable(String),
  tool_status       Nullable(Enum8('ok'=1,'error'=2,'denied'=3)),
  exit_code         Nullable(Int32),                    -- amended C3
  error_message_hash Nullable(FixedString(32)),         -- amended C3
  cwd_hash          LowCardinality(FixedString(16)),    -- amended C5 (was String — saves ~30% per row)
  files_touched     UInt16,
  -- privacy tier
  tier              Enum8('A'=1,'B'=2,'C'=3),
  redaction_count   UInt8 DEFAULT 0,                    -- amended E5 (count of secrets server-redacted)
  -- payload (Tier B/C only; Tier A enforced by ingest write-time validator + raw_attrs allowlist)
  prompt_text       Nullable(String) CODEC(ZSTD(3)),
  prompt_hash       FixedString(32) NULL,
  prompt_cluster_id Nullable(UInt32),
  tool_input        Nullable(String) CODEC(ZSTD(3)),
  tool_output       Nullable(String) CODEC(ZSTD(3)),
  raw_attrs         String CODEC(ZSTD(3))               -- ingest filters this through allowlist for Tier A (amended C4)
)
ENGINE = ReplacingMergeTree(client_event_id)            -- amended A3 (idempotency)
PARTITION BY (toYYYYMM(ts), cityHash64(org_id) % 16)    -- amended C6 (tenant isolation for GDPR drops)
ORDER BY (org_id, ts, dev_id)                           -- amended C2 (matches 3 of 4 headline queries)
PROJECTION p_repo (SELECT * ORDER BY (org_id, repo_id, ts)),         -- amended C2
PROJECTION p_cluster (SELECT * ORDER BY (org_id, prompt_cluster_id, ts)),
PROJECTION p_dev (SELECT * ORDER BY (org_id, dev_id, ts))
TTL ts + INTERVAL 30 DAY DELETE WHERE tier = 'C',       -- amended E2 (was 180d; OSS default; orgs can extend)
    ts + INTERVAL 90 DAY DELETE WHERE tier = 'B';
-- Tier-A retention: NOT via TTL. Use weekly cron to ALTER TABLE DROP PARTITION
-- for any (yyyymm, bucket) older than 90 days where partition contains only tier='A' rows.
-- See §3.1 F10b for the partition-drop worker spec. (BLOCKER C1 fix)

-- Materialized rollups (unchanged structure, ride on amended events table)
CREATE MATERIALIZED VIEW dev_daily_rollup ENGINE = SummingMergeTree
ORDER BY (org_id, dev_id, day, model_request) AS
SELECT org_id, dev_id, toDate(ts) AS day, model_request,
  sum(input_tokens) AS in_t, sum(output_tokens) AS out_t,
  sum(cache_read_tokens) AS cache_r, sum(cost_usd_micro) AS cost_um,
  count() AS evt_n FROM events GROUP BY org_id, dev_id, day, model_request;

CREATE MATERIALIZED VIEW prompt_cluster_stats ENGINE = AggregatingMergeTree
ORDER BY (org_id, prompt_cluster_id, day) AS
SELECT org_id, prompt_cluster_id, toDate(ts) AS day,
  sumState(input_tokens + output_tokens) AS tokens_state,
  sumState(cost_usd_micro) AS cost_state,
  countState() AS uses_state FROM events
  WHERE prompt_cluster_id IS NOT NULL
  GROUP BY org_id, prompt_cluster_id, day;

-- New: cluster-id assignment via MV (amended A2 — moves per-event work off PgBoss)
CREATE MATERIALIZED VIEW cluster_assignment_mv ENGINE = ReplacingMergeTree
ORDER BY (client_event_id) POPULATE AS
SELECT client_event_id, org_id,
  -- assign by nearest-centroid cosine in app layer pre-insert (clusterer worker writes the row);
  -- this MV materializes the join for fast lookup
  prompt_cluster_id FROM events WHERE prompt_hash IS NOT NULL;

-- New: repo-aggregated MV for /repos page (amended C2 — replaces a runtime join)
CREATE MATERIALIZED VIEW repo_weekly_rollup ENGINE = SummingMergeTree
ORDER BY (org_id, repo_id, week, branch) AS
SELECT org_id, repo_id, toMonday(toDate(ts)) AS week, branch,
  sum(input_tokens + output_tokens) AS tokens, sum(cost_usd_micro) AS cost_um,
  uniq(pr_number) AS prs_touched, count() AS evt_n
  FROM events WHERE repo_id IS NOT NULL
  GROUP BY org_id, repo_id, week, branch;
```

#### Postgres tables (control plane)

```
orgs(id, name, plan, created_at)
users(id, org_id, email, role, …)                -- role: dev | manager | admin
developers(id, org_id, user_id, machine_ids[])   -- one user → many machines
repos(id, org_id, name, github_id, default_branch)
policies(id, org_id, version, yaml_blob, signed_by, signature)
git_events(id, org_id, repo_id, dev_id, type, sha, pr_number, lines_added, lines_deleted, ts)
ingest_keys(id, org_id, dev_id, hashed_token, last_seen, scopes)
prompt_clusters(id, org_id, centroid_embedding, label, exemplar_prompt_id, n_members)
audit_log(id, org_id, actor, action, target, ts, details_json)
```

#### State machine — session lifecycle (per IDE session)

`new` → `active` → (`compacting` → `active`)\* → `idle` → `ended`

- `new` → `active`: first event of session received
- `active` → `compacting`: PreCompact event (Claude Code only)
- `idle`: 5-min no-event timeout; eligible for derivation (turn boundary cleanup, cluster assignment)
- `ended`: SessionEnd event OR 24h idle

### 2.4 Service topology

| Service | Port | Role | Why separate? |
|---|---|---|---|
| `web` (Bun + Next.js standalone) | 3000 | Manager dashboard + REST/tRPC API + SSE feed | Public-facing; auth-gated |
| `ingest` (Bun) | 4318 (OTLP HTTP), 4317 (OTLP gRPC), 8000 (custom JSON) | Receives events from collectors | Separate scaling profile from web; usually behind LB |
| `otel-collector` (sidecar) | 4317/4318 | Buffers + batches + retries OTel from clients before our ingest | Battery-tested batching, frees us from reinventing OTLP |
| `worker` (Bun) | — | PgBoss workers: prompt clustering, cost recompute, anomaly detection, Slack digest | CPU-heavy work; horizontal-scalable |
| `clusterer` (Bun) | — | Specialized worker: embedding generation + HDBSCAN clustering of prompts | Single-threaded GPU/CPU bottleneck; isolate |
| `clickhouse` | 8123 | Event store | OLAP workload; never on web's CPU |
| `postgres` | 5432 | Control plane | OLTP; small dataset |
| `redis` | 6379 | Cache + rate limit; SSE pubsub fan-out | Optional in tiny mode |
| `caddy` (optional) | 80/443 | TLS termination + auto-cert for self-host UX | Skipped in cloud-prod where ALB does TLS |

**Embedded mode (≤20 devs):** single Bun binary embeds web + ingest + worker; uses DuckDB (events) + SQLite (control); no Redis (in-process LRU); no Caddy. Spawn with `devmetrics serve --embedded`.

### 2.5 API & integration design

**Three ingest endpoints:**

1. **OTLP HTTP/Protobuf** (`POST /v1/{traces,metrics,logs}`) — for Claude Code's native exporter and any OTel-shaped client.
2. **Custom JSON** (`POST /v1/events`) — for our own collector + non-OTel data (Git, Cursor SQLite snapshots).
3. **Webhooks** (`POST /v1/webhooks/{github,gitlab,bitbucket}`) — for PR-merge events.

**Auth:** ingest keys are scoped per-org per-dev. Header `Authorization: Bearer dm_<orgId>_<rand>`. Rate-limited via Redis token bucket: 1k events/sec per dev sustained, 10k burst.

**Manager-side API:** tRPC over HTTP/SSE. Schemas in shared `packages/api`.

**External APIs (read-only):**
- LiteLLM pricing JSON (cron refresh every 6h)
- GitHub/GitLab/Bitbucket REST (PR/commit metadata; webhooks primary, REST as backfill)
- Anthropic API (managed-cloud insight generation; BYO key)

### 2.6 Frontend architecture

- Next.js 16 App Router, React Server Components for shell + heavy charts
- Client components for SSE feed, replay scrubber, table interactions
- Routes: `/`, `/login`, `/dashboard` (default), `/team`, `/team/:devId`, `/sessions/:id`, `/repos/:id`, `/clusters`, `/wall`, `/settings/{policy,billing,api-keys,members}`, `/audit`
- Layout: shadcn `Sidebar` + `Tabs`; dark by default; brand-tunable via `brand.config.ts`
- Data fetching: tRPC v11 with React Query; SSE for the wall + per-page live indicator
- Auth: Better Auth session cookie; org switcher in header
- A11y: WCAG AA targets; all charts have a "view as table" toggle

### 2.7 AI / agent architecture

**Two AI surfaces:**

1. **Prompt embedder + clusterer:** provider-abstracted via `packages/embed`. Default = **OpenAI `text-embedding-3-small` @ 512d (Matryoshka)**, BYO API key per org. Embeddings computed **server-side at ingest** (was previously collector-side; moved per amendment). Hot-path Twin Finder hits live API; nightly HDBSCAN re-cluster uses **OpenAI Batch API for 50% discount**. **Embedding cache** keyed on `prompt_hash` (Postgres + Redis L1 LRU) gives ~80% hit rate on real coding prompts. Fallback chain: Voyage-3 (BYO upgrade for code-heavy orgs) → `nomic-embed-text` via Ollama (if detected) → Xenova MiniLM-L6 bundled (air-gapped final fallback).

   **Privacy implication:** at Tier B+, this means *prompt text reaches our server AND the configured embedding provider* (OpenAI by default). Tier A skips embedding entirely. DPA + privacy doc must call this out explicitly. Air-gapped orgs (regulated industries) configure provider=ollama or provider=xenova, never leave their perimeter.

2. **Manager Insight Engine (BYO key, opt-in):** weekly background job. Pulls last-7d aggregates per team, sends to Claude Haiku 4.5 with a structured prompt; result is a markdown digest with: top 3 insights, top 3 efficiency wins, top 3 anomalies, and 3 coaching suggestions. Cached.

**Decomposed Insight Pipeline (LOCKED — amended per Challenger §G):**

The naive single-shot template was rejected. Replaced with a 4-call decomposed pipeline + retrieval grounding + self-check.

```
WEEKLY DIGEST PIPELINE (per team, every Monday 9am team-local):

1. SQL pre-compute (no LLM): retrieve top-5 efficiency winners, bottom-5 efficiency
   concerns, top-10 prompt clusters by PR-merge correlation, all anomalies of last week.
   Output: a structured aggregates blob with EXPLICIT ENUMS of valid IDs the LLM may cite.

2. efficiency_winner_call(aggregates, candidate_dev_ids[5])
   → Haiku 4.5 picks 1, must cite a dev_id from the enum. ~80 words. ~$0.001.

3. efficiency_concern_call(aggregates, candidate_dev_ids[5], excluded={winner.dev_id})
   → Haiku 4.5 picks 1 from a different dev. ~80 words.

4. prompt_pattern_call(top_clusters)
   → Haiku 4.5 picks 1 cluster, exemplar prompts pre-attached. Must cite cluster_id.

5. coaching_action_call(joined_a_b_c)
   → Haiku 4.5 produces 3 concrete coaching messages tied to (1)-(3).

6. self_check_call(aggregates, generated_insight)
   → Haiku 4.5 verifies: do all cited numbers match the aggregates? Y/N + corrections.
   → If N: regenerate the failing call once. If still N: drop the insight from digest.

7. Confidence scoring: each insight tagged High/Med/Low. Only High shown by default;
   Med shown as "investigate"; Low never shown. (Promoted from Stretch to Must per
   Challenger I/§2.10.)

ANOMALY ALERTS — separate hourly job:
  Cron every hour: scan last 60 min for any dev exceeding 3σ on token/cost/error_rate.
  Format alert via single small Haiku call; emit to Slack/Discord/email.
  Don't make managers wait a week for "junior dev burned $400 on infinite loops" insight.
```

**Verification (LOCKED amendments per Challenger §2.10):**
1. Citation grounding via *constrained ID enums in the prompt itself* — model can only emit IDs from the supplied list. Validator becomes a sanity-check, not a gate.
2. Numerical fact-check via the dedicated self-check pass (step 6 above).
3. Prompt-injection envelope `<user_data>…</user_data>` + system prompt hardened.
4. Confidence threshold MUST (was Stretch).
5. Eval suite includes **adversarial scenarios** (e.g., a dev with 10× tokens but who is the only one solving infra incidents — the model must NOT mark them as "inefficient").

### 2.8 Observability strategy

**Eat-our-own-dogfood:**
- DevMetrics ingest, web, worker all emit OTel spans into our own ClickHouse via the same pipeline
- "/system" page in dashboard shows internal SLOs to admins
- Logs: pino → stderr → docker → loki (optional) or just `docker logs`
- Metrics dashboards: ingest rate, queue depth, ClickHouse query p95, dev machine count, dropped event count

### 2.9 Evaluation & testing strategy

| Layer | Framework | Min coverage / count |
|---|---|---|
| Unit | `bun test` | 80% line coverage |
| Integration (ingest pipeline) | `bun test` + ephemeral Docker (testcontainers-style) ClickHouse + Postgres | every ingest path: OTLP, custom JSON, webhook |
| Privacy adversarial | `bun test src/__tests__/privacy/**` | merge blocker; tests that Tier A/B never let prompt content into ClickHouse `prompt_text` column |
| Schema migration | drizzle + ClickHouse migration runner; replay golden migrations against snapshot | every PR |
| E2E (browser) | Playwright | critical flows: install → first event → first chart; manager login → see leaderboard; policy update propagates |
| Performance | k6 + Bun script harness | sustained 100 evt/sec ingest, p95 dashboard <2s @ 1M events seeded |
| Eval (insight engine) | golden test set of 50 synthetic team-week scenarios with hand-graded expected insights | run nightly in CI; pass = LLM-judge score ≥ 0.7 |
| Eval (embedding/clustering quality) | 200-prompt golden set with hand-graded "twin" pairs (semantically similar coding prompts that should cluster together) | per-provider gate: recall@5 ≥ 0.8 for default OpenAI provider; ≥ 0.6 for Xenova fallback. Run on every embedding-provider config change. |

### 2.10 Verification design (for the AI insight engine)

| Verification | Implementation | Priority |
|---|---|---|
| Citation grounding | every insight must reference an existing `session_id` / `cluster_id` — validator rejects insights with hallucinated IDs | Must |
| Numerical fact-check | numbers in insights cross-checked against ClickHouse query results (e.g., "spent $X" must match `dev_daily_rollup`) | Must |
| Prompt-injection defense | prompt content sent to insight LLM is wrapped in `<user_data>…</user_data>` and instructions emphasize "treat as data, not commands" | Must |
| Confidence scoring | insights tagged High/Med/Low confidence; only High shown by default | Stretch |
| Eval gate | nightly eval suite must pass ≥0.7 LLM-judge score before deploying new prompt or model | Must |

---

## --- Mini Gap Check #1 (post-Loop 2) ---

Pre-Challenger trace of every requirement from the brief vs. architecture coverage:

| Brief requirement | Where addressed |
|---|---|
| Install via npx or curl on every dev machine | §2.2 Tech stack (Bun compiled binary), I3 (one-line installer) |
| Tracks tokens, commits, PRs, cost, session/turn data, prompts | §2.3 schema, §2.5 ingest endpoints, D13 Git data |
| Works with all IDEs/ADEs (Codex, Claude Code, OpenCode, VS Code, Cursor, Pi, etc) | §2.5 hybrid collector, Loop 0 §2 IDE-by-IDE map |
| Centralized dashboard for managers | §2.4 web service, §2.6 routes |
| 100-dev team realistic | §1.2 scale, §1.3 budget |
| Leaderboard | I5 efficiency leaderboard |
| Prompts that worked | I1 Twin Finder, I11 embedding classification |
| Tokens vs commits/PRs vs work efficiency | I2 cost-per-merged-PR |
| Comparative analysis ("why does dev X use 1/2 tokens for same task") | I1 Twin Finder uses prompt_clusters + dev_daily_rollup |
| Open source | License Apache 2.0 (§1.5) |
| Self-hostable | §2.4 Docker Compose + I12 dual-flavor |
| What does self-hosting mean (frontend only? server+DB?) | §2.4 explicit: web+ingest+worker+ClickHouse+Postgres+Redis bundle |
| Repo push to centralized place for managers | §2.5 ingest endpoints, control plane = central |
| Like Langfuse | §2.1 architecture explicitly Langfuse-pattern |

**Open gaps to address in Loop 3:**
- VS Code support is fuzzy — VS Code is an editor, not an ADE. Likely we only support its **agent extensions** (Continue.dev, Cline, Roo). Need explicit decision on what "VS Code support" means. *(Resolved Loop 6 §6.2: VS Code defined as "agent extensions only".)*
- Pi is barely-documented; risk of N/A in MVP — flag in Loop 6. *(Resolved Loop 6 §6.2: Pi CUT for v1.)*
- Failure-mode analysis still pending. *(Resolved Loop 3 §3.1.)*
- Cost projection at 10k devs not yet enumerated. *(Resolved Loop 3 §3.4 + Loop 6 patch P19.)*

---

## Loop 3 — Refinement & Stress Test

### 3.1 Failure mode analysis

| # | Failure mode | Impact | Designed mitigation |
|---|---|---|---|
| F1 | Local daemon crashes mid-session | Lose events for that session | Write all events to local SQLite "egress journal" first; daemon restart drains journal. PgBoss-equivalent on the dev side: durable queue. |
| F2 | Dev machine offline for hours/days | Backlog grows | SQLite egress journal capped at 500MB rolling; oldest dropped first; warn dev via menu-bar icon if >24h backlog |
| F3 | Ingest server unreachable | Same as F2 | Exponential backoff with jitter, cap at 5 min. Egress journal absorbs. OTel collector sidecar handles batching+retry natively for OTLP path. |
| F4 | ClickHouse outage | Ingest accepts but cannot persist | Ingest server writes raw events to S3-compatible bucket (or local disk in self-host); replay job catches up when CH back. Postgres queue table tracks failed writes. |
| F5 | Postgres outage | Auth + dashboard down, ingest works (writes to CH only via service token) | Ingest path independent of Postgres after token cache warm; dashboard returns 503 with status page |
| F6 | Schema drift across IDE versions (e.g., Codex changes JSONL format) | Some events fail to parse | Per-IDE adapter is versioned; unknown fields preserved in `raw_attrs`; `dev_metrics_parser_failures` metric alerts; gracefully degrade rather than drop |
| F7 | Claude Code OTel exporter format changes | Hot-path break | Pin to OTel GenAI semconv version; integration test against `latest`+`previous` Claude Code in CI weekly |
| F8 | Prompt injection via prompt content arriving at Insight Engine | LLM may emit attacker-controlled "insight" | Wrap user data in `<user_data>` envelope; system prompt hardened; output validator checks all cited IDs exist; never auto-execute insight content |
| F9 | Manager exports dashboard view → external service | Tier C data leaves intended boundary | Audit log records every export; admin-policy can restrict export domains; watermark exports; opt-in CSV redaction |
| F10 | Always-redact regex misses a new secret format | Real secret in prompt_text | Server-side TruffleHog + gitleaks ruleset on every event (amended E5); Tier-B/C data encrypted at rest with org-held key; per-row `purge` API to delete by session/dev/repo |
| F10b | Tier-A 90d retention silently never runs (BLOCKER C1) | Privacy violation if regulator audits | Weekly partition-drop worker (PgBoss cron): `ALTER TABLE events DROP PARTITION` for any `(yyyymm, bucket)` where `min(ts) < now()-90d` AND every row in partition has `tier='A'`. Reliable physical delete, not async mutation. |
| F10c | Bun process crash dump leaks in-memory prompt even at Tier A | Privacy violation via core dump | `ulimit -c 0` + `RLIMIT_CORE=0` set in Dockerfile entrypoint and Bun startup; `devmetrics doctor` checks; documented in self-host hardening guide |
| F10d | Manager exports CSV with prompt_text → personal cloud sync | Tier-C data leaves intended boundary | "Reveal" gesture required for any prompt_text view + audit_log entry; CSV exports redact prompt columns by default; "Export with prompts" requires 2FA + audit log |
| F10e | Managed-cloud accidentally accepts Tier-C events from non-opted-in org | Cross-tenant policy violation | Managed-cloud ingest endpoint server-side rejects Tier-C events with HTTP 403 unless `org.tier_c_managed_cloud_optin=true` in billing record. Client policy file is NOT the security boundary. |
| F11 | Concurrent collectors on same machine (dev opens 3 IDEs at once) | Duplicated events | Dedup at ingest by `(session_id, turn_id, ts)` key; ClickHouse `ReplacingMergeTree` for events table OR pre-ingest dedup |
| F12 | Cursor SQLite poll fights with Cursor's own writer | Locked DB / corrupt read | Use `PRAGMA query_only`; open with `mode=ro`; copy-and-read pattern for safety |
| F13 | OpenCode JSON format → SQLite migration | All adapters break overnight | Adapter detects format; dual-mode reader; integration test pinned to both formats |
| F14 | Claude Code hooks block on slow daemon | Bad UX, dev disables hooks | All hooks fire-and-forget over UNIX socket to local daemon; <10ms hook overhead; if daemon socket unreachable, hook exits 0 silently |
| F15 | Insight LLM rate-limit hits | Manager weekly digest fails | Queue + retry; serve last-good digest; per-org quota tracking |
| F16 | Cost calculation drifts from reality | Manager loses trust | Pricing JSON pinned per-deployment; show "data-as-of" date; reconcile against real provider invoice via uploaded CSV optional |
| F17 | Prompt cluster centroid drift on new data | Old "twin finder" results stale | Nightly re-cluster; cluster IDs versioned; UI shows cluster age |
| F18 | New developer joins, no baseline | Anomaly detection useless for them | "Cohort baseline" mode: compare to org median for first 4 weeks instead of personal baseline |
| F19 | One bad PR with massive token spike (e.g. eval run) skews leaderboard | Ranking becomes meaningless | Trim per-session outliers (winsorize at p95); show median + p95 separately |
| F20 | Self-host upgrade breaks DB schema | Org dashboard down for hours | Reversible drizzle migrations; ClickHouse migrations idempotent; `devmetrics upgrade --dry-run` shows planned changes |

**"Designed?" check:** every row above has a concrete mitigation, not "we'll handle it." Loop 6 will re-verify.

### 3.2 Security model

| Surface | Threat | Defense |
|---|---|---|
| Daemon install (PRIMARY: distro packages; `curl \| sh` fallback) | MITM, Shai-Hulud-class supply-chain attack on Bun runtime, domain hijack | (BLOCKER H fix — all REQUIRED for v1): **(1) Sigstore-signed releases** + cosign verification step shown prominently in install docs; default install is `gh release download` + `cosign verify`, NOT curl\|sh. **(2) SLSA Level 3 build provenance** via GitHub Actions reusable workflow. **(3) Reproducible builds** — anyone can `bun build --compile` and get the same SHA256. **(4) Distro packages PRIMARY:** Homebrew (Mac), apt/deb (Debian/Ubuntu), AUR (Arch); curl\|sh is the *fallback*. **(5) Wrap install script in a function** so partial-pipe execution fails closed. **(6) Egress-allowlist mode:** collector binary supports `--ingest-only-to <hostname>` with cert pinning. **(7) Audit + dry-run as DEFAULT first run.** **(8) In-app verification:** dashboard shows per-dev binary SHA256; alerts on non-canonical binary. |
| Daemon-on-machine | Reads every prompt; could exfiltrate | Daemon binary is open-source + reproducible-build; no network egress except configured ingest endpoint; egress endpoint is checksum-verified per-deploy; audit log of every byte sent |
| Ingest API | Unauthenticated event injection / abuse | Bearer token per (org, dev); rate-limited; signed URLs not used (tokens rotate); replay protection via `(session_id, turn_id, ts)` dedup; HMAC body signing optional |
| Manager dashboard | Account takeover → all org data | Better Auth: SSO (OIDC, SAML for paid tier), 2FA, session timeout; RBAC dev/manager/admin; audit log of every privileged action |
| Multi-tenancy | Cross-org data leak via SQL injection / app bug | Postgres RLS on control plane; ClickHouse queries always parameterized; `org_id` filter in every query enforced at ORM layer with type-system check; integration tests assert "row counts per org match expected after seeding" |
| Insight LLM | Prompt injection from collected data → fake insights | `<user_data>` envelope; output validator rejects insights that don't cite a real session_id from query results; LLM-judge eval gate |
| Self-hosted secret leakage | Customer accidentally commits `devmetrics.policy.yaml` with secret | YAML schema doesn't accept secrets; secret-pattern scan in CLI before publish |
| Backup data | Backup blob includes Tier C prompts | Backup is encrypted at rest with org-held key; key rotation supported; restore requires same key |
| Insider abuse (manager → dev) | Manager spies on dev's personal-time prompts | Working-hours filter optional; per-developer "private mode" toggle that blocks Tier C upload during specific hours; transparency: dev sees what manager sees |

### 3.3 Performance optimization plan

| Layer | Optimization | Expected gain |
|---|---|---|
| Ingest | OTel collector batching (1k events / 1s window) | 50× fewer ClickHouse writes |
| Ingest | Bun `Bun.serve` with prefork on N CPUs | Linear ingest throughput |
| ClickHouse | `MergeTree` partition by day, ORDER BY (org_id, dev_id, ts) | Most queries hit a single partition |
| ClickHouse | Materialized rollups (`dev_daily_rollup`) | Dashboard queries hit pre-aggregated MVs, p95 <500ms |
| ClickHouse | ZSTD(3) on prompt/tool blobs | ~5× smaller storage |
| Dashboard | RSC for shell + chart skeletons; client islands for interactivity | TTFB <500ms |
| Dashboard | tRPC + React Query stale-while-revalidate | Instant nav after first visit |
| Insight engine | Anthropic prompt-caching for system prompt + last-week aggregates | 90% cost reduction on weekly digests |
| Insight engine | Haiku 4.5 default; only escalate to Sonnet for complex multi-team rollups | Cost-tiered routing |
| Worker | PgBoss with 8 concurrent workers per node | Saturates CPU without thread-thrash |
| Embedding (default) | OpenAI `text-embedding-3-small` @ 512d, batched 100/req, dedup-cached | ~5k prompts/sec ingest equivalent (cache hit) |
| Embedding (nightly cluster) | OpenAI Batch API (50% discount) for full re-cluster job | $250/mo @ 10k devs vs $500/mo live |
| Embedding (fallback) | Xenova MiniLM-L6 lazy-loaded, batched 32-prompt windows | ~30 prompts/sec on 1 CPU |

### 3.4 Cost analysis

#### Self-host cost projection (validated 2026-04-16 web prices)

**Hetzner (lean)** — recommended for OSS self-host (revised per Challenger F1 with April 2026 hike)

| Devs | Components | $/mo |
|---|---|---|
| 100 | 1× CCX13 (Bun web+ingest+worker), 1× CCX13 (CH+PG+Redis) | ~$35 |
| 1,000 | 1× CCX23 (web+ingest), 1× CCX23 (CH), 1× CCX13 (PG+Redis), 1× CCX13 (worker) | ~$95 |
| 10,000 | 1× **AX52** dedicated (Ryzen 7 7700, 64GB RAM) for CH; 1× **AX42** for Bun stack; 1× CCX23 cloud for Redis+caddy | **~$215** (post-April-2026 hike) |

**AWS (enterprise self-host)** — for orgs that mandate AWS

| Devs | Components | $/mo |
|---|---|---|
| 100 | 2× t4g.medium, RDS db.t4g.small, MSK light, ALB | ~$280 |
| 1,000 | 4× t4g.large, RDS db.t4g.large, ClickHouse self-managed on m6i.xlarge×2 | ~$900 |
| 10,000 | 6× m6i.xlarge ECS, RDS multi-AZ, ClickHouse self-managed cluster (3× m6i.2xlarge), ALB, S3, transfer | ~$2,100 |

#### Managed cloud unit economics (our SaaS)

| Tier | Devs/team | Price/dev/mo | Margin assumptions |
|---|---|---|---|
| Free | up to 5 | $0 | Loss-leader; uses tightest tier |
| Team | 6–50 | $4 | 80% gross margin on Hetzner backplane |
| Growth | 51–500 | $6 (volume break) | 75% margin including support |
| Enterprise | 500+ | custom | SAML, dedicated CH, SLA, on-call rotation |

#### Insight LLM cost (managed cloud, BYO key avoids this)

- Weekly digest per team: ~$0.02 (Haiku 4.5, decomposed 6-call pipeline + self-check, prompt-cached)
- Anomaly hourly call (per team, per anomaly): ~$0.0005
- 10k devs / avg 5 devs/team = 2k teams → ~$40/wk digests + ~$50/wk anomalies = ~$360/mo total
- Still negligible vs infra cost.

#### Embedding cost (default OpenAI `text-embedding-3-small` @ 512d, BYO key on self-host)

| Devs | Raw prompts/day | After 80% dedup cache | Live API cost | Nightly Batch API cost | Total/mo |
|---|---|---|---|---|---|
| 100 | 80k | 16k | ~$1/mo | ~$4/mo | **~$5/mo** |
| 1k | 800k | 160k | ~$10/mo | ~$40/mo | **~$50/mo** |
| 10k | 8M | 1.6M | ~$100/mo | ~$400/mo | **~$500/mo** |

Cache hit ratio assumes ~80% (validated against pinakes corpus + boilerplate-prompt patterns). Voyage-3 upgrade ~9× cost of OpenAI; fallback Xenova/Ollama = $0. Managed cloud absorbs OpenAI cost as a line item; OSS self-host orgs pay their own.

#### Operational engineering cost (NEW per Challenger F)

Tinybird's 2026 self-host playbook flags **4–8 hr/wk ongoing maintenance** for a stable ClickHouse cluster. At loaded eng cost ~$200/hr that's $3,200–$6,400/mo in operational engineering the prior cost section omitted. Implication:
- For a self-funded OSS project, this is the maintainer's time (acceptable)
- For SaaS unit economics: at 10k devs × $4–6/dev/mo Team tier = $40–60k/mo revenue, the ops eng overhead is 8–13% of revenue. Margin still healthy.
- Document this honestly in the self-host docs so adopters aren't surprised.

### 3.5 Risks & limitations

**Explicitly NOT building (MVP scope):**
- IDE plugin / extension installation flow (we rely on hooks + file watching only — no editor extension code)
- Replacing the dev's own LLM API keys / proxy interception (we observe the IDE/ADE, never the network)
- Real-time intervention / blocking (we observe; we do not gate)
- LLM-output verification or correctness scoring (out of scope; we measure cost+activity, not code quality)
- General LLM application observability (our scope is coding agents specifically)
- Mobile dashboard (responsive web only)

**Assumptions that could be wrong:**
- IDE vendors continue to keep session data on local disk in readable format (if Cursor encrypts its SQLite, our adapter dies)
- Anthropic's OTel exporter remains opt-in via env var (not auto-on with telemetry-back-to-Anthropic)
- Managers will tolerate Tier C default once they self-host — if not, we may need to flip default to B
- Bun is production-ready at 10k connections sustained ingest (validated by community benchmarks but not by us at this scale)

**Biggest technical risks:**

| Risk | Probability | Severity | Mitigation |
|---|---|---|---|
| Cursor/Codex/etc. close their local data formats | Medium | High (entire MVP collapses for that IDE) | Keep adapter layer thin; maintain "best-effort, partial coverage" doc; lobby for OTel native export per IDE |
| ClickHouse + Bun has rough edges | Medium | Medium | Use HTTP client (well-supported); fallback to TimescaleDB if blocking issue |
| OTel GenAI conventions change before stable (still "Development" status in 2026-04) | High | Low (we own our own schema) | Translation layer between OTel attrs and our schema; version-pin the convention we follow |
| Better Auth SAML support insufficient for enterprise sales | Medium | Medium (managed-cloud SAML buyers) | Ship WorkOS adapter for enterprise tier; Better Auth for OSS |
| OSS adoption stalls (codeburn / sniffly capture mindshare) | Medium | High (no users → no community) | Ship Phase 1 fast; polished install demo; HN post with one-command setup video |

**Fallback if primary approach fails:**
- If Bun proves not production-ready at scale → fall back to Hono on Node 24 (same TS code mostly)
- If ClickHouse self-host UX is too painful → ship "Postgres + TimescaleDB" simple flavor as default, ClickHouse as advanced
- If Tier C default scares users → flip to Tier B default with one-click upgrade to C

---

## --- Mini Gap Check #2 (post-Loop 3) ---

For every failure mode in §3.1, mitigation is concrete (not "we'll handle it"). Verified: ✓

For every security consideration in §3.2, addressed in code-path or architecture: ✓ (auth → Better Auth, RLS in §2.7; injection → §3.2 envelope + validator; secret leakage → §3.1 F10)

Cost projection includes specific provider-priced numbers: ✓

**Open items for Loop 6 (Adversarial Gap Review):**
- Awaiting Challenger critique (running) — will incorporate before locking
- Need to lock VS Code support definition (current draft says "VS Code agent extensions only")
- Need to lock Pi support claim (data is too thin in Loop 0)
- Need to specify MCP-adapter fallback design more concretely

---

## Loop 4 — Phased Implementation Plan

**Canonical doc:** [`PRD.md`](../PRD.md) (parallel-workstream restructure per user direction "parallelism to the max").

**Summary:**
- **Sprint 0** (Days 1–2): Foundation Sprint — 14 contract tasks unblock all workstreams
- **Sprint 1** (Days 3–14): 8 parallel workstreams (B Collector, C Ingest, D DB, E Workers, F Web, G Packaging, H AI, I Docs)
- **Sprint 2** (Days 15–21): 11 integration tasks; mocks → reals; perf + privacy gates
- **Sprint 3** (Days 22–28): polish, demo video, OSS release v0.1

Total: **4 weeks to a full-featured PoC** with all 16 brief requirements satisfied. Managed-cloud (former Phase 6) deferred to Sprint 5+.

**Headcount:** minimum 5 senior devs. With agentic parallelism, can be 1 human + 8 parallel Claude Code instances (one per workstream).

---

## Loop 5 — Evaluation Criteria Mapping

Mapped against the criteria locked in §1.8.

| # | Criterion | Weight | How addressed | Workstream | Confidence |
|---|---|---|---|---|---|
| E1 | Time-to-first-insight (<10 min from `curl install` to first useful chart) | High | Installer detects all IDEs and configures them in <60s; ingest accepts events immediately; dashboard renders skeleton + Tremor chart from first event | B7, F4, F11 | High |
| E2 | Multi-IDE coverage day one | High | Per-IDE adapter parallelized in B1–B6; each has fixtures + tests | B1–B6 | High for Claude Code/Cursor/Codex/OpenCode/Goose; **Medium for Copilot (output tokens only); Low for Pi (best-effort)** |
| E3 | Manager-actionable insight quality (≥3 novel insights per week per team) | High | Insight Engine with citation grounding + numerical fact-check + LLM-judge eval ≥0.7 | H4–H8 | Medium-High (depends on eval suite quality) |
| E4 | Self-host UX (<30 min from `docker compose up` to live dashboard) | High | Single compose file; one-command bootstrap; embedded mode for tiny self-host (DuckDB+SQLite single-binary) | G2, G4 | High |
| E5 | Privacy auditability (dev sees what bytes left) | High | Local SQLite egress journal + `devmetrics audit --tail` + dry-run mode | B0, B8 | High |
| E6 | Performance at 10k devs (p95 dashboard <2s, p99 ingest <100ms, 100 evt/sec sustained) | Medium | OTel collector batching + ClickHouse MVs + Redis token bucket; perf gate in INT11 | C, D, INT11 | Medium (will know after Sprint 2 perf gate) |
| E7 | Code/architecture quality (test coverage >80%, OTel-aligned, contributable) | Medium | Test minimums per workstream (≥15–30 each); OTel GenAI conventions in F10; Apache 2.0 + CONTRIBUTING.md | All | High |
| E8 | OSS adoption signal (1k stars / 90 days post-launch) | Medium (deferred) | Show HN, demo video, comparison table vs codeburn / sniffly / ccusage / tokscale; clear differentiation = manager + multi-IDE + Git correlation | I | Medium (depends on launch execution) |

### "Clearly exceptional" strategies for high-weight criteria

| Criterion | Meets requirements | Clearly exceptional | Our approach |
|---|---|---|---|
| E1 (TTI) | Install + see chart | <10 min, zero-config, even picks up the past 30 days of sessions | Backfill mode: collector imports historical session files on first run |
| E2 (multi-IDE) | Cover the 5 main IDEs | Cover all 7 named in brief + extension points for new ones | Adapter SDK in `packages/sdk` makes new IDEs additive |
| E3 (insight quality) | LLM emits a digest | Citations grounded + numerical fact-check + Twin Finder alongside Insight | Combined Insight Engine + Twin Finder in same UI surface |
| E4 (self-host UX) | docker compose works | Two flavors: heavy (10k+ devs) and embedded single-binary (≤20 devs) | I12 dual-flavor packaging |
| E5 (privacy auditability) | Show what was sent | Dry-run before send + cryptographically signed policy + per-byte audit | B0 + B8 + signed policies |

### Risk of falling short

| Criterion | Risk | Mitigation |
|---|---|---|
| E2 — coverage | Cursor / OpenCode change formats | Adapter contract isolates change; integration test pins both formats |
| E3 — insight quality | Naive prompt produces useless insights | Eval suite gate; weekly review by team; Twin Finder always works as fallback even if Insight Engine is bad |
| E6 — performance | Bun + ClickHouse rough edges at scale | Fallback to Hono on Node + TimescaleDB if blocking issue |
| E8 — adoption | Codeburn / sniffly capture mindshare first | Lead with multi-IDE + manager wedge; highlight that we're additive (codeburn users can keep using it) |

---

## Loop 6 — Adversarial Gap Analysis

Source: [`challenger-loop2-critique.md`](./challenger-loop2-critique.md) — full Opus 4.6 Challenger critique, 30+ web sources cited.

### 6.1 Requirements traceability matrix (post-Challenger)

| # | Requirement (from user brief) | Where addressed | Workstream | Test | Confidence |
|---|---|---|---|---|---|
| R1 | `npx`/`curl` install on every dev machine | §3.2 (now sigstore + distro pkg primary), B7, G6 | B + G | install matrix tests | High (after BLOCKER H fix) |
| R2 | Track tokens, commits, PRs merged | §2.3 schema (now with `pr_number`/`commit_sha`), C8 webhooks, E3 git ingestor | B + C + E | Git-correlation tests | High |
| R3 | Token cost, session/turn token totals | §2.3 schema, E2 cost worker, A3 idempotency | B + E | per-adapter parser tests | High |
| R4 | Prompt messages | §2.3 (Tier B/C), E5 server-side TruffleHog/gitleaks redact | B + C | privacy adversarial tests | High |
| R5 | All IDEs/ADEs (Codex, Claude Code, OpenCode, VS Code, Cursor, Pi) | §2.5; **Pi CUT, VS Code = "agent extensions only"** (per Challenger D) | B1–B6 | per-IDE fixtures | Mixed (see §6.2 IDE matrix) |
| R6 | Centralized dashboard for managers | §2.6, F | F | Playwright E2E | High |
| R7 | 100-dev → 10k-dev scale | §1.2, §3.4, §3.3 | C + D | k6 perf gate (INT11) | Medium-High (Bun↔CH soak test gates this — A1) |
| R8 | Leaderboard | §2.6, F5; efficiency-ranked | F | leaderboard correctness | High |
| R9 | Prompts that worked / commits vs token usage | F7, F8, I1, I2, I11 | F + H | Twin Finder + cluster-stats | High |
| R10 | Token usage vs PRs merged efficiency | F9, repo_weekly_rollup MV | F | join correctness | High (after schema amendment C2/C3) |
| R11 | Comparative ("why dev X uses 1/2 tokens") | H3 Twin Finder + F7 | F + H | nearest-neighbor tests | High |
| R12 | Open source | Apache 2.0; LICENSE in repo (I6) | I | LICENSE check | High |
| R13 | Self-hostable like Swagger / Prisma Studio / Storybook / Langfuse | G2, G4 (now Postgres+Timescale embedded) | G | compose + embedded E2E | High (after A4 amendment) |
| R14 | Self-hosting includes server + DB (not frontend-only) | §2.4 service topology | G | compose.yml has all components | High |
| R15 | Repos push to centralized place for managers | §2.5 ingest, C8 webhooks | C | ingest auth tests | High |
| R16 | Insight to managers to improve agentic workflows | §2.7 (decomposed pipeline), H4–H8, F10, E4–E6 | E + F + H | adversarial eval ≥0.7 | Medium-High (depends on eval suite design) |

### 6.2 IDE coverage matrix (HONEST, post-Challenger D)

Locked for v1 launch copy. **Pi removed; VS Code defined.**

| IDE | Coverage in v1 | Caveats |
|---|---|---|
| Claude Code | **Full fidelity** | Hooks + native OTel + JSONL — best case |
| Codex CLI | **Full with caveat** | Per-turn requires stateful diffing of cumulative `token_count`; collector-restart mid-session = broken tokens for that session (documented limitation) |
| Cursor | **Token-only with caveat** | "Auto" mode = `cost_estimated=true` flag; managers see "estimated" badge in UI |
| OpenCode | **Post-migration only** | Detects format; if user has orphaned pre-v1.2 JSON sessions, they're skipped with a warning |
| Goose | **Post-v1.10 only** | Same dual-format issue; pre-v1.10 sessions skipped with warning |
| GitHub Copilot | **Aggregate-only via Metrics API (Enterprise)** | Personal-tier Copilot users get zero data; documented honestly. Per-prompt detail unavailable. |
| Pi | **CUT** | Vaporware risk; Loop 0 data was Low confidence. May add post-v1 if community contributes. |
| "VS Code" | **Defined as: VS Code agent extensions only** (Continue.dev, Cline, Roo) | VS Code itself is just an editor. Each agent extension treated as its own IDE in the dashboard picker. |

Dashboard adds a `data_fidelity` indicator next to each IDE/dev so managers know what's measured vs estimated vs aggregated.

### 6.3 Architecture gaps closed by Challenger amendments

| # | Original gap | Amendment | Where applied |
|---|---|---|---|
| G1 | TTL syntax wrong (BLOCKER C1) | Partition-drop strategy for Tier-A; TTL only for B/C with revised retention | §2.3 events table; §3.1 F10b |
| G2 | curl\|sh insecure post-Shai-Hulud (BLOCKER H) | Sigstore + SLSA L3 + distro packages primary; egress allowlist; in-app verification | §3.2 daemon-install row |
| G3 | `ORDER BY` mis-aligned with queries | Switched to `(org_id, ts, dev_id)` + projections | §2.3 events table |
| G4 | Missing schema columns | Added `client_event_id`, `schema_version`, `pr_number`, `commit_sha`, `branch`, `exit_code`, `error_message_hash`, `cost_estimated`, `redaction_count` | §2.3 events table |
| G5 | PgBoss overload at 8M evt/day | Scoped to crons; per-event work → MV / Redis stream | §2.2 stack table; §2.4 topology |
| G6 | DuckDB embedded contention | Replaced with single-container Postgres + Timescale; raised embedded scope from 20→50 devs | §2.2 stack table; §2.4 topology |
| G7 | Insight engine naive | 4-call decomposed pipeline + retrieval grounding + self-check + hourly anomaly job + High-confidence gate | §2.7 |
| G8 | Tier-A enforceable only at column level (raw_attrs leak) | Ingest-time `raw_attrs` allowlist for Tier A | §2.3 + §3.2 multi-tenancy row |
| G9 | Built-in regex misses real secrets | Server-side TruffleHog + gitleaks ruleset + `redaction_count` column | §1.5 + §2.3 |
| G10 | Tier-C 180d retention too long | Lowered OSS default to 30d (Tier-C) and 90d (Tier-B); orgs can extend | §1.5 + §2.3 TTL |
| G11 | No GDPR erasure SLA | 7d SLA + weekly batched mutation worker + `devmetrics erase` CLI | §3.1 (new F10 family) |
| G12 | Manager CSV export leaks Tier-C | "Reveal" gesture + audit; CSV redacts by default; "Export with prompts" 2FA-gated | §3.1 F10d + §3.2 |
| G13 | Managed cloud Tier-C accidental accept | Server-side 403 unless billing flag set | §3.1 F10e + §3.2 |
| G14 | Crash dump leak even at Tier A | `ulimit -c 0` + `RLIMIT_CORE` + `devmetrics doctor` check | §3.1 F10c |
| G15 | OTel collector mandatory bloat | Made optional in default deploy; Bun ingest speaks OTLP HTTP natively | §2.2 + §2.4 |
| G16 | Bun↔ClickHouse client unsoaked | 24h soak test before locking; documented Plan B (Go side-car) | §2.2 + new INT-A1 task |
| G17 | Cursor "Auto" cost = wrong cost | `cost_estimated Bool` flag in events; dashboard surfaces "estimated" badge | §2.3 + §6.2 |
| G18 | Multi-IDE coverage promise > reality | Honest IDE matrix in §6.2; Pi CUT; VS Code defined | §6.2 |
| G19 | Cost projection ignored ops eng | Added 4–8 hr/wk operational engineering line item | §3.4 |
| G20 | Confidence scoring was Stretch | Promoted to MUST in §2.10 + §2.7 | §2.7 + §2.10 |
| G21 | Xenova model OOM on dev laptop | Lazy-load + server-side embedding fallback for low-mem | §2.7 |

### 6.4 Decision-confidence table (after amendments)

| Decision | Confidence | Risk if wrong | Reversibility |
|---|---|---|---|
| Bun runtime end-to-end | High | Medium (fall back to Hono on Node) | Medium (rewrite of Bun-specific APIs) |
| ClickHouse for events | High (after soak) | Medium (TimescaleDB fallback) | Hard (data migration) |
| Postgres+Timescale embedded mode | High | Low (just for tiny self-host) | Easy |
| OTel-aligned schema with our extensions | High | Low | Easy (schema versioning supported via `schema_version` col) |
| Tier-C default | Medium | High (privacy backlash → flip to Tier B) | Easy (server-side default change) |
| Sigstore + distro packages primary | High | Low (curl\|sh remains as fallback) | n/a |
| Decomposed insight pipeline | High | Medium (managers ignore digests) | Medium (replace with simpler template) |
| Anthropic Haiku 4.5 for insights | High | Low (BYO key avoids cost; can swap to Sonnet) | Easy |
| Better Auth (OSS) + WorkOS later | Medium | Medium (enterprise SSO ask) | Hard once integrated |
| 4-week parallel-workstream PoC plan | Medium | Medium (slips to 6 weeks) | n/a |

### 6.5 Patch list (all applied in this Loop 6 pass)

| # | Gap | Severity | Fix | Applied in |
|---|---|---|---|---|
| P1 | TTL BLOCKER | Critical | Partition drops for Tier-A; revised TTL for B/C | §2.3, §3.1 F10b |
| P2 | curl\|sh BLOCKER | Critical | Sigstore + SLSA L3 + distro pkgs primary | §3.2, PRD G6 |
| P3 | Schema ORDER BY | High | `(org_id, ts, dev_id)` + projections | §2.3 |
| P4 | Schema missing cols | High | 9 columns added incl. `client_event_id`, `pr_number`, `branch`, etc. | §2.3 |
| P5 | PgBoss overload | High | Scope to crons; MV/Redis-stream per-event | §2.2, §2.4 |
| P6 | DuckDB embedded contention | Medium | Postgres+Timescale single-container instead | §2.2, §2.4 |
| P7 | Insight engine naive | High | Decomposed 4-call + retrieval + self-check + hourly anomaly | §2.7 |
| P8 | raw_attrs PII leak at Tier A | High | Ingest-time allowlist | §2.3, §3.2 |
| P9 | Regex redact insufficient | High | TruffleHog + gitleaks server-side | §1.5, §2.3 |
| P10 | 180d Tier-C retention | Medium | 30d default | §1.5, §2.3 |
| P11 | No GDPR erasure SLA | High | 7d SLA + weekly worker + CLI | §3.1, PRD E |
| P12 | CSV export leak | Medium | Reveal gesture + 2FA-gated export | §3.1, §3.2 |
| P13 | Managed-cloud Tier-C accept | Medium | Server-side 403 default | §3.1, §3.2 |
| P14 | Crash dump leak | Medium | `ulimit -c 0` + doctor check | §3.1 |
| P15 | OTel collector bloat | Medium | Optional in default; Bun OTLP native | §2.2, §2.4 |
| P16 | Bun↔CH unsoaked | High | 24h soak gate before Sprint 2 lock | PRD INT0 (new) |
| P17 | Cursor Auto cost | Medium | `cost_estimated` flag + UI badge | §2.3, §6.2 |
| P18 | IDE promise > reality | High | Honest matrix; Pi CUT; VS Code defined | §6.2 |
| P19 | Cost ignored ops eng | Medium | Added 4–8 hr/wk line | §3.4 |
| P20 | Confidence scoring Stretch | Medium | Promoted to MUST | §2.7, §2.10 |
| P21 | Xenova OOM | Low | Lazy-load + server fallback | §2.7 |

### 6.6 Open items deliberately left for v1.1+

- Pi adapter (CUT for v1)
- SCIM provisioning + nested AD groups (Phase 6 after Better Auth gaps land in WorkOS path)
- Real-time (sub-minute) anomaly detection (current spec: hourly cron — sufficient for v1)
- LLM-output verification or correctness scoring (out of scope per §3.5)
- Mobile app (responsive web only)

**Lock state:** All BLOCKERs resolved. NEEDS-AMENDMENT items applied. Presearch + PRD + CLAUDE.md ready for implementation.
