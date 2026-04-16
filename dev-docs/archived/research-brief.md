# Research Brief — DevMetrics (working name)

**Date:** 2026-04-16
**Mode:** Greenfield
**Prepared by:** presearch-lead (Loop 0)

---

## 1. Project Brief (one-liner)

Open-source, self-hostable analytics platform that auto-instruments every developer machine to capture all LLM/AI coding usage (tokens, cost, prompts, sessions, tool calls) across every IDE/ADE, ships it to a centralized dashboard, and gives engineering managers cross-developer correlation against Git outcomes (commits, PRs, churn) so they can coach prompt-efficiency and improve agentic workflows.

**Wedge vs prior art:** every existing tool is single-developer-local-only. The manager dashboard with cross-dev comparison and Git correlation is open whitespace.

---

## 2. Per-Tool Data Source Map (validated 2026-04-16)

| Tool | Data location | Format | Token/cost data | Hooks/exporter? | Confidence |
|---|---|---|---|---|---|
| **Claude Code** | `~/.claude/projects/<hash>/sessions/<uuid>.jsonl` | JSONL (typed records, `parentUuid` chained) | Yes, per turn + cumulative | **Native OTel exporter** (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) AND 25 hook events | High |
| **Codex CLI** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | JSONL | `event_msg.payload.type=="token_count"` cumulative — subtract for per-turn | None | High |
| **Cursor** | `~/Library/Application Support/Cursor/...` | SQLite | Yes, but "Auto" mode = estimated (Sonnet pricing fallback) | None public | Medium |
| **OpenCode** | `~/.local/share/opencode/storage/{session,message,part}/` | Per-record JSON (sharded); SQLite migration considered | Yes | `OPENCODE_DATA_DIR` env | Medium |
| **Goose** | `~/.local/share/goose/sessions/sessions.db` | SQLite | Yes | None | Medium |
| **Claude Desktop** | (codeburn parses it) | JSONL-ish | Partial | None | Low |
| **Pi** | Limited public docs | Unknown | Unknown | Unknown | Low |
| **GitHub Copilot** | No user-readable session logs | — | **Output tokens only** (per codeburn empirical finding) | None | Medium |

**Key insight:** Claude Code is the only tool with a built-in OTel exporter. For everyone else, we must read files. This drives the collector architecture (Loop 2).

### Claude Code Hook Events (25 total — high signal subset)

| Event | Use for |
|---|---|
| `UserPromptSubmit` | Capture prompt text (with `OTEL_LOG_USER_PROMPTS=1` → off by default) |
| `PreToolUse` / `PostToolUse` | Per-tool timing, params (`OTEL_LOG_TOOL_DETAILS=1`), success/fail |
| `Stop` / `SessionEnd` | Turn boundaries, session duration, exit reason |
| `SubagentStart` / `SubagentStop` | Sub-agent depth + cost attribution |
| `PreCompact` / `PostCompact` | Compaction pressure metric |
| `TaskCreated` / `TaskCompleted` | Workflow correlation |

Hooks include `transcript_path` so we can lazily ingest the full JSONL for any session.

### Claude Code Native OTel — Variables

```
CLAUDE_CODE_ENABLE_TELEMETRY=1
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_LOG_TOOL_DETAILS=1   # tool params
OTEL_LOG_USER_PROMPTS=1   # prompts (PRIVACY: off by default)
```

Default policy: prompts NOT exported, file contents/code NOT exported. Anthropic chose privacy-by-default — we should mirror this.

---

## 3. Prior Art / Competitor Map

