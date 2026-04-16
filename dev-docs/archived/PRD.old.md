# DevMetrics — Product Requirements Document

**Version:** 0.2 (parallel-workstream restructure)
**Date:** 2026-04-16
**Companion docs:** [`dev-docs/presearch.md`](./dev-docs/presearch.md), [`dev-docs/research-brief.md`](./dev-docs/research-brief.md), [`CLAUDE.md`](./CLAUDE.md)

---

## 0. Product summary

DevMetrics is an open-source (Apache 2.0), self-hostable analytics platform that auto-instruments every developer's machine to capture all LLM/AI coding usage (tokens, cost, prompts, sessions, tool calls) across every IDE/ADE — Claude Code, Cursor, Codex, OpenCode, Goose, Copilot, Pi — ships it to a centralized backend the team owns, and gives engineering managers cross-developer correlation against Git outcomes (commits, PRs, churn) so they can coach prompt-efficiency and improve agentic workflows.

**Install on dev machine:**
```bash
curl -fsSL https://devmetrics.dev/install.sh | sh -s -- --org=acme --token=dm_xxx
```

**Self-host backend:**
```bash
docker compose -f https://devmetrics.dev/compose.yml up -d
```

---

## 1. Build philosophy — Parallelism-first, full-featured PoC in 4 weeks

The previous draft was sequential (Phase 1 → 2 → 3 → 4 → 5, 10 weeks). This version is restructured around **parallel workstreams**: a 2-day Foundation Sprint pins all interface contracts so the remaining 8 workstreams execute concurrently. Functional scope is unchanged — full-featured, not stripped — only the graph of dependencies is flattened.

**Key design rule:** Every workstream depends only on the Foundation Sprint outputs (types, contracts, schemas) plus its own internal milestones. Cross-workstream dependencies happen through stable interfaces, not through sequencing.

**Mocks-first.** Every workstream that consumes another's output ships a mock for it on Day 3 and swaps to the real implementation in Week 3 integration window.

**Targeted timeline:**
- **Sprint 0** (Days 1–2): Foundation Sprint — locked contracts → all workstreams unblock
- **Sprint 1** (Days 3–14): All 8 workstreams build in parallel against mocks
- **Sprint 2** (Days 15–21): Integration window — swap mocks for reals; E2E green
- **Sprint 3** (Days 22–28): Packaging, polish, demo video, public-launch prep

**Total:** **4 weeks to a full-featured PoC** with all 16 brief requirements satisfied. Managed-cloud (former Phase 6) and OSS launch polish (former Phase 7) are deferred to Sprint 5+.

---

## 2. Sprint 0 — Foundation Sprint (Days 1–2)

**Single dev (or single agent), single workstream. Output unblocks everyone.**

The entire purpose of this sprint is to publish the contracts. After Day 2, no further changes to these without a coordinated workstream pause.

### 2.0 Tasks

