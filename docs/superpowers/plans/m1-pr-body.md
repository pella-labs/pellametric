## Summary

Lands the M1 "first event E2E" deliverable for GH Issue #1 (Workstream B — Collector & Adapters).

- **Claude Code JSONL adapter** end-to-end (discovery → parse → normalize → egress → ingest 202)
- **SQLite-backed egress journal** with WAL mode, idempotent `INSERT OR IGNORE`, survives kill -9
- **Bounded-concurrency orchestrator** with per-adapter timeout race
- **Phase 0 P0 fixes (D17)** for Claude Code: `parseSessionFile` `Map<requestId, usage>` max-per-field dedup, `durationMs = last − first`, line-oriented `readline` stream reader (no 50MB silent-drop), pricing-version stamped on every cost_usd event, LiteLLM pin helper
- **M1 CLI set**: `devmetrics status`, `audit --tail`, `dry-run`, `serve`
- **Contracts**: rename `@devmetrics/*` → `@bematist/*` in 03/06 (additive changelog bump)
- **Cross-platform**: all code + shell examples work on macOS + Linux + Windows (verified on Windows dev machine)

Closes: GH Issue #1 Sprint 1 deliverables (items 1–4)
Spec: `docs/superpowers/specs/2026-04-16-workstream-b-collector-adapters-design.md`
Plan: `docs/superpowers/plans/2026-04-16-m1-claude-code-first-event-e2e.md`

## M1 gate — self-check (from spec §7.1)

- [x] Claude Code JSONL adapter emits real `Event[]` from a real `~/.claude/projects/*/sessions/*.jsonl` — verified against `real-session.jsonl` fixture + integration test
- [x] `bun run test` green (91 / 91 pass across 18 files)
- [x] Event flows: adapter → egress journal → worker → ingest `/v1/events` → 202 Accepted → `submitted_at` set — see `docs/superpowers/plans/m1-evidence.txt`
- [x] P0 fixes for Claude Code: `parseSessionFile` dedup, `durationMs`, safe file reader, pricing-version stamped, onboarding-safety helper (`atomicWrite` + `.bak` + `unifiedDiff`)
- [x] Egress journal survives kill -9 + restart — deterministic `client_event_id` hash + `INSERT OR IGNORE` = no duplicate sends on resend
- [x] `devmetrics status` + `devmetrics audit --tail` + `devmetrics dry-run` work — smoke-tested
- [x] Contract drift (`@devmetrics/*` → `@bematist/*`) fixed with additive changelog bump on contracts 03 + 06

**Deferred to the M1 integration window (per checkpoint definition — David-alone can't verify):**

- Jorge's ClickHouse `events` table receives the row; `dev_daily_rollup` MV populates for that engineer
- Sandesh's single dashboard tile (cost-over-7d) renders from real data

## Tests

- 91 tests pass across 18 files, 0 fail (full suite)
- 26 tests in the claude-code adapter directory alone (M1 gate target: ≥10)
- Typecheck clean across 15 workspaces
- Biome lint clean

## Cross-platform

- All `node:path`/`node:os` path resolution
- `RLIMIT_CORE=0` on POSIX; `SetErrorMode` note on Windows
- Shell examples in plan include POSIX + Git Bash + PowerShell variants
- Verified: this dev machine is Windows; all gates green here

## Test plan

- [x] `bun install && bun run dev` brings up the stack locally
- [x] Full test suite green on Windows
- [x] E2E smoke: 6 real events from fixture → ingest 202
- [x] Restart idempotency reproduced
- [ ] Integration window (M1 tag): Jorge verifies CH populate; Sandesh verifies tile render

🤖 Generated with [Claude Code](https://claude.com/claude-code)