| Project | Stars | Scope | Architecture | License | Notes |
|---|---|---|---|---|---|
| **codeburn** (AgentSeal) | 2.1k | Multi-tool **per-dev TUI** | Local-only, reads files, React Ink TUI | MIT | 13 task categories, 6 IDEs, no server, no team aggregation. Closest competitor. |
| **sniffly** (chiphuyen) | 1.2k | **Claude Code only**, per-dev web dashboard | Local Python (uv/pip), :8081 web UI, no backend | MIT | High-profile author (Chip Huyen). "Share dashboards" feature hints at team need but unbuilt. Single-tool. Strong UX bar. |
| **grammata** (your repo) | — | Multi-tool **library** for reading local data | Local read-only npm lib | — | We own this — building block, not product |
| **ccusage** (ryoppippi) | popular | Claude Code + Codex CLI usage | Local CLI | MIT | Per-dev CLI |
| **tokscale** (junhoyeo) | growing | Multi-tool tracker w/ **global leaderboard** | Local + opt-in cloud submit | MIT? | Closest to "leaderboard" idea but per-dev opt-in to public board |
| **claude-code-otel** (ColeMurray) | — | OTel collector for Claude Code | OTel collector + Grafana | — | Only Claude Code, requires Grafana setup |
| **claude-code-monitor** (zcquant) | — | OTel dashboard for Claude Code | OTel + dashboard | — | Single-user focus |
| **Langfuse** (self-host) | 6k+ | LLM tracing platform | Postgres + Clickhouse + Redis + S3 + web + worker | MIT (cloud paid) | Heavy stack, generic LLM apps not coding agents |
| **Helicone** (self-host) | growing | Proxy-based LLM observability | Proxy + Postgres + Clickhouse | Apache 2.0 | Proxy approach doesn't fit local IDE traffic |
| **OpenLLMetry** (Traceloop) | 5k+ | OTel SDK for LLM apps | SDK + standard OTel collectors | Apache 2.0 | Pattern reference; not coding-agent specific |
| **Posthog** (self-host) | 22k+ | Product analytics | Postgres + Clickhouse + Kafka + Redis + Minio | MIT | Reference for OSS analytics arch — but too heavy for our scale |

### Where everyone falls short (our wedge)

1. **No multi-tool, multi-developer aggregation.** Every existing tool stops at "show me my own usage." Sniffly's "shared dashboards" is the closest hint — but it's still per-individual-export.
2. **No correlation with Git outcomes.** No one joins "tokens spent" with "commits/PRs/churn" to compute efficiency.
3. **No prompt-pattern intelligence.** Codeburn classifies tool patterns into 13 categories; nobody clusters *prompts* to find what works.
4. **No self-host story for the team layer.** Langfuse is self-hostable but generic (any LLM app); codeburn/sniffly are local-only.
5. **No coaching layer.** Manager sees the data but the tool doesn't suggest "Dev X uses 2.3× tokens for similar tasks — try these prompt patterns from your top performers."

**Threat to monitor:** Sniffly's high-profile author + 1.2k stars in a short period suggests Chip Huyen could pivot toward team aggregation. Our defense = ship the multi-tool + team layer fast and own the OTel-conventions-aligned schema first.

---

## 4. Standards: OpenTelemetry GenAI Semantic Conventions

Status: **Development** (not stable). Stability flag: `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`.

**Required attributes:**
- `gen_ai.operation.name` (chat, embeddings, execute_tool, invoke_agent…)
- `gen_ai.provider.name`

**Conditionally required:**
- `gen_ai.request.model`
- `error.type`
- `gen_ai.conversation.id`

**Recommended:**
- `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`
- `gen_ai.response.id` / `gen_ai.response.model` / `gen_ai.response.finish_reasons`
- `server.address` / `server.port`

**Opt-in (sensitive):**
- `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions`

**Span name pattern:** `{operation} {model}` e.g., `chat claude-opus-4-7`. Tool spans: `execute_tool {tool_name}`. Agent spans: `invoke_agent {agent_name}`.

**MCP-specific conventions** also exist (Anthropic, OpenAI, Bedrock have provider-specific extensions).

**Decision: align our schema with these conventions** — gives us free interop with Langfuse, SigNoz, Honeycomb, Grafana via OTLP. Add coding-agent extensions for IDE, repo path, git ref, file modified.

---

## 5. Industry Frameworks (2026)

