# DevMetrics — Product Requirements Document

**Version:** 1.0 (consolidated from `research.md`, `analytics_gpt_research.md`, `PRD-team-visibility.md`, `analytics-research/PRD.md`, `analytics-research/dev-docs/*`, `grammata-audit.md`)
**Date:** 2026-04-16
**Status:** Draft for implementation. Locks the union of the best ideas across five parallel research artifacts.
**Independence statement:** DevMetrics is a new, independent project. It is **not** a feature of, child of, or extension to Pharos. Grammata (the NPM package) is a building block whose field-level parsers may be reused or superseded, but Pharos / Electron / `pharos-ade.com` are not product surfaces.

---

## 1. Executive Summary

**What:** an open-source, self-hostable AI-engineering analytics platform that auto-instruments every developer's machine to capture LLM / coding-agent usage (tokens, cost, prompts, tool calls, outcomes) across every IDE/ADE (Claude Code, Codex, Cursor, OpenCode, Goose, Copilot, Continue.dev, Cline/Roo/Kilo). Ships it to a tenant-owned backend. Gives engineering managers **defensible cross-developer visibility** correlated with Git outcomes (commits, PRs, test runs) — without shipping per-engineer leaderboards, per-session LLM judgments, or panopticon views.

**Why this wedge (uncontested today):**
1. Every competitor (ccusage 12.9k★, tokscale 1.9k★, codeburn 2.1k★, sniffly 1.2k★, claude-code-otel 354★, Maciek Usage-Monitor 7.6k★, CodexBar 10.8k★) is **solo-only by design**.
2. Every seat-priced incumbent (Cursor, Copilot, Cody, Tabnine, Cline) publishes single-vendor dashboards only — no cross-tool rollup.
3. Anthropic's Claude Code telemetry explicitly punts to "bring your own Grafana."
4. Every existing tool currently ships a **2–5× over-counted token math bug** on streaming Claude JSONL (`research.md` §11.1; measured on real fixtures).
5. Outcome attribution (cost per merged PR / per commit / per green test) is begged for (claudewatch, ccusage #935, tokscale #295) and shipped by nobody.

**The three layers that make it defensible:**
- **Correctness:** ship the only tool with provably correct token math (requestId-deduped `message_delta` accumulation).
- **Outcome attribution:** cost per merged PR / commit / green test — correlated via native OTel `code_edit_tool.decision=accept` events and `git log` webhooks.
- **Team visibility without surveillance:** counters+envelopes as default, IC Private Agent Coach, k-anonymity floor k≥5 for manager views, AI Leverage Score (multi-dimensional, not a single "best engineer" ranking), works-council-compatible rollout templates.

**What ships in the 4-week MVP (Sprint 0–3):** solo `curl` / distro-package installer, 5 adapters (Claude Code, Codex, Cursor, OpenCode, Continue.dev), ingest + dedup + ClickHouse + Postgres stack, manager web UI with 2×2 matrix / AI Leverage Score / Twin Finder / Waste Radar, decomposed Haiku 4.5 weekly digest, Apache 2.0 release.

**What is deferred (Phase 2–4):** team gateway with SSO (BSL 1.1), k-anonymity+DP pipeline, SOC 2 Type I → II, EU-region hosting, retry root-cause clustering (HDBSCAN), CLAUDE.md recommender, air-gapped on-prem bundle.

**License posture:** open-core — **Apache 2.0** for agent + local dashboard + adapters + schemas + CLI; **BSL 1.1 → Apache 2.0 after 4 years** for team gateway + SSO/SCIM + audit-log export + on-device DP. Matches Sentry/Temporal/MariaDB pattern.

---

## 2. Product Positioning

### 2.1 Persona

**Primary:** Engineering manager / VP Eng at a 5–500-person engineering org (scale target: up to 10k devs across all tenants).
**Secondary:** Individual contributor who wants to see their own coding-agent effectiveness (private view, manager-invisible).
**Tertiary:** Finance / FinOps (cost attribution to projects and repositories, not to named individuals).

### 2.2 Deployment shapes (one binary, three modes)

| Mode | Target | Data path | Dashboard |
|---|---|---|---|
| **Solo / embedded** | Individual dev, ≤5 engineers | Single binary bundling Postgres+TimescaleDB (not DuckDB — single-writer contention in challenger A4) | Local web at `:9873` |
| **Team self-host** | Org 5–500 devs | `docker compose up` — web + ingest + worker + Postgres + ClickHouse + Redis | On-prem web; OAuth login |
| **Team managed** | SaaS tier (Phase 4+) | Hosted multi-tenant, ClickHouse row-policy isolation | Hosted web at `devmetrics.dev` |

The same agent binary runs in all three. `DEVMETRICS_ENDPOINT=<url>` is the only switch.

### 2.3 Non-goals (explicit — copied from `PRD-team-visibility.md`, `analytics-research/PRD.md` §10 and Loop 6)

| Non-goal | Why |
|---|---|
| Autonomous coaching ("AI suggests a prompt improvement") | Second-order LLM = Goodhart + TOS + cost cliff + privacy. Never ship. |
| Real-time per-engineer event feed | Panopticon. Banned by challenger review. |
| Public per-engineer leaderboards | Works-council BLOCKER in DE/FR/IT; Goodhart-unsafe. |
| Performance-review / promotion-packet surfaces | Explicit product line we refuse to cross. |
| IDE plugin surface | Scope — we observe agents, not editors. |
| Code-quality analysis (lint / complexity over captured code) | Scope — analytics over agent telemetry only. |
| Cross-tenant benchmarking ("your team vs. industry") | TOS + antitrust + required trust model we won't ship. |
| Replacing the dev's LLM API keys / proxy interception | We observe, we do not gate. |
| Real-time intervention / blocking | Out of scope forever. |
| Pharos coupling (IPC, Electron, `pharos-ade.com` upload) | Independent project by brief; never introduce. |

---

## 3. Top Use Cases

1. "Show me the 5 prompt patterns across my team that produced the most merged PRs this sprint."
2. "Why is developer X consuming 3× the tokens of developer Y for similar work?" (Twin Finder)
3. "What's our cost per merged PR by repo and by model, and is it trending up?"
4. "Which engineers are stuck in retry loops / Bash-error storms?" (Waste Radar)
5. "Which engineers should attend Friday's prompt-engineering coaching session?" (ranked by AI Leverage Score gap within task-category cohort, never as a public leaderboard.)
6. "Show me what my own agent anti-patterns are — privately, only I see this." (IC Private Agent Coach)
7. "Export the SOC 2 / EU AI Act Annex IV evidence bundle for my last 90 days of AI-assisted work."

---

## 4. Product Surfaces

### 4.1 CLI (`devmetrics`)

| Command | Purpose | Notes |
|---|---|---|
| `devmetrics install` | Installer — detects every IDE on the machine, configures adapters, registers daemon (launchd/systemd), opens local dashboard. | Distro package primary; `curl \| sh` fallback wrapped in a function for partial-pipe safety. Sigstore + cosign signature. SLSA L3 attestation. |
| `devmetrics status` | Adapters active, last event, queue depth, version, signature SHA. | |
| `devmetrics audit --tail` | What bytes left this machine (the "egress journal" — local SQLite, kept forever). | Privacy commitment #1 in the Bill of Rights. |
| `devmetrics dry-run` | Default on first run — logs what would be sent, sends nothing. | |
| `devmetrics policy show` | Current effective tier + redaction rules. | |
| `devmetrics doctor` | Checks `ulimit -c 0`, binary signature, ingest reachability, IDE adapter health. | |
| `devmetrics purge --session <id>` | Local egress journal purge for a session. | |
| `devmetrics erase --user <id> --org <id>` | GDPR erasure (server-side, triggers partition drop within 7 d). | |
| `devmetrics serve --embedded` | Single-binary mode, bundled Postgres+Timescale, local web. | Solo / ≤5-dev orgs. |
| `devmetrics outcomes` | Cost per merged PR / commit / green test for this project. | Uses `git log` + local adapter data. `research.md` Lane 1. |
| `devmetrics waste` | In-session anti-pattern report for the last 30 d. | `research.md` Lane 3. |
| `devmetrics prompts` | Personal prompt-quality patterns with cohort sizes. | `research.md` Lane 2. |
| `devmetrics export --compliance` | Signed JSON bundle + SHA-256 manifest + optional PGP sig + EU AI Act / SOC 2 report mappings. | Phase 2; PRD-team C2. |
| `devmetrics scan --phi` | Detect PHI / secrets in paste-cache / image-cache / JSONL. | Phase 3; PRD-team C1 (HIPAA gap — Anthropic BAA excludes Claude Code). |

### 4.2 Web dashboard

Managers and individual contributors both hit the same Next.js 16 app; **role in the JWT decides what renders**.

| Route | Who sees it | Contents |
|---|---|---|
| `/dashboard` | IC + Manager | Org overview — spend, sessions, top alerts. Manager view is aggregated over k≥5 cohorts. IC view is their own data plus their AI Leverage Score trend. |
| `/leaderboard` | **Manager view is a 2×2 matrix** (Outcome Quality × Efficiency), not a ranked list. IC view shows their own position (anonymized to manager). | GPT recommendation; PRD-team's k≥5 floor applied. |
| `/team` | Manager | Team aggregates per repo, per model, per task category (13-class codeburn taxonomy). **No per-IC ranking.** |
| `/me` | IC only | **IC Private Agent Coach** — full retry/interrupt detail on their own sessions, personal prompt-pattern cohorts, Waste Radar anti-patterns, suggested fix templates, maturity-ladder stage. Manager **cannot** see this view at v0. |
| `/sessions/:id` | IC (own); Team Lead with IC opt-in | Turn-by-turn viewer. Prompt text visible only with explicit "Reveal" gesture + audit-log entry. |
| `/clusters` | Manager | Prompt-cluster browser (Phase 3 — HDBSCAN); team-aggregate only. |
| `/repos/:id` | Manager + IC | Repo health, cost-per-merged-PR trend, outcome attribution. |
| `/insights` | Manager + IC | Weekly digests; High-confidence only by default. |
| `/settings/policy` | Admin | Privacy-tier switch (requires signed Ed25519 config + 7-day cooldown), MDM profile builder, retention, data residency. |
| `/settings/audit` | Auditor role only | Hash-chained audit log; WORM-exported to S3 Object Lock. |
| `/privacy` | Public | Bill of Rights, DPIA template link, sub-processor register. |

### 4.3 APIs

| Endpoint | Purpose |
|---|---|
| `POST /v1/traces`, `/v1/metrics`, `/v1/logs` | OTLP HTTP + protobuf ingest (Claude Code native OTel flows here). |
| `POST /v1/events` | Custom JSON fallback for adapters that don't speak OTel (Cursor, OpenCode, Continue.dev, Cline/Roo). |
| `POST /v1/webhooks/{github,gitlab,bitbucket}` | PR / commit enrichment. |
| `tRPC v11` | Web dashboard queries. |
| `SSE /v1/stream` | Live dashboard tile updates. |
| MCP server (Phase 4+) | Agents read their own historical usage for self-reflection. |

---

## 5. Architecture

### 5.1 Topology

```
┌───────────── DEVELOPER LAPTOP ─────────────────┐
│  Claude Code ──native OTLP──┐                  │
│  Codex / Cursor / OpenCode /│                  │
│  Goose / Copilot / Continue /│                 │
│  Cline / Roo       ──── adapters ──► devmetrics-agent (Bun-compiled binary)
│                              │       • OTLP HTTP receiver (:4318 loopback)
│                              │       • 5 file-tailing adapters
│                              │       • redaction + team.id tagging
│                              │       • SQLite egress journal (at-least-once)
│                              │       • ulimit -c 0, RLIMIT_CORE=0
│                              │       • --ingest-only-to <host> cert pinning
└──────────────────────┬───────┴────── local dashboard at :9873 ─┘
                       │ OTLP/HTTP + protobuf + gzip, mTLS optional
                       ▼
┌──────────── DEVMETRICS GATEWAY (single container image) ─────┐
│  Envoy + Rust ext_authz ── JWT verify, rate limit             │
│  OTEL Collector (opt-in sidecar) OR native Bun OTLP receiver  │
│  Redpanda (7-day queue, partition-by-tenant)                  │
│  Rust ingest worker ── Redis dedup (SETNX 7-d TTL) ──► ClickHouse
│                                                       │       │
│  Postgres 16 (control plane, RLS) ◄───────────────────┤       │
│  ClickHouse 25 (events + rollups)                     │       │
│     • ORDER BY (org_id, ts, dev_id) + projections     │       │
│     • PARTITION BY (toYYYYMM(ts), cityHash64(org)%16) │       │
│     • ReplacingMergeTree(ts) (see §D32)               │       │
│  Next.js 16 web (standalone) — manager + IC views     │       │
│  Redis 7 (cache + rate limit + dedup)                 │       │
│  S3-compatible spillover + ClickHouse MergeTree TTL   │       │
│     move for cold archive (>90 d)                     │       │
└───────────────────────────────────────────────────────┘
Same image runs on-prem (single-tenant, Docker Compose) or hosted (multi-tenant row policies).
```

### 5.2 Stack (locked)

| Layer | Choice | Rationale |
|---|---|---|
| Collector + ingest runtime | **Bun 1.2** compiled to single binary | One language end-to-end; F15 24-h soak test gates this with Go-sidecar Plan B. |
| Web | **Next.js 16** standalone export + Tailwind v4 + shadcn/ui + Tremor v3 + TanStack Table v8 | Proven stack; reduced-motion respected; WCAG AA targets. |
| Control plane DB | **Postgres 16** with RLS + Drizzle ORM | RLS is mandatory on every org-scoped table; adversarial cross-tenant test is merge-blocker. |
| Event store | **ClickHouse 25** (gateway / hosted) | 7–11× compression on OTEL logs; kernel-level row policies for multi-tenancy. |
| Embedded event store | **Postgres 16 + TimescaleDB** single container (≤50 devs) | Replaces DuckDB (challenger A4 single-writer contention). |
| Queue / per-event work | **Redis Streams** + ClickHouse MVs | PgBoss is crons-only (challenger A2 at 8 M events/day). |
| Crons | **PgBoss 9** | Git ingest, LiteLLM pricing refresh, weekly digest, erasure batches. |
| Auth | **Better Auth 1.5** (v1 OSS), **WorkOS** for SCIM + SAML (Phase 4) | GitHub OAuth covers mid-market day 1. |
| Embeddings | **OpenAI `text-embedding-3-small` @ 512 d** (Matryoshka), BYO key; Voyage-3 BYO upgrade; Ollama nomic / Xenova MiniLM air-gapped fallback | 80% hit on `embedding_cache` (Postgres + Redis L1); Batch API for nightly re-cluster (50 % cost). |
| Insight LLM | **Anthropic Haiku 4.5** (BYO key); prompt-cached | Decomposed 6-call pipeline (H4a–H4f); citation enum grounding; self-check pass; high-confidence gate. |
| Pricing | **LiteLLM `model_prices_and_context_window.json`** pinned per release; CI-tested | Same class of bug that sinks ccusage #934. |
| Distribution | **Sigstore + cosign + SLSA L3** via GH Actions; distro packages (Homebrew / apt / AUR / Choco) primary; `curl \| sh` fallback | Post-Shai-Hulud 2.0, signed distribution is mandatory. |
| Secret redaction | **TruffleHog + gitleaks** rulesets server-side at ingest (not collector-only) | Updated without redeploying every dev's collector. |
| Testing | `bun test` + Playwright + k6 | Privacy adversarial suite = merge-blocker; 24-h Bun↔CH soak = Sprint 0 gate. |

### 5.3 Canonical event schema v1

(Aligned with OTel `gen_ai.*` semantic conventions where they exist; `dev_metrics.*` extensions for coding-agent specifics.)

**Write-once allowlist** — every field is classified `counter` / `envelope` / `full-prompt`. Tier A → counters only. Tier B (default) → counters + envelopes. Tier C → all three. A server-side allowlist validator at ingest enforces (challenger C4 fix). Unknown fields land in `events_raw` (JSON blob) and are promoted via admin-UI → Git-ops PR flow, never by container restart.

| Field | Class | Source | Notes |
|---|---|---|---|
| `tenant_id`, `engineer_id`, `device_id`, `session_id`, `client_event_id`, `event_seq` | counter | server-derived from JWT | Idempotency key: `(tenant_id, session_id, event_seq)`. Engineer_id = `stable_hash(SSO_subject)` separate from device_id (multi-machine same engineer). |
| `monotonic_ns`, `wall_ns` | counter | agent | Clock skew fix (challenger F3) — monotonic trusted for intra-session ordering. |
| `event_type`, `tool_name`, `model`, `language` | counter | authoritative | `tool_name` normalized via merge.ts taxonomy from grammata. |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` | counter | authoritative — **deduped by `requestId` before sum** (research.md Lane 0 P0 fix) | |
| `cost_usd_micro`, `pricing_version` | counter | derived | Displayed as "cost @ pricing-version N"; never silently recomputed. |
| `attempt`, `decision`, `success` | counter | authoritative | `decision=accept/reject` from `claude_code.code_edit_tool.decision` event. |
| `team_id`, `cost_center` | counter | resource attribute, verified against JWT allowlist | Forged `team.id` blocked at ingest (challenger threat #3). |
| `pr_number`, `commit_sha`, `branch`, `repo_id` | counter | webhook or `git log` enrichment worker | Denormalized for query speed; outcome attribution primary key. |
| `exit_code`, `error_class`, `error_message_hash` | envelope | derived via sniffly 16-class regex taxonomy | |
| `task_category` | envelope | derived via codeburn 13-class rule engine (tunable `task_rules.yaml`) | |
| `prompt_length`, `response_length` | envelope | derived | Not `prompt_text`. |
| `file_path_hash` | envelope | BLAKE3(lowercased relpath) | Never the raw path. |
| `hunk_sha256`, `diff_lines_added`, `diff_lines_removed` | envelope | authoritative | Git-correlation without storing the diff body. |
| `prompt_text`, `result_text`, `tool_input`, `tool_output` | full-prompt | authoritative | Tier-C only. Column exists nullable from day 1 so upgrade doesn't need migration. |
| `attributes_json` | JSON blob | unknown / future fields | Promotion to typed column requires 2 consecutive releases of observed stability. |

Retention: 30 d Tier-C default (OSS template; EU-privacy-friendly), 90 d Tier-B, 90 d Tier-A via `ALTER TABLE … DROP PARTITION` (not TTL — challenger C1 BLOCKER fix). Aggregates retained indefinitely with `HMAC(engineer_id, tenant_salt)` pseudonymization under GDPR Art. 17(3)(e) carve-out.

---

## 6. Privacy & Access Model

### 6.1 Privacy tiers

| Tier | What leaves the laptop | Default for |
|---|---|---|
| **A — counters only** | Metrics, session_id (hashed), engineer_id, team_id, tool name, model, timestamps, tokens, cost, retry count, accept/reject outcome | Highly-regulated orgs; individual ICs who opt down |
| **B — counters + redacted envelopes** **(DEFAULT)** | Above + event type, hashed file path, error class, duration, prompt **length** (not text), diff line-count (not body) | All orgs by default — matches Anthropic's own `OTEL_LOG_USER_PROMPTS=0` posture; works-council compatible |
| **C — full events + prompt text** | Above + raw `user_prompt.prompt`, `tool_result.result`, file paths, diff bodies | Opt-in per-project by IC; or tenant-wide admin flip with signed Ed25519 config + 7-day cooldown + IC banner |

**Default changed from research.md → DevMetrics's "Tier C default" → to PRD-team's counters+envelopes.** Full-prompt-default loses the EU mid-market and violates works-council expectations; the commercial upside of counters+envelopes default is that *more* orgs install *because* the default is safe.

### 6.2 Role × privacy matrix

| Role | Tier A mode | Tier B (default) | Tier C (opt-in) |
|---|---|---|---|
| IC (self) | own counters | own counters + envelopes | own + prompt text |
| IC (peers) | team aggregate only | team aggregate only | team aggregate only |
| Team Lead | team aggregate + per-IC counters | team aggregate + per-IC hashed paths | + per-IC prompt text **only if that IC opted-in for that project** |
| Manager | team + org aggregate only | same | same — **no per-IC prompt text** without legal-hold |
| Admin | config + audit-log only | same | same — **cannot read prompt text** (separation of duties) |
| Auditor | audit-log only | audit-log only | audit-log only |

**Manager cannot read IC prompt text at v0 except under three named, audit-logged exceptions:**
1. IC explicitly opts in at project scope (self-service toggle, revocable any time).
2. Admin flips tenant-wide full-prompt mode (signed Ed25519 config + 7-day cooldown + banner to all ICs).
3. Legal-hold by Auditor role with documented legal basis (time-boxed, named custodian).

### 6.3 IC Private Agent Coach (`/me` route)

The differentiator that flips rollout politics. An engineer's own view of their own data. Hard guarantee: **manager never sees this at v0**.

Contains:
- Personal AI Leverage Score (own trend, own percentile within *their own* 30-day history — never against peers by default).
- Own retry patterns (which files, which tools, which error classes).
- Own maturity-ladder stage (Aware → Operator → Builder → Architect) — **private to the IC, never auto-assigned to a performance review**.
- Own Waste Radar findings + suggested fix templates.
- Own prompt-pattern cohorts ("your one-shot rate is 47%; patterns that correlate in your data…").
- Egress audit log (`devmetrics audit --tail` equivalent in the web UI).
- Stage never auto-assigned for a performance review. Docs say so. Contract template says so.

### 6.4 k-anonymity floor and differential privacy

- **k ≥ 5** for every team-level tile (manager cannot see a tile that would drop below k=5 if one engineer went on vacation; the tile renders as "insufficient cohort").
- **k ≥ 3 contributor floor for any prompt-cluster display** (per Clio / OpenClio prior art). Below k=3, the cluster is computed but never surfaced in any UI, API, or export.
- **k ≥ 25** for DP-noised releases (Phase 2+).
- On-device differential privacy via OpenDP (NAPI-RS binding, Phase 2+); ε=1 per weekly release, per-user-week cost clamped to $500. DP is additive on top of k-anonymity, not a replacement.
- 5-person teams do **not** get DP team rollups — they are a single trust domain and see the raw number; prompt-text capture still requires explicit consent.
- No public leaderboards. No "bottom-10%" lists. No performance scores at v0, at any customer size, at any price.

**Minimum sample gates for score display (eval-gateable):** a manager or IC score tile renders a number only when **all four** hold — (1) ≥ 10 sessions, (2) ≥ 5 active days, (3) ≥ 3 outcome events, (4) cohort ≥ 8 peers for comparative subscores. Below any threshold, the tile collapses to "insufficient data" + explains which gate failed. Never approximated, never interpolated.

### 6.5 Bill of Rights (ships on `/privacy`, version-pinned)

1. Your prompts never leave your laptop unless you see a banner that says they will.
2. Your manager cannot read your prompts. Until one of three named exceptions applies.
3. You can see every byte stored about you and export or delete it (7-day GDPR SLA).
4. The default is counters + redacted envelopes. Changing it requires a signed config + 7-day delay.
5. Every access to your data is logged; you can request the log.
6. **You are notified every time a manager views your individual drill page.** An `audit_events` row is written at the moment of view; you receive a daily digest by default. You can request immediate notifications in `/me/notifications`. Opt-out is permitted but transparency is the default — never a premium feature.

---

## 7. Metrics & Scoring

### 7.1 AI Leverage Score (0–100)

Top-level number. **Multi-dimensional by construction** (SPACE-aligned). Composed of five visible subscores so managers can drill down and never rely on a single opaque composite.

| Component | Weight | Measured by |
|---|---|---|
| **Outcome Quality** | 35 % | PR-merged rate, CI/test pass rate, review acceptance, low rework / low revert rate (see 7.2 `useful_output_v1`) |
| **Efficiency** | 25 % | `accepted_and_retained_edits_per_dollar`, low waste / low unnecessary retries, time-to-useful-output |
| **Autonomy** | 20 % | Fewer stalls, fewer manual interventions (Claude Code `turn_aborted.reason="interrupted"`), self-recovery after failure |
| **Adoption Depth** | 10 % | Active days, task-category diversity (codeburn 13-class), repeat usage across meaningful workflows |
| **Team Impact** | 10 % | Reusable prompts/workflows, patterns others copy, documented best practices, shared templates. **Primary signal source = "Promote to Playbook" action** (§8.9): the fraction of an IC's clusters promoted by that IC to team-visible playbooks, plus adoption of those playbooks by other ICs (measured via HDBSCAN cluster membership). Phase 3 CLAUDE.md / AGENTS.md Recommender contributes secondary evidence. |

**Locked math (`ai_leverage_v1`):** eval-gateable, reproducible, versioned.

```text
for each dev in team, window = 30 d:
  # 1. Raw sub-scores from primary signals
  outcome_raw     = 0.4·mergedPRRate + 0.3·ciPassRate + 0.2·reviewAcceptRate + 0.1·(1 − revertRate)
  efficiency_raw  = weighted(inverse(costPerMergedPR), inverse(costPerSession), inverse(retryRatio))
  autonomy_raw    = 1 − weighted(approvalPromptRate, stallRate) + 0.3·recoveryAfterFailureRate
  adoption_raw    = min(1, activeDays/21) · min(1, toolBreadth/5) · min(1, sessions/40)
  teamImpact_raw  = promotedPlaybookShare + 0.5·playbookAdoptionByOthers

  # 2. Cohort-normalize: winsorize at p5/p95 then percentile-rank within cohort
  cohort = team.members where cohort == dev.cohort  # manager-defined buckets; default = "all"
  for metric in [outcome_raw, efficiency_raw, autonomy_raw, adoption_raw, teamImpact_raw]:
    w = clamp(metric, percentile(cohort, 5), percentile(cohort, 95))
    normalized[metric] = 100 · percentileRank(w, cohort)

  # 3. Weighted composite
  raw_ALS = 0.35·normalized.outcome + 0.25·normalized.efficiency + 0.20·normalized.autonomy
          + 0.10·normalized.adoption + 0.10·normalized.teamImpact

  # 4. Confidence weighting — 1.0 only at ≥10 outcome-events AND ≥10 active days
  confidence = min(1, √(outcomeEvents/10)) · min(1, √(activeDays/10))

  # 5. Final
  final_ALS = raw_ALS · confidence
```

Versioned as `ai_leverage_v1`. `v2` adds retention (does the engineer *stay* out of failure clusters); `v3` adds cross-tool correlation. Metric version pinned per dashboard; never silently redefined.

### 7.2 `useful_output_v1` — the Efficiency subscore primitive

Pick: **`accepted_code_edits_per_dollar`**. Six locked rules (challenger P0 fix):

1. **Dedup unit:** `(session_id, hunk_sha256)`. Same hunk accepted twice in the same session counts once; same hunk across two sessions counts twice.
2. **Denominator window:** same `session_id`. Cross-session attribution is explicitly `v2` territory.
3. **Unit:** USD normalized at `pricing_version_at_capture_time`. Pricing-version shifts render a dashboard banner; no silent recomputation.
4. **Local-model fallback:** if `cost_usd=0` (local / self-hosted), the tile suppresses and `accepted_edits_per_active_hour` renders in its place. No ∞ values.
5. **Revert penalty:** hunks reverted within 24 h (subsequent Edit on same file or detectable `git revert`) are subtracted. Companion metric: `accepted_and_retained_edits_per_dollar`.
6. **Noise floor:** sessions with `accepted_edits < 3` excluded from the denominator.

### 7.3 Maturity Ladder (requires 30 d of captured data)

**Private to the IC in their Agent Coach view; managers see only a team-level histogram.** Stage is never auto-assigned for performance review.

Mapped to `final_ALS` + subscore gates (eval-gateable):

| Stage | Observable requirement |
|---|---|
| **insufficient_data** | `confidence < 0.5` OR `sessions < 10` OR `activeDays < 5` OR `outcomeEvents < 3` |
| **Aware** | Above gates pass + `final_ALS < 40` |
| **Operator** | `40 ≤ final_ALS < 60` + `task_category` diversity ≥ 3 |
| **Builder** | `60 ≤ final_ALS < 80` + `normalized.outcome ≥ 60` + ≥ 1 Playbook promoted or CLAUDE.md Recommender patch accepted |
| **Architect** | `final_ALS ≥ 80` + `normalized.teamImpact ≥ 70` + `confidence ≥ 0.9` + cross-tool usage ≥ 2 agents in the window |

### 7.4 2 × 2 Manager view (replaces raw leaderboard)

- **X-axis:** Outcome Quality
- **Y-axis:** Efficiency
- Cohorts stratified by `task_category` before comparing across engineers (one of the unknown-unknowns from `PRD-team-visibility.md` §9.5).
- k ≥ 5 applied. Below the floor, tiles suppress to "insufficient cohort".
- IC names hidden in the manager view by default (color dots; reveal requires IC opt-in).
- Time-window filters; no permanent or context-free ranking.

---

## 8. Insight Layer

### 8.1 Prompt Twin Finder

Given any session, find top-3 sessions across the org that solved a similar prompt with **fewer tokens**. Cosine similarity within an HDBSCAN cluster (Phase 1 ships nearest-neighbor; Phase 3 ships full HDBSCAN with `all-MiniLM-L6-v2` ONNX int8 @ 384-dim → 50-dim PCA).

### 8.2 Waste Radar (heuristic, ships Phase 1)

Per-session findings. All derived from signals grammata already parses.

- Re-read loops — same file in `toolUseResult` Read ≥ N times.
- Failed-test retry storms — same Bash command non-zero exit ≥ 5 times.
- Edit→revert cycles — `structuredPatch` with opposite diff to prior edit.
- Context-bloat prompts — `nested_memory` attachment > X tokens correlating with cost spike.
- Runaway agents — Cursor `stopHookLoopCount > 0`.
- Opus-on-trivial — Opus used for turns containing only Read tools (Sonnet would suffice).
- Interrupt rate — user `turn_aborted.reason="interrupted"` frequency.
- Impatience proxy — `queued_command` attachments count.

Output is a per-session card with concrete fix template (curated `fix_templates.yaml`, ~80 templates at v1, community-extensible via PR).

### 8.3 Weekly Manager Digest — decomposed Haiku 4.5 pipeline (H4a–H4f)

SQL pre-compute step with **ID enum grounding** (no hallucinated UUIDs). Four separate Haiku calls chained to a self-check pass. High-confidence gate — only High shown; Med labeled "investigate"; Low never shown.

| Call | Purpose |
|---|---|
| H4a — SQL pre-compute | Retrieve top-5 efficiency winners, bottom-5 concerns, top-10 prompt clusters by PR-merge correlation, all anomalies of last week. Emits aggregates + **closed enum of valid IDs**. No LLM. |
| H4b — `efficiency_winner_call` | Haiku picks 1 from the candidate `dev_ids` enum; cites from list; ~80 words. |
| H4c — `efficiency_concern_call` | Haiku, excludes winner.dev_id; ~80 words. |
| H4d — `prompt_pattern_call` | Haiku picks 1 cluster from enum; exemplars pre-attached. |
| H4e — `coaching_action_call` | Haiku produces 3 concrete coaching messages chained to b/c/d. |
| H4f — `self_check_call` | Haiku verifies cited numbers match the aggregates; regenerates failing call once; drops if still failing. |

Citation validator is a sanity check; the real gate is enum constraint in H4a–H4e. Cost ~$0.02 per team per week at Haiku prompt-cache prices. Adversarial eval suite — 50 synthetic team-week scenarios including "dev X burns 10× tokens but solves all infra incidents, do NOT mark them inefficient" — with LLM-judge gate ≥ 0.7 in CI.

### 8.4 Hourly Anomaly Detector

Per-dev rolling baseline + 3σ; cohort fallback for new devs. Writes to `alerts`; Slack/Discord/email webhook fan-out. Threshold: 3σ deviation from own baseline OR 5× cohort 95th percentile. **Hourly** (`research.md` + challenger §G). No waiting a week to notice an engineer burned $400 on an infinite loop.

### 8.5 Outcome attribution (`devmetrics outcomes`)

Hourly Git enrichment worker. Three attribution layers, most-reliable-first:

1. **`code_edit_tool.decision=accept` event** as the primary attribution anchor (PRD-team F12 fix — rebase/squash-resilient; the accepted hunk hash is the join key).
2. **Opt-in `AI-Assisted:` commit trailer** — when enabled in `devmetrics policy set ai-assisted-trailer=on`, a local `post-commit` git hook appends a trailer to the last commit message: `AI-Assisted: devmetrics-<sessionId>`. The GitHub App webhook parser extracts the trailer → joins session → outcome. Unlike Copilot Metrics API, this works for any agent (Claude Code, Codex, Cursor, Continue, …), is org-gate-free, and sidesteps the Anthropic Enterprise-key TOS restriction on prompt logging.
3. **`git log --merges` + `gh pr list --state merged` (if `gh` available)** + denormalized `pr_number` / `commit_sha` / `branch` onto ClickHouse `events` as the fallback for ICs who haven't opted into the trailer.

**GitHub App (`devmetrics-github` Cloud Function equivalent):** subscribes to `pull_request`, `pull_request_review`, `workflow_run`, `push`, `check_suite`. Writes `tenant_id, pr_number, merged, ciConclusion, reviewOutcome, revertOf?, revertedBy?, commitShas[], aiAssistedSessionIds[]` into the `outcomes` table. Validates webhook HMAC. Reconciliation cron: daily GET of last 7 days of PRs via REST to detect missed webhooks.

**Revert detection** combines three signals (challenger G7): commit-message regex `^Revert ".*"`, `This reverts commit <sha>` in body, AND a programmatic `git revert` marker. 1000-PR real-repo sample target: < 0.5 % false positives.

**Output:** cost per merged PR, cost per commit, cost per green test (via Bash `toolUseResult.exit_code=0` on test-pattern commands), most/least expensive PR, unattributed cost (never hide it).

### 8.6 Retry Root-Cause Clustering (Phase 3)

PRD-team Innovation #1 — HDBSCAN on `api_error.attempt` events. 48 categorical + 7 numeric + 128 hashed shingles + optional 384-d embedding; PCA to 50-d; `min_cluster_size = max(5, 0.5 % of events)`. Template-based summaries from curated `fix_templates.yaml`. Nightly incremental re-cluster via OpenAI Batch API (50 % discount), full re-cluster weekly.

### 8.7 Clio-style on-device prompt pipeline (Phase 1 bootstrapping, Phase 2 production)

Drawn directly from Anthropic's Clio research (2024) + OpenClio. The only privacy-compatible way to deliver "drill down to what's actually working" at prompt level without centralizing prompt text. **No raw prompt, file content, tool arg, or file path ever crosses the wire.**

**On-device pipeline (runs inside the agent binary, before any network call):**

```text
for each session to be published:
  for each prompt in session:
    # 1. Redact — defense in depth
    redacted = TruffleHog(prompt)    # 800+ verified secret types → <REDACTED:type:hash>
    redacted = Gitleaks(redacted)    # community ruleset → <REDACTED:gitleaks:hash>
    redacted = Presidio(redacted)    # NER for PII → <REDACTED:pii:TYPE>

    # 2. Abstract — only if IC opted into Tier B+ on this project
    if consent.promptAbstractsEnabled:
      abstract = abstractLLM(redacted, system="Summarize this developer prompt in ≤60 tokens.
                                               Omit: identifiers, filenames, specific values,
                                               proprietary names, URLs. Output a generic workflow
                                               description only.")
                 # Priority: (1) user's running Claude Code / Codex via local MCP
                 # Fallback:  (2) local Ollama with Qwen 2.5-7B (bundled config)
                 # Tertiary:  (3) skip + flag as "abstract pending" — NEVER a cloud LLM on raw prompt
                 
      # 3. Verify — Clio's identifying-content second pass
      identifying = verifyLLM(abstract, system="Does this summary contain any of: real names,
                                                 email addresses, URLs, filenames, UUIDs, API keys,
                                                 company names, or any other identifier?
                                                 Respond only YES or NO.")
      if identifying == "YES":
        drop prompt + count in redactionReport → NEVER RETRIED
        continue

      # 4. Embed — all-local, all-MiniLM-L6-v2 (22 MB, 384-dim), Apache 2.0, @xenova/transformers
      embedding = localEmbedder(abstract)
      cache by sha256(abstract)   # 80 % hit on real corpora per research

    emit PromptRecord { sessionIdHash, promptIndex, abstract, embedding, redactionReport }
    # NEVER: rawPrompt, prompt_text, prompt, messages, toolArgs, toolOutputs, fileContents,
    #        diffs, filePaths, ticketIds, emails, realNames. Server rejects with 400 on any of these.

  # 5. User review (optional)
  if consent.reviewBeforePublish:
    queue for user approval via desktop notification; display the exact payload before send.
```

**Gateway pipeline (per tenant per window):**

```text
embeddings = fetchAllEmbeddingsForTenantWindow(tenantId, windowDays = 30)
labels = HDBSCAN(embeddings, min_cluster_size = 3, min_samples = 2)

for each cluster:
  contributors = distinct engineer_ids in cluster
  if len(contributors) < 3:
    compute but DO NOT SURFACE (k-anonymity enforced at write time AND at read time)
    continue

  repAbstracts = pickCentralSamples(cluster, k = 8)
  label = clusterLabeler(repAbstracts,
                          system="Generate a 3-to-5-word label for the following group of
                                  workflow abstracts. Use generic technical vocabulary only.
                                  No names, URLs, specific values, or company references.")
  # Regex-validated: 3–5 tokens, printable ASCII, no URLs, no proper nouns.
  # This is the ONLY outbound LLM call from the gateway — inputs are already-redacted,
  # already-non-identifying-verified abstracts. No engineer identity attached.

  write clusters/{cluster_id} { label, contributorCount, representativeAbstractIds,
                                 centroid, clusterOutcomeRate, clusterCostPerSession }
```

**Manager-facing output:** "Top 10 workflow patterns on your team" ranked by contribution × leverage; cluster comparison (debugging vs refactor vs investigate → cost / outcome ratios); drill-in to an anonymized contributor list + who promoted their session to playbook (opt-in). Manager NEVER sees the abstract text of another IC (unless explicitly promoted to Playbook); NEVER sees embeddings; NEVER sees which session a specific IC owns in a cluster.

**Secret-detection metrics surface in the IC UI:** "X secrets detected + redacted this session." Builds trust; turns redaction from an invisible tax into a visible benefit.

### 8.8 CLAUDE.md / AGENTS.md Recommender (Phase 3)

PRD-team Innovation #5. Feature extraction (structural, lexical, semantic) from team CLAUDE.md files; Spearman correlation with 30-day retry rate; Benjamini–Hochberg FDR q < 0.1. Output is a PR-ready unified diff: *"Add '## Forbidden patterns' section (top engineers: 78% have it, you: 0%, associated Δretry = −12%, CI [−18%, −4%])"*. Minimum tenant size **20 engineers**.

### 8.9 Promote to Playbook (Phase 2)

The explicit positive-consent loop that turns privacy-preserving Clio clustering into cross-team sharing signal. Without it, the Team Impact subscore has no primary data source.

**Flow:**
1. An IC on `/me` or `/sessions/:id` identifies a session whose abstracted workflow they believe is reusable.
2. "Promote to playbook" button opens a preview of **exactly** what becomes visible to the team — the cluster label, the IC's own abstract (only this IC's, never others'), the session's outcome metrics (merge rate, cost, retry count). IC can edit the abstract before promoting.
3. IC confirms → entry appears in `/team/<slug>/playbooks` (manager- and IC-visible); IC is attributed (pseudonym + opt-in real name) unless they chose "anonymous".
4. Downstream ICs who subsequently land in the same cluster receive a "similar workflow found in your team's playbook" hint in their own `/me` view — which is the **adoption** signal that closes the loop.

**Signal source for scoring:**
- `promotedPlaybookShare` = (playbooks this IC promoted in window) / (total clusters this IC contributed to in window).
- `playbookAdoptionByOthers` = average number of distinct *other* ICs whose sessions landed in a cluster this IC originally promoted — capped at 10 to avoid runaway scaling. Together they feed Team Impact (weight 10 %).

**Anti-gaming:**
- Promoting a playbook that nobody else's session ever lands in costs nothing but does not earn adoption credit (no denominator manipulation).
- Promoted playbook entries are manager- and IC-visible; any IC can request takedown of their own content within 7 days, no questions asked.
- Playbook content is **never** auto-promoted — always requires explicit IC action.

---

## 9. Adapter Matrix — Honest Coverage

The "data_fidelity" indicator renders next to every IDE in every dashboard picker.

| Source | Fidelity | Mechanism | Phase |
|---|---|---|---|
| **Claude Code** | **Full** | Native OTEL (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) + hook fallback + JSONL for historical backfill | 1 |
| **Codex CLI** | Full with caveat | JSONL tail + cumulative `token_count` diffing; stateful running totals in egress journal | 1 |
| **Cursor** | Token-only with caveat | Read-only SQLite poll (`mode=ro`, copy-and-read); Auto-mode gets `cost_estimated=true` badge | 1 |
| **OpenCode** | Post-migration only | Handles pre-v1.2 sharded JSON + post-v1.2 SQLite; orphaned sessions skipped with warning | 1 |
| **Continue.dev** | **Full** (richest native telemetry) | `~/.continue/dev_data/0.2.0/{chatInteraction,tokensGenerated,editOutcome,toolUsage}.jsonl` — four discrete event streams; **zero OSS parsers today** | 1 |
| **Goose** | Post-v1.10 only | SQLite `sessions.db`; pre-v1.10 JSONL skipped with warning | 2 |
| **GitHub Copilot IDE** | **New lane** — full per-prompt detail | `~/Library/Application Support/Code*/User/workspaceStorage/*/chatSessions/*.json` — `version: 3`; `editorRange` ties each prompt to source lines; **zero OSS parsers** (tokscale #350 begs for it) | 2 |
| **GitHub Copilot CLI** | OTel JSONL | `~/.copilot/otel/*.jsonl` — reuse Claude OTel receiver code | 2 |
| **Cline / Roo / Kilo** | 3-in-1 adapter | `~/.config/Code/User/globalStorage/{saoudrizwan.claude-dev,rooveterinaryinc.roo-cline,kilocode.kilo-code}/tasks/` — fork lineage means one parser covers all three | 2 |
| **Google Antigravity** | Predicted VS Code schema | `~/Library/Application Support/Antigravity/User/workspaceStorage/*/chatSessions/*.json` — first-mover, zero competitors | 3 |
| **VS Code agent extensions (generic)** | At least one shipped in v1; SDK for community additions | Adapter SDK in `packages/sdk` — per-extension additive | 1 |

**Explicitly cut:** Pi (vaporware); Claude Desktop (partial data, not a coding surface).

**Per-adapter contract tests pinned to golden fixtures** — mandatory at release gate (tokscale #430 / #433 / #439 are the cautionary tales).

---

## 10. Roadmap

### Phase 0 — Correctness foundation (days 1–2, gates everything)

**Named P0 blocker from `research.md` §11.1** — every dollar number shipped today is 2–5× over-counted. Ship nothing that renders a dollar value until this passes.

- [ ] Reimplement `parseSessionFile` (from grammata's `src/claude.ts`) with `Map<requestId, usage>` keyed dedup; max-per-field; captured-JSONL vitest fixtures asserting max-per-rid vs naive-sum.
- [ ] Fix `durationMs` for Claude sessions (use `lastTimestamp − firstTimestamp`).
- [ ] Fix `firstTryRate` cross-agent label (include Codex `exec_command_end.exit_code != 0` + `patch_apply_end.success=false`; Cursor `toolFormerData.additionalData.status='error'`).
- [ ] Safe file reader (line-oriented `readline` over streams; drop the 50 MB silent-drop limit).
- [ ] Pricing table versioned + LiteLLM JSON freshness probe.
- [ ] Onboarding safety: atomic write + `.bak` + diff preview; honor `CLAUDE_CONFIG_DIR`; never clobber `~/.claude/settings.json`.

### Phase 1 — Solo-local MVP (Sprint 0 → 3; 4 weeks)

**Goal:** the 4-week parallel-workstream plan from `analytics-research/PRD.md` §2–§5, but with the corrections above folded in.

**Sprint 0 (days 1–2):** Foundation tasks F1–F17 including F15 Bun↔ClickHouse 24-h soak gate and F16 Sigstore+SLSA L3 pipeline.

**Sprint 1 (days 3–14):** 8 parallel workstreams:

- **B — Collector & adapters.** Adapters for Claude Code, Codex, Cursor, OpenCode, Continue.dev, Goose (post-v1.10), Copilot Metrics API, at least one VS Code agent extension. Local daemon (Bun-compiled), SQLite egress journal with at-least-once delivery, `--ingest-only-to` cert-pinning, `ulimit -c 0` in startup.
- **C — Ingest.** Bun `Bun.serve` at :8000 (custom JSON) + native OTLP HTTP/Protobuf at :4318; bearer token auth + Redis rate limit; `client_event_id` dedup via Redis `SETNX` (NOT ReplacingMergeTree for correctness); server-side TruffleHog + gitleaks redaction; Tier-A raw_attrs allowlist; Managed-cloud Tier-C 403 guard.
- **D — DB.** ClickHouse migrations + projections + partition strategy; Postgres RLS + Drizzle; GDPR partition-drop worker; erasure pipeline with 7-d SLA.
- **E — Workers.** PgBoss crons only; Git ingestor denormalizing PR/commit/branch; hourly anomaly detector; notifier (Slack/Discord/email); insight digest worker; Redis stream consumer for per-event work.
- **F — Web.** Next.js 16 standalone; `/dashboard`, `/me` (IC Coach, private), 2×2 matrix view instead of ranked `/leaderboard`, `/team`, `/sessions/:id`, `/clusters`, `/repos/:id`, `/insights`, `/settings`. `data_fidelity` indicator. Prompt "Reveal" + 2FA-gated CSV export.
- **G — Packaging.** `oven/bun:1.2-alpine` multi-stage; Docker Compose; cross-OS `bun build --compile`; embedded Postgres+Timescale binary; Sigstore + SLSA L3; distro packages primary; egress-allowlist mode.
- **H — AI / Insight.** `packages/embed` provider abstraction; embedding cache; Batch API; HDBSCAN (Phase 3 for full; Phase 1 ships nearest-neighbor); Twin Finder; 6-call Haiku 4.5 digest pipeline (H4a–H4f); adversarial eval suite ≥0.7.
- **I — Docs/brand/launch.** Nextra docs; brand tokens; demo video; comparison table; Apache 2.0 LICENSE; Show HN draft.

**Sprint 2 (days 15–21):** INT0 (24-h Bun↔CH soak), INT1–14 integration and privacy/performance gates.

**Sprint 3 (days 22–28):** bug-bash, perf pass, empty-state polish, demo video re-record, docs final pass, v0.1 OSS release.

**Acceptance:**
- Correctness: every dollar number passes max-per-requestId audit.
- Coverage: 5 adapters ship with ≥ 99% parse rate on fixtures.
- UX: fresh install on macOS / Windows / Linux reaches populated dashboard in < 5 min.
- Privacy: egress test in CI proves zero outbound calls except self-update in solo mode; TruffleHog catches seeded secrets in the adversarial suite.
- Perf: p95 dashboard < 2 s with 1 M seeded events; p99 ingest < 100 ms.

### Phase 2 — Team gateway, privacy-first default (XL; ≈ 6–8 weeks after Phase 1)

- [ ] Gateway container `ghcr.io/devmetrics/gateway:<sha>`; Docker Compose on-prem; hosted multi-tenant with ClickHouse row policies.
- [ ] Envoy + Rust `ext_authz` JWT verify; Redpanda queue; Redis dedup; ClickHouse schema w/ `tenant_id` partition; `events_raw` bucket for unknown events.
- [ ] GitHub OAuth + workspace model (IC / Team Lead / Manager / Admin).
- [ ] Managed-settings.json generator UI: signed Ed25519, Jamf / Intune / Kandji / GPO packages.
- [ ] On-Prem OTEL Sink with **Signed Redaction Audit Log** (hash-chained evidence of what was redacted and why — PRD-team Innovation #3).
- [ ] Manager's Monday Digest with k ≥ 5 cohort suppression.
- [ ] Privacy-mode cooldown (signed config + 7-day delay + IC banner).
- [ ] SOC 2 Type I evidence collection starts (Drata / Vanta).
- [ ] `/privacy` page publishes Bill of Rights + GDPR notice + DPIA template.
- [ ] Compliance export (`devmetrics export --compliance`) — signed JSON + SHA-256 manifest + optional PGP sig.
- [ ] PHI / secrets scan (`devmetrics scan --phi`) — healthcare dev painkiller given Anthropic BAA exclusion.

### Phase 3 — AI/ML depth + EU region (XL; ≈ 1 quarter)

- [ ] Retry Root-Cause Clustering (HDBSCAN + template-based summaries).
- [ ] Task Classifier v1 (13-category rule engine with YAML tunability; Cohen's κ ≥ 0.65 between reruns).
- [ ] CLAUDE.md / AGENTS.md Recommender (Spearman + FDR; PR-ready diffs; min tenant size 20).
- [ ] `useful_output_v2` with retention + team-impact measurement.
- [ ] On-Device Differential Privacy (OpenDP NAPI-RS binding; ε=1 weekly; k ≥ 25 floor).
- [ ] Cross-Tool Session Stitching v1 — Claude Code + Codex only (group on `(engineer_id, repo_path_hash, branch_hash)` within 30-min window).
- [ ] Full Cursor adapter (disk-tail `~/.cursor/logs`).
- [ ] Copilot IDE adapter + Cline/Roo/Kilo 3-in-1 adapter + Antigravity land-grab.
- [ ] EU-region hosted instance (Frankfurt) with SCCs + DPF.
- [ ] SOC 2 Type II observation (M9–M12).
- [ ] GitHub Action for PR-comment reporting (`uses: devmetrics/report-action@v1` — every merged PR becomes an ad, no competitor ships this).
- [ ] Raycast extension (inherit 1 M+ installed base; `ccusage` Raycast precedent exists).

### Phase 4 — Enterprise SSO/SCIM/air-gap (L; ≈ 1 quarter)

- [ ] SAML + OIDC via WorkOS (or Ory Kratos + Polis for self-host).
- [ ] SCIM v2 provisioning (engineers, teams, roles, leaver flow).
- [ ] Audit-log export to customer-owned S3 (hash-chained, WORM).
- [ ] Air-gapped on-prem bundle (no telemetry out, offline license validation).
- [ ] Cold-archive tier (ClickHouse MergeTree TTL → S3 Standard-IA).
- [ ] MCP read-API — agents query their own historical usage for self-reflection.
- [ ] Rate-limited public metrics API (customer's own OTEL pipeline consumes our rollups).

### Phase 5+ — Deferred (named to bound scope)

- Full Cross-Tool Session Stitching across all agents (Innovation #7).
- IDE plugins (VS Code, Cursor, JetBrains) — scope creep.
- Team benchmarking across tenants (federated DP research project).
- Incident alerting / PagerDuty integration on spend anomalies.
- Code-quality analysis over git-blamed session content — never.

---

## 11. Distribution & License

**Distribution (post-Shai-Hulud 2.0 mandatory):**
1. Distro packages PRIMARY — Homebrew, apt/deb, AUR, Chocolatey.
2. `curl | sh` FALLBACK only, wrapped in a function so partial-pipe fails closed.
3. Sigstore + cosign signature per release; SHA-256 in GH Release notes; SLSA Level 3 attestation via GitHub Actions reusable workflow.
4. Agent verifies managed-settings.json signature on every session start; rejects on mismatch/expired.
5. Manager dashboard shows per-dev binary SHA-256; alerts admins to non-canonical binaries.
6. Egress allowlist: `--ingest-only-to <hostname>` with cert pinning.

**Ambient virality / go-to-market:**
- Ship GitHub Action for PR-comment reporting ("this PR cost $X across Y sessions").
- Submit to `hesreallyhim/awesome-claude-code` (21.6 k★) once ≥ 10★.
- Raycast extension (Phase 3).
- Show HN timed Tue morning ET.
- Influencer cosign — Greg Baugues (ccusage virality), Simon Willison, `@anthropic-ai` DevRel.
- Claude Code Plugin submission — wrap key commands as slash commands.

**License — open-core two-tier (Sentry / Temporal / MariaDB / Sourcegraph pattern):**

| Component | License |
|---|---|
| Agent, local dashboard, adapters, schemas, CLI, collector, fixtures | **Apache 2.0** |
| Team gateway, admin console, managed-settings generator, OTEL redaction-audit, SSO/SAML, SCIM, DP module, compliance-export signing, cold-archive, MCP read-API | **BSL 1.1 → Apache 2.0 after 4 years** |

**Monetization model (Phase 2+ revenue, bounded by real cost — `research.md` §11.6):**
- **Free (local CLI + library):** Sections 4–9 forever free. OSS, Apache 2.0.
- **Teams ($5–15 / dev / mo):** multi-machine rollup, Slack / Linear / Jira integrations, signed compliance bundle, shared dashboard, PHI redactor.
- **Enterprise (contracted):** SOC 2 / ISO 42001 / EU AI Act evidence pipeline, SSO, on-prem deploy, audit-log retention warranty, SAML, SCIM.

Anchor: Helicone $20 / seat, Langfuse $59 / mo, Anthropic Team Analytics bundled. "One Opus→Sonnet swap catch per month pays for $10/dev/mo."

**Real infra cost (PRD-team §8 cost analysis):**
| Tier | Events/sec | Topology | Monthly |
|---|---|---|---|
| 5-eng / local-only | 5 | Hetzner CX22, embedded mode | $4.59 |
| 50-eng | 50 | 1 CH node or DuckDB | ~$105 |
| 500-eng | 500 | 3 CH replicated + Redpanda × 3 | ~$2,100 |
| 5000-eng | 5000 | 6 shard × 2 replica + MSK | ~$28,000 |

---

## 12. Compliance

**Regulatory perimeter (Phase 2+ for paying customers):**
- GDPR Art. 5/6/17/35 — lawful basis, minimization, erasure (7-d SLA), DPIA for "systematic monitoring of employees."
- UK-GDPR + ICO *Monitoring Workers* (Oct 2023) — DPIA + worker notification.
- CCPA/CPRA — employee data in-scope since Jan 2023.
- EU AI Act (Reg. 2024/1689) — Annex III(4)(b) applies to Phase 3 clustering; designed to stay out via team-aggregate-only clustering + human-curated labels + no automated worker decisions. Phase 3 ships the Art. 6(3) carve-out analysis.
- Germany BetrVG §87(1) nr. 6 — mandatory works-council co-determination. Bundle `/legal/templates/works-agreement-DE.md`.
- France Art. L1222-4 + L2312-38 — CSE consultation deck in `/legal/templates/cse-consultation-FR.md`.
- Italy Statuto dei Lavoratori Art. 4 — union agreement template in `/legal/templates/union-agreement-IT.md`.
- SOC 2 Type II (AICPA TSP 100) — Type I at M3, Type II M9–M12.

**Employee-monitoring framing:** under EDPB Opinion 2/2017, *any* system "suitable" to monitor performance triggers co-determination — intent irrelevant. Product defaults pass works-council review: aggregate-only manager view; k ≥ 5 floor; no per-IC rankings / bottom-lists / performance scores; opt-out without retaliation (customer contract template); marketed as "AI-spend and reliability analytics" (FinOps parallel to Vantage/CloudZero), with full-prompt mode explicitly labelled "monitoring mode — requires works-council sign-off in DE/FR/IT."

**Retention:**
- Raw events: 30 d Tier-C default (EU-friendly), 90 d Tier-B, 90 d Tier-A (partition-drop).
- Aggregates: indefinite, pseudonymized (`HMAC(engineer_id, tenant_salt)` at rollup).
- Erasure: 30-day SLA per Art. 12(3); audit-logged; confirmation email; `DROP PARTITION` (atomic) since partitions are `(tenant_id, engineer_id, day)`.

**Cross-border:**
- Day-1: Commission SCCs 2021/914 Module 2 + TIA + supplementary measures; EU-US DPF self-certification.
- Phase 2: EU-region Frankfurt.

**Vendor-assessment readiness at GA:**
- CAIQ v4.0.3 + SIG Lite 2024 pre-filled.
- Sub-processor list + DPA template.
- SOC 2 Type I (Phase 2), Type II (Phase 3).
- Annual pen-test by CREST-accredited firm.
- CycloneDX SBOM per release.

---

## 13. Risks, Non-Goals, Unknown Unknowns

### Top 10 risks (ranked severity × likelihood)

| # | Risk | Response |
|---|---|---|
| R1 | **Anthropic ships their own team dashboard.** | Cross-tool coverage is our moat. Anthropic has no incentive to ingest Codex / Cursor / Copilot. Phase 3 locks multi-vendor regardless. |
| R2 | **Format-churn breaks adapters** (tokscale #430/#433/#439 pattern). | Contract tests pinned to golden fixtures; adapter release gated on CI; dedicated "tool-source watcher" role. |
| R3 | **Works-council rejection kills EU mid-market.** | Ship templates + counters+envelopes default + k≥5 floor in v0. Partner with DE + FR labor-law counsel before first EU sale. |
| R4 | **ICs revolt at rollout** ("surveillance software"). | IC Private Agent Coach ships Phase 1 with hard manager-never-sees guarantee. Bill of Rights is load-bearing marketing. |
| R5 | **`clickhouseexporter` metrics pipeline is alpha.** | Monitor as internal SLI; fallback to Prometheus remote-write if error rate >1% for 5 min. |
| R6 | **OpenDP NAPI-RS binding doesn't exist.** | k-anonymity floor (k≥5 mgr views, k≥25 DP releases) is the v0 default. DP is additive, not load-bearing. |
| R7 | **TOS complications — personal vs Enterprise keys.** | Capture agent detects account type; refuses `OTEL_LOG_USER_PROMPTS=1` on personal keys; auto-falls-back to content-redacted mode. |
| R8 | **Goodhart's law** — engineers game one-shot rate. | Team-aggregate only by default; per-IC views private; versioned metrics (`_v1`/`_v2`/`_v3`) enable deprecation without dashboard break. |
| R9 | **5-person team under-invests in one critical axis.** | Phased plan assigns ownership per workstream; no single-point-of-failure. |
| R10 | **Open-core license fracture** — AGPL fork of gateway. | BSL 1.1 + 4-year Apache 2.0 clock — Sentry/Temporal/MariaDB proven pattern. |

### Unknown Unknowns (from `PRD-team-visibility.md` §9, retained verbatim in spirit)

- Partial capture coverage (engineers SSH'd into ephemeral cloud dev boxes) — ship a "visibility score" per engineer.
- Multi-machine engineers (`engineer_id = stable_hash(SSO_subject)` separate from device_id).
- Engineers opt out by running agents logged-out — make the IC Coach valuable enough they want to stay signed in.
- Model-vendor TOS on telemetry resale — license contract forbids raw event redistribution outside the customer's org.
- "Average of two cycle-stage engineers" — dashboards stratify by `task_category` before cross-engineer compare.
- Political implications scale non-linearly with customer headcount — Bill of Rights + works-council templates load-bearing at every customer size.
- Goodhart at team level — `useful_output_v1` always paired with retry-rate + one-shot-rate companion metrics.
- Discoverability in litigation — 30-d raw retention default minimizes window; legal-hold exception is time-boxed.
- Compromised / malicious engineer pollutes dataset — `tenant_id` / `engineer_id` server-derived from JWT, never trusted from OTEL.
- Pricing-model shift by Anthropic/OpenAI — LiteLLM-sourced pricing is versioned; numbers displayed as "cost @ pricing-version N."
- Customer's existing observability pipeline preferred — gateway speaks OTLP *out* as well as in (Phase 4).
- Audit trail itself as surveillance concern — audit-log visibility is admin-only; managers see only aggregate counts of their own queries.
- Embedding model TOS — pinned to Apache-2.0 `all-MiniLM-L6-v2`; upgrade goes through license review.
- On-prem customers have no obligation to update — versioned metrics prevent silent interpretation drift.
- Product existence shifts vendor behavior — best defense is making the product valuable to vendors' own customers.

---

## 14. Acceptance Criteria

**Phase 0 (correctness):**
- Fixtures derived from 10 real JSONLs assert max-per-requestId vs naive-sum regressions.
- No dollar number renders before the dedup test is green.

**Phase 1 (4-week MVP OSS release):**
- Install on fresh macOS / Windows / Linux reaches populated dashboard in < 5 min including first real session.
- 5 adapter fixtures parse ≥ 99 % (Claude Code, Codex, Cursor, OpenCode, Continue.dev).
- Egress test: zero outbound calls except self-update in solo mode.
- Privacy adversarial suite green:
  - TruffleHog + Gitleaks + Presidio catch seeded secrets (≥ 98 % recall on a 100-secret corpus).
  - Fuzzer crafts payloads with every forbidden field (`rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`) at varying nesting depths — server rejects 100 %.
  - Clio-verifier rejects ≥ 95 % of seeded identifying abstracts.
  - Nightly invariant scan: zero raw secrets or forbidden fields in ClickHouse rows.
  - RLS cross-tenant probe returns 0 rows.
- p95 dashboard < 2 s with 1 M seeded events; p99 ingest < 100 ms.
- LLM-judge adversarial eval ≥ 0.7 on 50 synthetic team-week scenarios.
- **500-case scoring eval gate:** a frozen 500-case synthetic dev-month fixture with hand-curated "correct" AI Leverage Scores runs in < 30 s in CI; mean absolute error (MAE) ≤ 3 points; no outlier > 10 points; merge-blocking on any scoring-math change. Held-out 100-case validation split must also pass.
- Demo video published; `npm`-installable binary; signed release on GH.

**Phase 2 (team gateway + SOC 2 Type I):**
- Pilot customer admin installs gateway on own Docker host in < 30 min.
- 50-engineer test tenant sees first dashboard within 60 s of first event.
- Cross-tenant isolation: 3 synthetic tenants, zero cross-tenant row leaks over 1-week CI run.
- Works-council template legally reviewed by DE + FR labor-law counsel.
- SOC 2 Type I report issued.
- Pella Labs dogfood tenant exactly meets k ≥ 5 cohort floor (visible in tooltip); no unredacted prompt text in any persisted event; every IC can see the exact bytes stored about them from `/me/your-data`.

**Phase 3 (ML depth + EU):**
- Template-match rate on real sessions ≥ 75 %.
- CLAUDE.md Recommender produces a statistically significant correlation feature for 20+ engineer team within 30 d.
- DP noise stddev < 1 % of aggregate magnitude at 500-engineer tier.
- First EU customer onboards with Frankfurt endpoint, zero US data replication.
- SOC 2 Type II report issued.

**Phase 4 (enterprise):**
- First $50k-ACV enterprise customer signs (air-gapped on-prem or EU-region hosted).
- SCIM de-provisioning completes within 5 min of IdP change.
- CAIQ + SIG Lite + SOC 2 Type II + DPA bundle unblocks customer security review without custom legal rework.

---

## 15. Decision Log

| # | Decision | Rationale |
|---|---|---|
| D1 | DevMetrics is an independent project, not tied to Pharos. | Brief; repeated plan mistake in 3 of 5 research artifacts. |
| D2 | Single-binary agent runs in solo / team-self-host / team-hosted modes. | Preserves solo UX on day 1; env-var flip unlocks team mode; no re-install. |
| D3 | Claude Code capture = native OTEL first, hook/JSONL fallback. | Anthropic ships the schema; avoid drift. |
| D4 | Other agents = adapter shims re-emitting a canonical event schema. | Single downstream storage shape. |
| D5 | Storage = ClickHouse (gateway) + Postgres+TimescaleDB (embedded ≤50 devs). | 7–11× compression; kernel row policies; Postgres+Timescale replaces DuckDB single-writer trap. |
| D6 | Identity = workspace model + GitHub OAuth v0; SAML/OIDC Phase 4. | Mid-market self-serve. |
| D7 | Privacy default = **counters + redacted envelopes** (Tier B). | Mirrors Anthropic's own `OTEL_LOG_USER_PROMPTS=0`; works-council compatible; overrides DevMetrics "Tier C default." |
| D8 | Manager cannot read IC prompt text at v0 except under 3 named audit-logged exceptions. | Enforced in product + contract + Bill of Rights. |
| D9 | k ≥ 5 floor for every team view; k ≥ 25 for DP releases. | Works-council + EU AI Act Annex III defensibility. |
| D10 | No second-order LLM calls per session. | Goodhart + TOS + cost-cliff + privacy. Per-session scoring is rule-based; LLM runs weekly for team-aggregate digest only. |
| D11 | **AI Leverage Score (5-component composite)** — top-level manager number. | Multi-dimensional, SPACE-aligned; replaces "top engineer" ranking; subscores visible. |
| D12 | `useful_output_v1` = `accepted_and_retained_edits_per_dollar` with 6 locked rules. | Efficiency subscore; gaming is visible in same stream. |
| D13 | Metric versioning (`_v1`/`_v2`/`_v3`) mandatory for every user-facing metric. | Goodhart-resilience + on-prem long-tail customers; no silent redefinition. |
| D14 | Idempotency = `(tenant_id, session_id, event_seq)` in Redis `SETNX`, not ReplacingMergeTree. | ReplacingMergeTree is async — would leak duplicate spend into live dashboards. |
| D15 | Partition by `(tenant_id, engineer_id, day)`. | Right-to-erasure = `DROP PARTITION`, atomic. |
| D16 | `events_raw` JSON-blob bucket absorbs unknown event types. | Schema evolution without a deploy; Git-ops PR flow for promotion. |
| D17 | Lane 0 dedup fix (`research.md` §11.1) is P0 before any dollar number renders. | Over-count on every real JSONL measured 2.2–4.6×. |
| D18 | License = Apache 2.0 agent + BSL 1.1 → Apache 2.0 in 4 yrs for gateway. | Sentry/Temporal/MariaDB pattern. |
| D19 | SOC 2 Type I at M3, Type II M9–M12. | Type I unblocks mid-market pilots; Type II required for > $50 k ACV. |
| D20 | Full-prompt mode requires signed Ed25519 config + 7-day cooldown + IC banner. | Blocks junior-admin mistakes. |
| D21 | Metric pricing-version pinned at capture time; no silent recomputation. | Customer trust. |
| D22 | 4-week parallel-workstream Phase 1 plan; Phase 2–4 quarterly cadences. | Only plan with named owners + per-workstream tests + integration gates; ships the OSS wedge before feature-creep. |
| D23 | Continue.dev is the #1 adapter bet for unique telemetry (native accept/reject in `editOutcome`). | Research.md §11.9 — richest native signal, zero OSS parsers today. |
| D24 | GitHub PR-comment Action for ambient virality. | No competitor ships it; every merged PR becomes an ad. |
| D25 | HIPAA PHI redactor (`scan --phi`) as enterprise wedge. | Anthropic BAA explicitly excludes Claude Code; single-slash-command painkiller. |
| D26 | **No managed-service / vendor-locked backend.** Reject Firestore, Firebase Auth, Cloud Functions, Cloud Scheduler as the primary stack. | Kills the open-source + self-host + on-prem + air-gapped positioning locked in D1–D2. Schema concepts (subcollection-tenant) map onto ClickHouse row policies without them. |
| D27 | **Clio-adapted on-device prompt pipeline is the only way prompt text surfaces at team level.** Redact → abstract (via user's own running agent, never a cloud LLM on raw prompts) → Clio-style verify-non-identifying second pass → embed → cluster with k ≥ 3 contributor floor. | `analytics-product/` plan. Only privacy-preserving path to prompt-level drill. Anthropic Clio (2024) + OpenClio are the prior art. Cloud LLM touches only already-redacted, already-verified abstracts at the cluster-labeler step. |
| D28 | **AI Leverage Score math locked as eval-gateable formulas** with winsorized-p5/p95 + percentile-rank within cohort + `confidence = √(outcomes/10) · √(active_days/10)` + `final = raw · confidence`. Gated by a frozen 500-case synthetic dev-month fixture with MAE ≤ 3. | Prevents silent drift of scoring math between releases; makes the score legally defensible; matches the specificity of the `analytics-product/` plan. |
| D29 | **`AI-Assisted:` commit trailer is the primary opt-in attribution path for non-Claude-Code agents.** Avoids Copilot Metrics API (org-gated, Enterprise-only). Local `post-commit` git hook appends `AI-Assisted: devmetrics-<sessionId>`. | Works across every agent (Claude, Codex, Cursor, Continue, Cline, Roo, Kilo); TOS-compatible for personal API keys; merges cleanly with `code_edit_tool.decision=accept` primary anchor + `git log` fallback. |
| D30 | **Developer notified of every manager view of their drill page.** Audit-log row at view-time; daily digest by default; immediate-notification option available. | Transparency primitive from `analytics-product/`. Turns the audit-log from a passive compliance artifact into an active trust signal for the IC. |
| D31 | **Promote-to-Playbook is the Team Impact subscore's primary signal source.** | Without explicit positive-consent sharing, Team Impact has no non-gameable data source. Clio clustering + IC promotion + downstream cluster-membership adoption closes the loop. |
| D32 | **Repo/code slug `bematist`, product name `DevMetrics`, CLI binary `devmetrics`, env var prefix `DEVMETRICS_*`.** GitHub repo slug and workspace package names use `bematist`/`@bematist/*` (internal, changed Sprint 0 kickoff 2026-04-16 when the repo was renamed from `devmetrics`). Product name in all docs, UI, marketing, CLI binary name, and env var prefixes stay **DevMetrics** / `devmetrics` / `DEVMETRICS_*` — user-facing and locked. Also: ClickHouse events engine is `ReplacingMergeTree(ts)` not `(client_event_id)` — CH 25+ rejects UUID as the version column. See `contracts/09-storage-schema.md` Changelog. | Clean separation between code slug (freely renamable) and product identity (locked for legal/contract stability). Avoids PRD/CLAUDE.md churn every time a repo is renamed, while keeping code identifiers aligned with the GitHub URL contributors see. |

---

*Status:* consolidated PRD. Phase 0 (correctness) and Phase 1 (Sprint 0 → 3) are ready for immediate implementation. Phase 2+ requires a product + privacy + legal review pass once Phase 1 ships.
