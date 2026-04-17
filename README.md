# Bematist

Open-source (Apache 2.0), self-hostable AI-engineering analytics platform. Auto-instruments every developer's machine to capture all LLM / coding-agent usage (tokens, cost, prompts, sessions, tool calls, outcomes) across every IDE/ADE — Claude Code, Codex, Cursor, OpenCode, Goose, Copilot, Continue.dev, Cline/Roo/Kilo — and ships it to a tenant-owned backend. The manager dashboard correlates LLM spend with Git outcomes (commits, PRs, green tests) and surfaces "why does dev X use ½ the tokens for similar work" via a Clio-style prompt pipeline plus Twin Finder — without shipping per-engineer leaderboards, per-session LLM judgments, or panopticon views.

## What it isn't

| Non-goal | Why |
|---|---|
| Autonomous coaching ("AI suggests a prompt improvement") | Second-order LLM = Goodhart + TOS + cost cliff + privacy. Never ship. |
| Real-time per-engineer event feed | Panopticon. Banned by challenger review. |
| Public per-engineer leaderboards | Works-council BLOCKER in DE/FR/IT; Goodhart-unsafe. |
| Performance-review / promotion-packet surfaces | Explicit product line we refuse to cross. |
| IDE plugin surface | Scope — we observe agents, not editors. |
| Code-quality analysis (lint / complexity over captured code) | Scope — analytics over agent telemetry only. |
| Cross-tenant benchmarking | TOS + antitrust + required trust model we won't ship. |
| Replacing dev LLM API keys / proxy interception | Observe, do not gate. |
| Real-time intervention / blocking | Out of scope forever. |
| Pharos coupling (IPC, Electron, `pharos-ade.com`) | Independent project by brief; never reintroduce. |

## Install

### Collector (dev machine)

Distro packages are the primary path — Homebrew, apt/deb, AUR, Chocolatey. See [`packaging/README.md`](./packaging/README.md) for the per-platform instructions and signature verification flow (Sigstore + cosign + SLSA Level 3).

Released binaries are signed; verify before use. The default install is `gh release download` + `cosign verify`, not `curl | sh`. The GitHub Releases page is the source of truth.

### Server (self-host)

```bash
docker compose -f docker-compose.yml up        # web + ingest + worker + postgres + clickhouse + redis
docker compose --profile otel-collector up     # opt-in OTel collector sidecar
```

Environment is driven by a `.env` file — use `.env.example` as the template.

## Quick dev bootstrap

```bash
bun install
docker compose -f docker-compose.dev.yml up -d    # postgres + clickhouse + redis only; apps run on the host
cp .env.example .env
bun run dev                                       # start all apps via Bun workspaces
```

Common scripts:

```bash
bun run lint                # biome
bun run typecheck           # tsc --noEmit across workspaces
bun run test                # bun test (unit + integration)
bun run test:e2e            # playwright (apps/web)
bun run test:privacy        # privacy adversarial suite — merge-blocking
bun run test:scoring        # 500-case AI Leverage Score eval (MAE ≤ 3) — merge-blocking on scoring changes
bun run test:perf           # k6 perf (gates Sprint 2)
```

## Status

Pre-M1. Foundation + Sprint-0 scaffolding landed; M1 vertical slice (teams 2×2, clusters Twin Finder, insights digest, sessions virtualized list) shipped at commit `0bc7d9f`.

- API shape locked: Next.js Server Actions + Route Handlers (no tRPC). Zod schemas in `packages/api/src/schemas/` are the input/output source of truth.
- Queries are fixture-backed today via `packages/fixtures`. Flip to real DBs with `USE_FIXTURES=0` once Postgres + ClickHouse are seeded (lane 1 is wiring this).
- Privacy defaults: Tier B (counters + redacted envelopes). Tier C opt-in only. See `CLAUDE.md` §Security Rules.
- Scale target (day one): 10k devs / 8M events/day · p95 dashboard <2s · p99 ingest <100ms.

See `dev-docs/PRD.md` for the locked plan and `WORKSTREAMS.md` for the per-owner split.

## Contributing

- **`CLAUDE.md` is the canonical conventions doc — read it first.** It locks the tech stack, non-goals, privacy tiers, scoring math, adapter matrix, and testing gates. Everything else should be consistent with it; if it conflicts with `dev-docs/PRD.md`, the PRD wins and `CLAUDE.md` gets updated.
- Pull-request template and privacy invariants are in `.github/pull_request_template.md`.
- Security disclosure: see [`SECURITY.md`](./SECURITY.md).
- Reference architecture, decisions D1–D32, and rationale: `dev-docs/PRD.md` + `dev-docs/summary.md`.

## License

Apache 2.0. See `LICENSE` (agent, dashboard, adapters, schemas, CLI). A small set of enterprise-layer components (gateway, admin, SSO/SCIM, audit-log export, DP, compliance signing, cold-archive, MCP read-API) are BSL 1.1 with a 4-year Apache 2.0 conversion window — see PRD §D18.