| # | Task | Owner | Output | Done when |
|---|---|---|---|---|
| F1 | Bun monorepo scaffold | foundation | `apps/{web,ingest,collector,worker}` + `packages/{schema,otel,sdk,ui,config}` + Bun workspaces + Biome + tsconfig | `bun install && bun run build` clean across all packages |
| F2 | Normalized event TypeScript types | foundation | `packages/schema/src/events.ts` + zod schemas | importable, validated, OTel-attribute-aligned |
| F3 | Adapter interface | foundation | `packages/sdk/src/adapter.ts` — `Adapter` interface + base class | mock adapter compiles |
| F4 | Ingest API spec | foundation | `packages/api/openapi.yaml` + tRPC router stubs | mock client exercises every endpoint |
| F5 | ClickHouse DDL | foundation | `packages/schema/clickhouse/` migration files | `clickhouse-client < migration.sql` succeeds on clean instance |
| F6 | Postgres DDL + Drizzle schemas | foundation | `packages/schema/postgres/` + `drizzle/migrations/` | `bun run db:migrate` succeeds; types exported |
| F7 | Auth token format + verification | foundation | `packages/sdk/src/auth.ts` — `dm_<orgId>_<rand>` parser/issuer | round-trip test green |
| F8 | Privacy tier definitions | foundation | `packages/schema/src/policy.ts` — Tier A/B/C contract + redaction defaults | sample policy yaml validates |
| F9 | Docker Compose dev stack | foundation | `docker-compose.dev.yml` — Postgres + ClickHouse + Redis only (no app code yet) | `docker compose -f docker-compose.dev.yml up` brings all DBs up clean |
| F10 | OTel GenAI attribute mapping | foundation | `packages/otel/src/conventions.ts` — bidirectional mapping our schema ↔ `gen_ai.*` | round-trip test green |
| F11 | Config schema (yaml) | foundation | `packages/config/src/schema.ts` — `devmetrics.policy.yaml` + server config | sample configs parse |
| F12 | Mock fixtures | foundation | `packages/fixtures/` — sample JSONL/SQLite/JSON for every IDE | importable from any workstream |
| F13 | CI scaffolding | foundation | `.github/workflows/{ci,release}.yml` — lint, type, test on every PR | green on empty stub PR |
| F14 | Workstream READMEs | foundation | `WORKSTREAMS.md` describing each parallel stream + interface boundaries | every workstream lead has a one-page brief |
| F15 | **Bun↔ClickHouse soak test** (per Challenger A1) | foundation | 24h test harness in CI: 100 evt/sec sustained, monitor connection-pool, INSERT latency p99, hangs | Pass with no flakes OR Plan B (Go side-car) is documented and ready |
| F16 | **Sigstore + SLSA L3 build pipeline** (per Challenger H) | foundation | GitHub Actions reusable workflow: hermetic build, cosign signature, attestation publish | one signed binary verifiable end-to-end |
| F17 | **TruffleHog + gitleaks ruleset bundling** (per Challenger E5) | foundation | `packages/redact/` — bundled rule set + version-pinned; ingest scanner takes prompt/tool blob → returns redacted + count | unit tests on known-secret fixtures |

**Acceptance:** all 14 tasks merged to `main`; all 8 workstream leads have a green starting point.

---

## 3. Sprint 1 — Parallel build (Days 3–14)

**8 workstreams, fully independent after Sprint 0. Each has its own owner (or pair / agent).**

### Dependency graph

```
                    Sprint 0 (Foundation)
                          ↓ (contracts pinned)
      ┌──────┬──────┬──────┼──────┬──────┬──────┬──────┐
      ↓      ↓      ↓      ↓      ↓      ↓      ↓      ↓
     [B]    [C]    [D]    [E]    [F]    [G]    [H]    [I]
     IDE   Ingest  DB    Async  Web   Pkging  AI    Docs
   adapters server  (no  workers (No   /CLI  insight (Nextra
   (6 each       new                  /Doc  + cluster + brand
   parallel)     work             ker         + eval)   site)
```

All workstreams check in nightly. Daily standup is 10 min, async OK. Cross-workstream issues file under `WORKSTREAM-INTEGRATION.md`.

---

### Workstream B — Collector & Per-IDE Adapters

**Owner:** B-lead (can split across 6 agents/devs, one per adapter).

**Sub-tasks (max parallelism):**

| # | Task | Days | Parallel? |
|---|---|---|---|
| B0 | Local daemon (Bun-compiled) skeleton: `bun build --compile`, launchd/systemd installers, UNIX socket for hook input, SQLite egress journal with `client_event_id` + at-least-once delivery, `--ingest-only-to <hostname>` cert-pinning flag (per Challenger A3, H6), `ulimit -c 0` in startup (per Challenger E6) | 3 | foundation for B1–B6 |
| B1 | Claude Code adapter — hooks (preferred) + JSONL tail (fallback) + OTel exporter routing config | 4 | yes (after B0) |
| B2 | Cursor adapter — read-only SQLite poll, `mode=ro`, copy-and-read; emit `cost_estimated=true` for Auto-mode (per Challenger D) | 3 | yes (after B0) |
| B3 | Codex adapter — JSONL tail + cumulative `token_count` diffing; persist running totals to egress journal so collector restart doesn't break sessions | 3 | yes (after B0) |
| B4 | OpenCode adapter — handle BOTH pre-v1.2 sharded JSON AND post-v1.2 SQLite (per Challenger D); skip orphaned sessions with warning | 3 | yes (after B0) |
| B5 | Goose adapter — SQLite poll (post v1.10); skip pre-v1.10 JSONL with warning | 2 | yes (after B0) |
| B6 | Copilot adapter — Copilot Metrics API (Enterprise) for org-aggregate; document personal-tier as zero-data (per Challenger D) | 2 | yes (after B0) |
| B7 | VS Code agent-extension adapters (Continue.dev, Cline, Roo) — at least one shipped in v1; spec interface so community can add more (per Challenger D / Loop 6 §6.2) | 3 | yes (after B0) |
| B8 | Installer script — `install.sh` detects every IDE, configures all of them, registers daemon; **distro packages PRIMARY (Homebrew, apt/deb, AUR), curl\|sh fallback wrapped in function for partial-pipe safety** (per Challenger H) | 4 | yes (after B0) |
| B9 | `devmetrics` CLI: `status`, `audit --tail`, `dry-run` (default first run), `policy show`, `purge`, `upgrade`, `doctor` (checks `ulimit -c`, signature, ingest reachability), `erase --user --org` (GDPR — per Challenger E3) | 4 | yes (after B0) |
| **B-CUT** | ~~Pi adapter~~ (CUT per Challenger D — Pi is vaporware risk) | — | n/a |

