# 03 — Adapter SDK

**Status:** draft
**Owners:** Workstream B (collector)
**Consumers:** Internal — every IDE/agent adapter implements this. External — community can author additional adapters.
**Last touched:** 2026-04-16

## Purpose

Every IDE/coding-agent adapter implements one interface so the collector can load them, poll them, ship their events, and report their health uniformly. Lets us add adapters (Goose, Antigravity, future) without touching the collector core.

## Interface

```ts
// packages/sdk/adapter.ts (draft)
import type { Event } from "@bematist/schema";

export interface AdapterContext {
  /** Per-machine writable dir, ~/.devmetrics/adapters/<id>/ */
  dataDir: string;
  /** Resolved policy for this adapter (tier, redaction overrides). */
  policy: AdapterPolicy;
  /** Logger; pino-compatible. */
  log: Logger;
  /** Current effective tier for THIS adapter (may differ from collector default). */
  tier: "A" | "B" | "C";
  /** Stable cursor store: per-source resumable read offsets. */
  cursor: CursorStore;
}

export interface AdapterPolicy {
  enabled: boolean;
  tier: "A" | "B" | "C";
  pollIntervalMs: number;             // default 5000
  redactionOverrides?: Record<string, "drop" | "hash" | "keep">;
}

export interface CursorStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface AdapterHealth {
  status: "ok" | "degraded" | "error" | "disabled";
  lastEventAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
  /** Honest data-fidelity tag — surfaces in dashboard pickers. */
  fidelity: "full" | "estimated" | "aggregate-only" | "post-migration";
  /** Per-source caveats, e.g. "Cursor Auto-mode → cost_estimated=true". */
  caveats?: string[];
}

export interface Adapter {
  /** Unique stable id, e.g. "claude-code", "cursor", "continue". */
  readonly id: string;
  /** Human label for UI. */
  readonly label: string;
  /** Semver of the adapter implementation, NOT the source app. */
  readonly version: string;
  /** Source app version range this adapter knows how to read. */
  readonly supportedSourceVersions: string;

  /** One-time setup. Validate paths, create cursors, etc. Throw to disable. */
  init(ctx: AdapterContext): Promise<void>;

  /** Called every `pollIntervalMs`. Returns events to enqueue.
   *  MUST be cancellation-safe: if the collector aborts mid-poll, no partial state. */
  poll(ctx: AdapterContext, signal: AbortSignal): Promise<Event[]>;

  /** Cheap health check — populates `devmetrics status` and dashboard. */
  health(ctx: AdapterContext): Promise<AdapterHealth>;

  /** Optional — graceful shutdown hook. */
  shutdown?(ctx: AdapterContext): Promise<void>;
}
```

## Lifecycle

1. **Discovery** — collector reads `packages/adapters/*` at build time (statically linked into the bun-compile binary; no plugin loading at runtime in v1).
2. **Init** — collector calls `init(ctx)` for every enabled adapter on startup. Failure → log + mark disabled, don't crash collector.
3. **Poll loop** — each adapter has its own polling cadence; calls run concurrently with bounded concurrency (default 4).
4. **Emit** — events returned from `poll` go into the egress journal (local SQLite), then the egress worker ships them via `02-ingest-api`.
5. **Health** — `devmetrics status` and `devmetrics doctor` call `health()` on every adapter; results cached 30s.

## Per-source contract — what each adapter must produce

Per CLAUDE.md adapter matrix, fidelity is honest. Each adapter MUST set `Event.fidelity` correctly and `Event.cost_estimated` where appropriate:

| Adapter | `fidelity` | Notes |
|---|---|---|
| `claude-code` | `full` | OTel native + JSONL backfill |
| `codex` | `full` | JSONL tail; cumulative `token_count` diff with stateful per-session totals stored in cursor |
| `cursor` | `full` (Pro) / `estimated` (Auto) | Read-only SQLite (`mode=ro`, copy-and-read); set `cost_estimated=true` for Auto mode |
| `opencode` | `post-migration` | Pre-v1.2 sharded JSON skipped with warning; orphaned sessions skipped |
| `continue` | `full` | Four discrete JSONL streams in `~/.continue/dev_data/0.2.0/` |
| `vscode-generic` | varies | SDK consumer entrypoint; per-extension authors set their own fidelity |
| `goose` | `post-migration` | Phase 2; SQLite `sessions.db`; pre-v1.10 skipped |
| `copilot-ide` | `full` | Phase 2; `~/Library/Application Support/Code*/User/workspaceStorage/*/chatSessions/*.json` |
| `copilot-cli` | `full` | Phase 2; OTel JSONL — reuses claude-code OTel parser |
| `cline`/`roo`/`kilo` | `full` | Phase 2; 3-in-1 adapter (fork lineage) |
| `antigravity` | `full` (predicted) | Phase 3; predicted VS Code chat schema |

## Pinakes lineage (reference, not import)

The collector reuses _patterns_ from `~/dev/gauntlet/knowledge-graph` (= `@pella-labs/pinakes`): multi-IDE installer, local SQLite cursor store, MCP server, privacy adversarial test culture. Do **not** share code (Pinakes is Node 24 + pnpm; we are Bun). Field-level parsers from `grammata` may be vendored under `packages/adapters/<id>/parsers/`.

## Invariants

1. **Adapters never read fields they don't normalize.** If a JSONL line has `apiKey`, the adapter doesn't parse it.
2. **Adapters never write to source apps.** Cursor SQLite is `mode=ro` + copy-and-read. Never UPDATE/INSERT.
3. **`Event.client_event_id` is generated inside the adapter** with a deterministic hash of `(source, session_id, event_seq, raw_event_hash)` so re-polling the same source data after a crash produces stable IDs (idempotency through to the server).
4. **`fidelity` is honest, not flattering.** Cursor Auto-mode is `estimated`. OpenCode pre-v1.2 is `post-migration` with a skip warning. We surface the truth in the dashboard.
5. **No collector-wide state in adapters.** Adapters use `ctx.cursor` for resumable state. Never global vars.
6. **Adapters MUST run the on-device Clio pipeline (`06-clio-pipeline.md`)** for any Tier B+ event before returning. They do not call cloud LLMs directly.
7. **Per-adapter contract tests pinned to golden fixtures.** `packages/fixtures/<adapter-id>/` holds real-shape sample inputs + expected `Event[]` outputs. Mandatory at release gate (tokscale #430/#433/#439 cautionary tales).

## Open questions

- Plugin loading at runtime (so customers can ship private adapters) — Phase 2 or never? (Owner: B — recommend Phase 2 with cosign-signed plugins; not v1.)
- Should `Adapter.poll` support push (callback) for adapters with file-watcher capability, or stay pure pull? (Owner: B — pure pull v1; consider push if Continue.dev's tail-N pattern proves expensive.)
- How do we handle Continue.dev's four-stream schema — one adapter that fans out, or four sub-adapters? (Owner: B — one adapter, four streams, single cursor key per stream.)

## Changelog

- 2026-04-16 — initial draft.
- 2026-04-16 — Sprint-0 M0: `@devmetrics/schema` import path → `@bematist/schema` (repo renamed; see PRD §D32). Product name stays DevMetrics.
- 2026-04-16 — M1 follow-up: confirmed `@bematist/*` package references across code snippets in this contract (additive; no behavioral change).
