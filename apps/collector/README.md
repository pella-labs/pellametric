# `@bematist/collector` — per-machine collector

Bun-compiled single binary that runs on each developer's machine, discovers
sources, and ships events to the central ingest. One binary, three modes
(solo / self-host / hosted) switched by `BEMATIST_ENDPOINT`.

Status: **seed only.** B-seed shipped the `Adapter` SDK scaffold and one stub
adapter for Claude Code. The real parsers, Clio on-device pipeline, egress
journal, and CLI commands land in Sprint 1+ (Workstream B / David).

## Contracts

- Adapter interface shape → `contracts/03-adapter-sdk.md`
- Wire event shape → `contracts/01-event-wire.md`
- On-device prompt pipeline → `contracts/06-clio-pipeline.md`

## v1 adapter set (Sprint 1)

Honest coverage per `CLAUDE.md` §"Adapter Matrix — Honest Coverage":

| Source | Fidelity | Mechanism |
|---|---|---|
| `claude-code` | **full** | Native OTel (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) + hook fallback + JSONL backfill |
| `codex` | full (caveat) | JSONL tail + cumulative `token_count` diff; stateful totals in egress journal |
| `cursor` | token-only (estimated for Auto) | Read-only SQLite (`mode=ro`, copy-and-read); Auto-mode sets `cost_estimated=true` |
| `opencode` | post-migration | Post-v1.2 SQLite only; pre-v1.2 sharded JSON skipped with warning |
| `continue` | full | `~/.continue/dev_data/0.2.0/{chatInteraction,tokensGenerated,editOutcome,toolUsage}.jsonl` |
| `vscode-generic` (≥1 shipped) | varies | Adapter SDK entrypoint for community-authored VS Code agent extensions |

## Phase 2 adapter set

`goose` (post-v1.10), `copilot-ide`, `copilot-cli`, `cline` + `roo` + `kilo`
(3-in-1 fork lineage).

## Phase 3

`antigravity` (predicted VS Code chat schema).

## What the seed ships today

- `src/adapters/claude-code/index.ts` — `ClaudeCodeAdapter` stub that
  discovers the OTel env var and the `~/.claude/projects/*/sessions/*.jsonl`
  backfill dir; `poll()` returns `[]`.
- `packages/fixtures/claude-code/session-fixture.jsonl` — 16-event golden
  session covering every required `event_kind` for downstream tests.
- `packages/sdk/src/adapter.ts` — verbatim implementation of the
  `Adapter` / `AdapterContext` / `AdapterHealth` interfaces from
  `contracts/03-adapter-sdk.md`.