**Mocks consumed:** Ingest API (use mock from F4 spec) → swap in Sprint 2.
**Mocks emitted:** Sample event stream the ingest team uses for load tests.

**Tests:** ≥30 (per-adapter parser × 5 fixtures each + daemon journal + installer matrix + CLI commands)

**Innovations included:** I3, I4, I12 (collector half)

---

### Workstream C — Ingest Server

**Owner:** C-lead (1–2 devs).

| # | Task | Days |
|---|---|---|
| C1 | Bun ingest server: `Bun.serve` at :8000 with custom JSON receiver **AND native OTLP HTTP/Protobuf receiver** (per Challenger B4 — collector sidecar now optional) | 3 |
| C2 | OTel Collector sidecar config (contrib build) — **OPT-IN ONLY**, for orgs that want collector batching | 1 |
| C3 | Bearer token auth + Redis rate limit (token bucket: 1k sustained, 10k burst) | 2 |
| C4 | Dedup logic via `client_event_id` + ReplacingMergeTree config in CH (per Challenger A3) | 2 |
| C5 | ClickHouse writer (batched, ZSTD-compressed) — uses pinned `@clickhouse/client`; soak-tested gate from F15 must pass | 3 |
| C6 | Postgres control-plane writer (org, dev, repo upserts) | 2 |
| C7 | S3-compatible spillover for ClickHouse-down scenarios + replay job | 2 |
| C8 | Webhook receivers: `POST /v1/webhooks/{github,gitlab,bitbucket}` for PR/commit | 2 |
| C9 | **Server-side secret redaction pipeline** — every event runs through TruffleHog + gitleaks rules from F17 BEFORE persist; replace caught secrets with `<REDACTED:type:hash>`; increment `redaction_count` (per Challenger E5) | 2 |
| C10 | **Tier-A `raw_attrs` allowlist** — write-time validator for any `tier='A'` event ensures `raw_attrs` only contains allowlisted OTel attribute keys (per Challenger C4) | 1 |
| C11 | **Managed-cloud Tier-C 403 guard** — server-side rejection of `tier='C'` events when `org.tier_c_managed_cloud_optin=false` (per Challenger E4) | 1 |

**Mocks consumed:** events from Workstream B (use F12 fixtures).
**Mocks emitted:** ClickHouse + Postgres seeded data for Workstream F.

**Tests:** ≥20 (auth, rate limit, dedup, replay, webhook signature verification, RLS)

---

### Workstream D — Database & Migrations

**Owner:** D-lead (1 dev — light load after Sprint 0).