The DPIP (Developer Productivity Insights Platform — Gartner's 2026 rename of SEIP) frameworks our dashboard should map to:

| Framework | Pillars | Our metric coverage |
|---|---|---|
| **DORA** | Deployment frequency, lead time, change failure rate, MTTR | Inferable from Git + CI |
| **SPACE** | Satisfaction, Performance, Activity, Communication, Efficiency | Activity + Efficiency are our home turf |
| **DX Core 4** | Speed, Effectiveness, Quality, Impact | Token-efficiency = direct measure of Effectiveness |

**2026 context** (per DORA / DX research): AI writes ~41% of code, code churn DOUBLED, delivery stability decreased 7.2%. **There is unmet demand for measuring AI coding effectiveness specifically — our timing is good.**

---

## 6. Self-Hosting Reference Architectures

| Platform | Components | Footprint | Relevance |
|---|---|---|---|
| **Langfuse** | Web + Worker + Postgres + Clickhouse + Redis + S3 (or compatible) | Heavy (10+ containers prod) | Proven at LLM scale. Too heavy for "100 dev" target. |
| **Posthog** | Web + Worker + Postgres + Clickhouse + Kafka + Zookeeper + Redis + Minio + Caddy | Very heavy (~16GB RAM hobby) | Reference for "ingest at scale" but overkill. |
| **Plausible** (analytics OSS) | Web + Postgres + Clickhouse | Medium (3 containers) | Lean OSS analytics — better template for our scale |
| **Sentry** (self-hosted) | Web + Worker + Postgres + Clickhouse + Redis + Kafka | Heavy | Reference for event-pipeline patterns |
| **GoatCounter / Plausible** | Single binary + sqlite/pg | Tiny | Reference for "easy self-host" UX |

**Key tradeoff for Loop 2:** simple stack (Postgres-only) vs analytics-tier (Postgres + Clickhouse). Our queries (cross-dev comparison, leaderboards over millions of tool calls) lean analytical — but at 100 devs × ~1k events/day = 100k events/day = manageable in Postgres for years before needing Clickhouse.

**Decision direction:** start Postgres-only with TimescaleDB extension OR DuckDB-as-OLAP-side-store for self-host simplicity; design schema so Clickhouse can be added later for orgs >1k devs.

---

## 7. Key Research Findings (open questions for Loop 1/2)

| # | Finding | Implication |
|---|---|---|
| F1 | Claude Code has native OTel; nobody else does | Hybrid collector: OTel ingest path + file-tail path |
| F2 | Codex token totals are cumulative, must diff per turn | Collector needs stateful per-session running totals |
| F3 | Cursor "Auto" mode = no real token data | Document this honestly; show estimated where applicable |
| F4 | OTel GenAI conventions are unstable/in-development | Align but version-pin our wire format; provide migration path |
| F5 | OpenCode considering switch from JSON files to SQLite | File-watch needs to handle multiple formats per tool |
| F6 | Anthropic chose prompt-egress OFF by default | Strong privacy default is the industry norm |
| F7 | All 6 IDEs/ADEs supported by codeburn use file-based persistence on local disk | A local-daemon-with-file-watchers is feasible across all of them |
| F8 | Hooks block prompt processing; misuse = worse UX | Hook-based capture must be async (fire-and-forget to local daemon) |
| F9 | tokscale already has leaderboard with opt-in cloud submit | Our model can be: self-host first, optional cloud submit second |
| F10 | Langfuse cloud business model: free OSS + paid managed cloud | Viable monetization template if we ever go commercial — keep license clean (MIT/Apache 2.0) |

---

## 8. Sources

- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OTel GenAI Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [Langfuse Self-Hosting](https://langfuse.com/self-hosting)
- [Posthog Self-Hosting](https://posthog.com/docs/self-host)
- [OpenLLMetry](https://github.com/traceloop/openllmetry)
- [codeburn](https://github.com/AgentSeal/codeburn)
- [sniffly (Chip Huyen)](https://github.com/chiphuyen/sniffly)
- [grammata](https://github.com/pella-labs/grammata)
- [ccusage](https://github.com/ryoppippi/ccusage)
- [tokscale](https://github.com/junhoyeo/tokscale)
- [claude-code-otel (ColeMurray)](https://github.com/ColeMurray/claude-code-otel)
- [Codex CLI session format](https://developers.openai.com/codex/cli/features)
- [OpenCode session storage](https://github.com/sst/opencode)
- [Inside Claude Code: The Session File Format (2026)](https://databunny.medium.com/inside-claude-code-the-session-file-format-and-how-to-inspect-it-b9998e66d56b)
- [DORA / DPIP / DX Core 4 (2026)](https://getdx.com/blog/dora-metrics-tools/)
- [Pinakes / knowledge-graph (your prior work)](https://github.com/pella-labs/pinakes)