| # | Task | Days |
|---|---|---|
| D1 | ClickHouse migration runner (idempotent, reversible) — events table per amended schema (Loop 6 §6.3 G3/G4): `ORDER BY (org_id, ts, dev_id)` + projections for `(repo_id, ts)` and `(prompt_cluster_id, ts)`; `PARTITION BY (toYYYYMM(ts), cityHash64(org_id) % 16)`; `ReplacingMergeTree(client_event_id)` | 3 |
| D2 | Postgres migrations via Drizzle | 1 |
| D3 | Materialized views: `dev_daily_rollup`, `prompt_cluster_stats`, `repo_weekly_rollup`, **`cluster_assignment_mv`** (replaces per-event PgBoss work — per Challenger A2/G5) | 3 |
| D4 | Postgres RLS policies on org-scoped tables; tested with adversarial cross-tenant probes | 3 |
| D5 | Backup/restore tooling (`devmetrics admin backup` / `restore`) | 3 |
| D6 | Embedded-mode adapters: identical schema mapped to **single-container Postgres + TimescaleDB** (per Challenger A4 — DuckDB dropped); raised scope from ≤20 → ≤50 devs | 3 |
| D7 | **GDPR partition-drop worker** (PgBoss cron) — weekly: `ALTER TABLE events DROP PARTITION` for any `(yyyymm, bucket)` ≥90d old containing only `tier='A'` rows (per BLOCKER C1 fix) | 2 |
| D8 | **GDPR erasure pipeline** — `devmetrics erase --user --org` writes to `erasure_requests`, weekly batched ClickHouse mutation worker, audit_log entry, email confirmation; 7d SLA (per Challenger E3) | 3 |

**Mocks consumed:** none (foundation only).
**Mocks emitted:** seeded fixtures for E and F.

**Tests:** ≥15 (migration roundtrip, RLS adversarial, MV correctness, backup/restore round-trip, DuckDB ↔ ClickHouse query parity)

---

### Workstream E — Async Workers

**Owner:** E-lead (1–2 devs).

| # | Task | Days |
|---|---|---|
| E1 | PgBoss bootstrap (**crons only**, per Challenger A2/B3); queue topology, dead-letter handling | 1 |
| E2 | Cost calculator worker — reads LiteLLM pricing JSON, recomputes `cost_usd_micro` for any event missing it; nightly recompute on price change | 2 |
| E3 | Git ingestor — backfill GitHub/GitLab REST every 30 min; webhook handler stores immediately; **denormalize `pr_number`/`commit_sha`/`branch` onto `events` rows in CH** (per Challenger C3) | 4 |
| E4 | Anomaly detector — **HOURLY** cron (was weekly) for 3σ alerts (per Challenger §G); writes to `alerts` table, hands to notifier; cohort-baseline fallback for new devs | 3 |
| E5 | Notifier — Slack + Discord + email webhook fan-out; templated messages | 2 |
| E6 | Insight digest worker — weekly cron per team, calls **decomposed Insight Engine pipeline** (Workstream H — 6-call) | 2 |
| E7 | **Redis stream consumer** for per-event downstream work (anomaly trigger fan-out, cluster-assignment kick) — replaces PgBoss for high-frequency jobs (per Challenger A2) | 2 |

**Mocks consumed:** ClickHouse aggregates (D mocks), Insight Engine API (H mocks).
**Mocks emitted:** seeded `git_events`, `alerts`, `insights` rows for F.

**Tests:** ≥15

---

### Workstream F — Web Dashboard

**Owner:** F-lead (1–2 devs + 1 designer; can split into front/back).

| # | Task | Days |
|---|---|---|
| F1 | Next.js 16 standalone scaffold + Tailwind v4 + shadcn/ui + Tremor v3; brand tokens | 1 |
| F2 | Better Auth integration: signup/login, org switcher, RBAC | 3 |
| F3 | Layout shell: sidebar, top bar with live SSE indicator, command-K | 2 |
| F4 | `/dashboard` (org overview): cost, sessions, leaderboard widget, top alerts | 2 |
| F5 | `/leaderboard` — efficiency-ranked (tokens-per-merged-PR), filters, time range | 2 |
| F6 | `/team` + `/team/:devId` — per-dev drill-down with model mix, top tools, sessions | 3 |
| F7 | `/sessions/:id` — turn-by-turn viewer (Tier C shows prompts), Twin Finder panel | 3 |
| F8 | `/clusters` — prompt cluster browser, stats, exemplars | 2 |
| F9 | `/repos/:id` — repo health, cost-per-merged-PR trend | 2 |
| F10 | `/insights` — weekly digests, click-through, history | 2 |
| F11 | `/wall` — full-screen real-time SSE feed (war-room mode) | 1 |
| F12 | `/settings/{policy,api-keys,members,billing,audit}` + **per-dev binary SHA verification panel** (per Challenger H8) — alerts admins to non-canonical collector binaries | 3 |
| F13 | tRPC v11 routers + React Query stale-while-revalidate; SSE endpoint for live updates | 3 |
| F14 | Empty-state and skeleton screens; mocks for every page so design works without backend | 2 |
| F15 | **Prompt "Reveal" gesture + 2FA-gated CSV export** (per Challenger E1) — prompt_text columns are masked by default; explicit reveal logs to audit; "Export with prompts" CSV requires 2FA | 2 |
| F16 | **`data_fidelity` indicator per IDE** in dashboard picker (per Challenger D / Loop 6 §6.2) — shows "full" / "estimated" / "aggregate-only" / "post-migration only" badges | 1 |
| F17 | **IDE coverage page** in docs/UI showing the honest matrix (Loop 6 §6.2); links from each per-dev view | 1 |

**Mocks consumed:** tRPC router responses (mocked from F4 spec); seeded ClickHouse data (D fixtures).
**Mocks emitted:** Playwright fixtures with visual snapshots.

**Tests:** ≥30 (component, integration, Playwright E2E for critical flows)

**Innovations included:** I1, I2, I5, I6, I9, I10, I11, I14 (UI for all of these)

---

### Workstream G — Packaging, CLI, DevOps

**Owner:** G-lead (1 dev).

| # | Task | Days |
|---|---|---|
| G1 | Production `Dockerfile` for each app (`oven/bun:1.2-alpine` multi-stage); `ENV ULIMIT_CORE=0` set in entrypoint (per Challenger E6); tiny final images | 2 |
| G2 | `docker-compose.yml` for self-host: web, ingest (with built-in OTLP receiver), worker, postgres, clickhouse, redis, caddy. **OTel collector now opt-in via `--profile otel-collector`** (per Challenger B4) | 3 |
| G3 | `bun build --compile` for collector + embedded server; cross-OS builds (linux/macos/win) | 3 |
| G4 | Embedded-mode binary: single Bun binary embeds web+ingest+worker; uses **single-container Postgres+TimescaleDB** (per Challenger A4 — was DuckDB+SQLite) | 4 |
| G5 | **Reproducible builds + SLSA Level 3 provenance + sigstore/cosign signing** via GitHub Actions reusable workflow (per Challenger H, BLOCKER fix) | 3 |
| G6 | **Distribution packages PRIMARY**: Homebrew formula (Mac), apt/deb (Debian/Ubuntu), AUR (Arch), Chocolatey (Win). Hosted install script at `https://devmetrics.dev/install.sh` is FALLBACK only — script wrapped in a function so partial-pipe execution fails closed; SHA-256 + cosign signature published per release (per Challenger H — BLOCKER fix) | 4 |
| G7 | Release pipeline: tag → built artifacts (binaries, images, compose files) → GH Release; signature attestation published; SBOM | 2 |
| G8 | Status page templates (statuspage.io OR self-hosted Cachet) | 1 |
| G9 | **Egress-allowlist mode** in collector: `--ingest-only-to <hostname>` flag with cert pinning (per Challenger H6); refuses to send to any other host | 2 |

**Mocks consumed:** none (works against any built artifact).
**Mocks emitted:** none.

**Tests:** ≥10 (compose stack `up` E2E, embedded binary E2E, image size checks, install script idempotency)

**Innovations included:** I12 (dual-flavor self-host)

---

### Workstream H — AI / Insight Pipeline

**Owner:** H-lead (1 ML-leaning dev).

| # | Task | Days |
|---|---|---|
| H1a | **`packages/embed` provider abstraction** — interface `Embedder { name, dim, embed(texts[]): vec[], embedBatch(texts[]): jobId }` with implementations: `OpenAIEmbedder` (default, text-embedding-3-small @ 512d via Matryoshka), `VoyageEmbedder` (BYO upgrade), `OllamaNomicEmbedder` (auto-detect Ollama), `XenovaMiniLMEmbedder` (bundled fallback). Config selects one per org. (Amended 2026-04-16) | 3 |
| H1b | **Embedding cache** — Postgres `embedding_cache(prompt_hash PK, model, dim, vector, created_at, hit_count)` + Redis L1 LRU. Server-side at ingest. Cache hit returns immediately; miss → enqueue to embedder | 2 |
| H1c | **OpenAI Batch API integration** for nightly re-cluster job (50% cost discount); live API for Twin Finder hot path | 2 |
| H2 | HDBSCAN clusterer worker: nightly re-cluster (consumes Batch API output), write `prompt_clusters` + assign IDs to events via `cluster_assignment_mv` (per Challenger A2 — replaces PgBoss per-event work) | 3 |
| H3 | Twin Finder query: cosine similarity within cluster, filter by efficiency, top-K | 2 |
| H4a | **SQL pre-compute step** (no LLM) — retrieve top-5 efficiency winners, bottom-5 concerns, top-10 prompt clusters by PR-merge correlation, all anomalies of last week. Outputs an aggregates blob + EXPLICIT ENUMS of valid IDs (per Challenger §G) | 2 |
| H4b | **`efficiency_winner_call`** — Haiku 4.5 picks 1 from candidate dev_ids enum, must cite from list, ~80 words | 1 |
| H4c | **`efficiency_concern_call`** — Haiku 4.5, excludes winner.dev_id via system prompt | 1 |
| H4d | **`prompt_pattern_call`** — Haiku 4.5 picks 1 cluster from enum, exemplars pre-attached | 1 |
| H4e | **`coaching_action_call`** — Haiku 4.5 produces 3 concrete coaching messages chained to a/b/c | 1 |
| H4f | **`self_check_call`** — Haiku 4.5 verifies cited numbers match aggregates; regenerates failing call once; drops if still failing (per Challenger §G) | 2 |
| H5 | Citation validator: every insight cites real `session_id` / `cluster_id`; reject otherwise (now a sanity check, not the gate — gating done by enum constraint in H4a–H4e) | 1 |
| H6 | **Confidence threshold (MUST, was Stretch)** — High/Med/Low tags; only High shown by default; Med shown as "investigate"; Low never shown (per Challenger I/§2.10) | 1 |
| H7 | **Anomaly model — HOURLY** (was weekly): per-dev rolling baseline + 3σ; cohort fallback for new devs; emits via E4 worker (per Challenger §G) | 2 |
| H8 | Model-routing recommender: scan org's Opus-on-trivial pattern; emit suggestion | 2 |
| H9 | Eval suite: 50 synthetic team-week scenarios INCLUDING **adversarial scenarios** (e.g., dev with 10× tokens but who solves all infra incidents — model must NOT mark as inefficient); LLM-judge gate ≥0.7 (per Challenger §G) | 5 |
| H10 | **Embedding/clustering quality eval suite** — 200-prompt golden set with hand-graded twin pairs; per-provider gate: OpenAI ≥0.8 recall@5, Xenova ≥0.6, Voyage ≥0.85. Runs on every provider config change in CI. | 3 |

**Mocks consumed:** seeded events from D fixtures.
**Mocks emitted:** sample `insights`, `prompt_clusters` rows for F.

**Tests:** ≥20 (validators, citation, eval suite gate, embedding determinism)

**Innovations included:** I1 (algo half), I7, I8, I11

---

### Workstream I — Docs, Brand, Launch

**Owner:** I-lead (1 dev/designer).

| # | Task | Days |
|---|---|---|
| I1 | Docs site (Nextra) at `devmetrics.dev/docs`; auto-deploy from `apps/docs` | 2 |
| I2 | Quickstart, Install, Self-host, Privacy, API Reference, Comparison, Troubleshooting | 4 |
| I3 | Brand tokens (color, type, logo, favicon, OG cards); applied to web + docs | 2 |
| I4 | 3-min demo video script + recording (install → first event → manager dashboard → Twin Finder) | 3 |
| I5 | Comparison table vs codeburn / sniffly / ccusage / tokscale | 1 |
| I6 | README + LICENSE (Apache 2.0) + CONTRIBUTING + CODE_OF_CONDUCT + SECURITY.md | 1 |
| I7 | Show HN draft + scheduling | 1 |

**Mocks consumed:** screenshots from F (real or mocked).
**Mocks emitted:** marketing site copy.

**Tests:** ≥5 (docs build, dead-link check, install one-liner from README runs on clean machine)

---

## 4. Sprint 2 — Integration window (Days 15–21)

**Goal:** swap every mock for the real implementation; E2E green.

### Sequenced integration tasks

| # | Task | Days |
|---|---|---|
| INT0 | **Bun↔ClickHouse 24h soak gate** — REQUIRED BEFORE INT1 (per Challenger A1). If flaky, switch to Plan B Go side-car for hot path NOW, not later | 1 |
| INT1 | Wire B (collector) → C (ingest) over real network; load-test 100 evt/sec sustained 30 min | 2 |
| INT2 | Wire C → D (ClickHouse + Postgres real writes); validate `client_event_id` dedup; partition strategy works on real data | 1 |
| INT3 | Wire D → E (workers consume seeded data); verify partition-drop worker correctly drops Tier-A partitions | 1 |
| INT4 | Wire E + H (insights flow end-to-end); decomposed pipeline runs end-to-end with self-check pass | 1 |
| INT5 | Wire F (dashboard) → C/D/E/H (real tRPC queries) | 2 |
| INT6 | Run G (compose) full stack on a clean VM; install B on a separate machine via **distro package** (not curl); verify event flow + cosign signature | 1 |
| INT7 | Run G (embedded mode) on a single machine via Postgres+Timescale; verify same Twin Finder result | 1 |
| INT8 | Critical-path Playwright E2E: install → Claude Code session → manager sees session → Twin Finder works | 1 |
| INT9 | Cross-org RLS adversarial test passes against real prod stack | 1 |
| INT10 | **Privacy adversarial — extended**: (a) Tier A run on real stack proves no `prompt_text` AND no PII in `raw_attrs` reaches CH; (b) TruffleHog/gitleaks scanner catches seeded secrets in prompt_text/tool_input/tool_output/raw_attrs; (c) `redaction_count` increments correctly; (d) Tier-A partition drop completes within 24h of cutoff (per Challenger E5/C4/G18) | 2 |
| INT11 | Performance gate: p95 dashboard <2s with 1M seeded events; verify `ORDER BY` + projections actually used (`EXPLAIN`) | 1 |
| INT12 | **GDPR erasure E2E**: `devmetrics erase --user X --org Y` deletes within 7d; audit_log + email confirmation correct (per Challenger E3) | 1 |
| INT13 | **Managed-cloud Tier-C 403 guard**: ingest endpoint rejects Tier-C events when `tier_c_managed_cloud_optin=false` (per Challenger E4) | 0.5 |
| INT14 | **Egress-allowlist test**: collector with `--ingest-only-to=foo.example` refuses to POST to `bar.example` even when redirected (per Challenger H6) | 0.5 |

**Acceptance:** all 11 INT tasks green; demo recordable end-to-end.

---

## 5. Sprint 3 — Polish, packaging, launch prep (Days 22–28)

| # | Task | Days |
|---|---|---|
| P1 | Bug-bash from internal dogfood (eat-our-own = team uses DevMetrics on this very repo) | 3 |
| P2 | Performance pass: ClickHouse query plans, MV refresh tuning, Bun ingest profiling | 2 |
| P3 | Empty-state polish, animations (Motion), loading states, mobile-responsive checks | 2 |
| P4 | Demo video re-record with final UI | 1 |
| P5 | Docs final pass (screenshots, gifs, copy edit) | 2 |
| P6 | Show HN scheduled, social cards, OG image | 1 |
| P7 | OSS release: tag v0.1, GH Release, npm packages, Docker images, install script published | 1 |

**Acceptance:** v0.1 released; install one-liner from README works on a clean machine; demo video published.

---

## 6. Workstream owner matrix (resource plan)

| Workstream | Headcount | Skill mix |
|---|---|---|
| Foundation Sprint | 1 | Senior generalist (set the contracts) |
| B — Collector & adapters | 2 (or 6 agents) | TS + Bun + each IDE's data format |
| C — Ingest | 1–2 | Bun + OTel + ClickHouse |
| D — DB | 1 | SQL + Drizzle + ClickHouse |
| E — Workers | 1–2 | TS + PgBoss + Anthropic SDK |
| F — Web | 1–2 + designer | Next.js + shadcn + Tremor |
| G — Packaging | 1 | DevOps + Bun build + Docker |
| H — AI pipeline | 1 | ML + Anthropic + embedding/clustering |
| I — Docs/brand | 1 | DX + writing + design |

**Minimum viable team:** 5 senior devs covering everything in 4 weeks.
**With agentic parallelism:** can be a single human orchestrator + 8 parallel Claude Code instances, one per workstream.

---

## 7. MVP validation checklist (every brief requirement → workstream)

| # | Requirement (from user brief) | Workstream | Innovation | Phase |
|---|---|---|---|---|
| R1 | `npx`/`curl` install on every dev machine | B7, G6 | I3 | Sprint 1 |
| R2 | Track tokens, commits, PRs merged | B + E3 | I2 | Sprint 1 |
| R3 | Token cost, session/turn token totals | B + E2 | — | Sprint 1 |
| R4 | Prompt messages | B (Tier B/C) | I1 | Sprint 1 |
| R5 | All IDEs/ADEs (Codex, Claude Code, OpenCode, VS Code, Cursor, Pi) | B1–B6 | I3 | Sprint 1 (open: VS Code = "agent extensions only"; Pi = best-effort) |
| R6 | Centralized dashboard for managers | F | — | Sprint 1 |
| R7 | 100-dev team scale | C + D | — | Sprint 2 perf gate |
| R8 | Leaderboard | F5 | I5 | Sprint 1 |
| R9 | Prompts that worked / commits vs token usage | F7, F8 | I1, I2, I11 | Sprint 1 |
| R10 | Token usage vs PRs merged efficiency | F9 | I2 | Sprint 1 |
| R11 | Comparative ("why dev X uses 1/2 tokens") | H3 + F7 | I1 (Twin Finder) | Sprint 1 |
| R12 | Open source | I6 | — | Sprint 3 |
| R13 | Self-hostable like Swagger / Prisma Studio / Storybook / Langfuse | G2, G4 | I12 | Sprint 1+3 |
| R14 | Self-hosting includes server + DB (not frontend-only) | G2 | — | Sprint 1 |
| R15 | Repos push to centralized place for managers | C8 (webhooks) + B (events) | — | Sprint 1 |
| R16 | Insight to managers to improve agentic workflows | H4–H8, F10, E4–E6 | I7, I8 | Sprint 1 |

---

## 8. Stretch goals (run in parallel from start where possible)

| # | Stretch | Workstream | Phase |
|---|---|---|---|
| S1 | I9 — Manager 1:1 prep doc | H + F | Sprint 1 (cheap given H4 already exists) |
| S2 | I13 — Tool-call-waste detector | E + F8 | Sprint 1 |
| S3 | I15 — Repo-relative benchmarking | E + F9 | Sprint 2 |
| S4 | Managed cloud beta (former Phase 6) | new workstream J | Sprint 4+ (post-PoC) |

---

## 9. Open items — RESOLVED BY LOOP 6

| Item | Resolution | Source |
|---|---|---|
| VS Code support definition | Defined as "agent extensions only" (Continue.dev / Cline / Roo); B7 ships at least one extension adapter in v1 | Loop 6 §6.2; Challenger D |
| Pi support level | **CUT for v1** (vaporware risk); may add post-v1 if community contributes | Loop 6 §6.2; Challenger D |
| MCP adapter fallback | Deferred to Sprint 4+ (not blocking v1) | Loop 6 §6.6 |
| Bun production at 100 evt/sec | **Soak test in F15 + INT0 gates Sprint 1** | Foundation Sprint; Challenger A1 |
| Better Auth SAML for Enterprise | Better Auth 1.5 SAML works for v1 OSS; SCIM + nested groups deferred to Sprint 4 (WorkOS adapter) | Loop 6 §6.6; Challenger B2 |
| ClickHouse + Bun client maturity | F15 24h soak + Plan B Go side-car documented if flaky | Foundation Sprint; Challenger A1/B1 |

## 10. Lock state

All BLOCKERs (TTL syntax, curl|sh distribution) resolved. All NEEDS-AMENDMENT items applied to schema, services, security, insight pipeline, and packaging. PRD locked for implementation.

---

*Document status: LOCKED post-Loop-6. Implementation may begin against Sprint 0 task list.*
