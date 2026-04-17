# Workstream B — Collector & Adapters — Design Spec

**Status:** draft
**Author:** David
**Date:** 2026-04-16
**Tracks:** GitHub Issue [#1](https://github.com/pella-labs/bematist/issues/1) · `WORKSTREAMS.md` §B · PRD §10 Phase 1 (B)
**Supersedes:** nothing — first Workstream-B spec
**Covers checkpoints:** M1 → M2 → M3

---

## 1. Scope

Full Workstream B deliverable for David: per-machine collector (`apps/collector`) + Adapter SDK + v1 adapter set (Claude Code, Codex, Cursor, OpenCode, Continue.dev, VS Code generic) + on-device Clio pipeline plumbing + CLI commands + egress journal. Phases scheduled against the three PR checkpoints (M1 / M2 / M3) from `WORKSTREAMS.md` so each checkpoint is a clean integration + PR boundary, not a re-planning session.

**Out of scope (other workstreams):** ingest server (Walid), DB schemas & AI pipeline (Jorge), dashboard (Sandesh), release pipeline / SLSA / distro packaging infrastructure (Sebastian — David coordinates and consumes the reusable workflow).

**Locked by contracts, not revisited here:** adapter interface shape (`contracts/03`), event wire (`contracts/01`), Clio 5-stage order (`contracts/06`), redaction marker format and server-authoritative rule (`contracts/08`), ingest response semantics (`contracts/02`). This spec assumes those; if a contract needs to change to land this work, file an additive changelog on the contract first.

---

## 2. Starting point (M0, commit `1861bc1`)

- `packages/sdk/src/adapter.ts` — `Adapter`, `AdapterContext`, `AdapterPolicy`, `AdapterHealth`, `CursorStore`, `Logger` interfaces landed.
- `apps/collector/src/adapters/claude-code/` — stub class: env/dir discovery works, `poll()` returns `[]`, `health()` reports `fidelity: "full"`. Tests green.
- `packages/fixtures/claude-code/session-fixture.jsonl` — 16-line golden fixture covering `session_start` → `llm_request` → `llm_response` → `tool_call` → `tool_result` → `code_edit_proposed` → `code_edit_decision` (accept + reject) → `session_end`. Tier B throughout. Schema-validated by `loadFixture("claude-code")`.
- `apps/collector/src/cli.ts` — placeholder entrypoint (`"bematist-cli skeleton"`).
- `apps/collector/src/index.ts` — placeholder export.

**M0 deltas carried into this spec:**

- Contracts reference `@devmetrics/*`; real paths are `@bematist/*`. Fix via additive contract changelog when landing M1 code.
- Postgres host port is `5433 → 5432` locally.
- ClickHouse uses `ReplacingMergeTree(ts)` not `(client_event_id)`. Not a collector concern; adapters trust **Redis SETNX at ingest** as the sole authoritative idempotency gate.

---

## 3. Shared architecture

Built once, consumed by every adapter + every CLI command. The design choices here are small-but-load-bearing; each has a recommended option inline.

### 3.1 Process model

Single Bun-compiled binary `bematist-cli`. Two modes:

- **`devmetrics serve`** — long-running collector daemon. Runs adapter poll loops, egress worker, optional OTLP receiver, optional local web at `:9873`. Registered as a user-level service via `devmetrics install` (launchd on macOS, systemd-user on Linux, Windows Service / Task Scheduler on Windows).
- **`devmetrics <cmd>`** — one-shot CLI (status, audit, doctor, purge, erase, outcomes, waste, prompts, export, scan, policy, dry-run). Reads the same SQLite data store as the daemon; no RPC needed.

**Hardening at startup, every mode** (CLAUDE.md §Security Rules):

- `process.setrlimit?.("core", 0)` (Bun NAPI) + equivalent syscall fallback. `ulimit -c 0` for the process group.
- `Dockerfile` entrypoint also sets `ulimit -c 0` + `RLIMIT_CORE=0`.
- `devmetrics doctor` verifies both at runtime.
- `process.on("SIGTERM"|"SIGINT", gracefulShutdown)` — AbortController broadcasts to all adapters; egress worker drains; SQLite WAL checkpoints; exits `0`.

### 3.2 Adapter orchestrator

Per contract `03-adapter-sdk.md` §Lifecycle:

- **Static registration** at compile time — every v1 adapter imported explicitly in `apps/collector/src/adapters/index.ts`. No plugin loading at runtime in v1 (open question in contract 03 — deferred to Phase 2 with cosign-signed plugins).
- **init** fan-out on `serve` startup; any adapter throwing → logged + marked `status: "disabled"` in health; **collector must not crash**.
- **poll loop** — one `setInterval(pollIntervalMs)` per adapter, default 5000 ms. Poll calls wrapped in:
  - `AbortController` from the orchestrator (cancellation on SIGTERM).
  - `Promise.race` with a hard timeout (default 30 s); timeout → log warn + mark adapter `degraded`.
  - `try/catch` around the poll; exception → log + increment adapter error counter + next tick retries.
- **Bounded concurrency** — at most 4 adapter polls in flight simultaneously (semaphore in `apps/collector/src/orchestrator/semaphore.ts`).

### 3.3 Egress journal — `bun:sqlite` (recommended)

One SQLite file at `~/.bematist/egress.sqlite` (path overridable via `DEVMETRICS_DATA_DIR`).

Schema (first migration):

```sql
CREATE TABLE events (
  client_event_id TEXT PRIMARY KEY,
  body_json       TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,   -- ISO 8601 UTC
  submitted_at    TEXT,            -- null when pending
  last_error      TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX events_pending_idx ON events(submitted_at) WHERE submitted_at IS NULL;

CREATE TABLE cursors (
  adapter_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (adapter_id, key)
) STRICT;

CREATE TABLE redaction_counts (    -- per-run counters for `devmetrics status`
  run_id       TEXT NOT NULL,
  marker_type  TEXT NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (run_id, marker_type)
) STRICT;

CREATE TABLE pinned_certs (        -- populated on first successful TLS handshake with ingest
  host        TEXT PRIMARY KEY,    -- matches `--ingest-only-to` value
  cert_sha256 TEXT NOT NULL,
  pinned_at   TEXT NOT NULL
) STRICT;

CREATE TABLE clio_embeddings (     -- Stage-4 cache; key = sha256(abstract)
  abstract_sha256 TEXT PRIMARY KEY,
  embedding_json  TEXT NOT NULL,   -- JSON array of floats
  model_id        TEXT NOT NULL,   -- e.g. "xenova/all-MiniLM-L6-v2"
  created_at      TEXT NOT NULL
) STRICT;
```

WAL mode on (`PRAGMA journal_mode=WAL`) — safe for concurrent daemon + CLI reads. `synchronous=NORMAL` for throughput; `checkpoint` on graceful shutdown.

**Why SQLite over append-only JSONL:**

- `devmetrics audit --tail` wants structured queries ("show me last 100 events to tenant X"), not file regex.
- `devmetrics purge --session <id>` is a targeted DELETE.
- `retry_count` and `last_error` need UPDATE, which plays poorly with append-only semantics.
- Pinakes lineage uses SQLite too — we mine the same pattern.

**Invariants:**

1. Every `Event` lands in `events` before the egress worker attempts to ship it. No direct network writes from adapters.
2. `submitted_at` transitions non-null exactly once (202 Accepted from ingest). Never reset to null.
3. On adapter re-poll of source data already in `events` (crash-resume), `client_event_id` collides (deterministic hash) → SQLite `INSERT OR IGNORE` is a no-op. Idempotent end-to-end.

### 3.4 Egress worker

One loop inside `serve` mode. Algorithm:

1. Select up to 1000 rows where `submitted_at IS NULL ORDER BY enqueued_at ASC`.
2. POST as a single `{ events: [...] }` to `${DEVMETRICS_INGEST_HOST}/v1/events` with `Authorization: Bearer ${DEVMETRICS_TOKEN}`.
3. Honor response per contract `02-ingest-api.md`:
   - **202 Accepted** → UPDATE submitted_at for all.
   - **207 Multi-Status** → succeeded go to submitted_at; failed get `last_error` + `retry_count++`.
   - **400 Bad Request** → mark `last_error`, do NOT retry (schema violation; human fix needed); emit warn log with `request_id` for triage.
   - **401 Unauthorized** → log fatal, halt worker (config issue; let daemon exit so operator notices).
   - **403 Forbidden** → log fatal, halt (tier misconfiguration).
   - **413 Payload Too Large** → split batch in half, retry each half (body-size exceeded).
   - **429 Too Many Requests** → sleep `Retry-After` seconds, then resume. Exponential backoff on repeated 429 capped at 5 min.
   - **500/502/503/504** → retry with exponential backoff (1 s → 2 s → 4 s … cap 5 min); no batch split.
4. Loop with base interval 1000 ms when pending rows exist; sleep 10 s when journal drained.

**`--ingest-only-to <host>` cert pinning:**

- CLI flag + `DEVMETRICS_INGEST_ONLY_TO` env var.
- When set, egress worker does TLS with:
  - SNI locked to the exact hostname.
  - Cert SHA-256 pinned via `tls.checkServerIdentity` + one-time bootstrap capture of the leaf cert SHA on first success (stored in SQLite `pinned_certs` table — small migration).
  - Any mismatch → fatal + halt worker.
- Documented as defense against a compromised binary trying to exfiltrate elsewhere.

### 3.5 Cursor store

Adapter-facing API already in `packages/sdk` (`CursorStore.get/set`). Implementation reads/writes the `cursors` table in the same egress SQLite file. Keys are adapter-chosen strings (e.g., `"jsonl-offset:/Users/david/.claude/projects/foo/sessions/bar.jsonl"`). Values are opaque strings (JSON-encoded as needed by the adapter).

### 3.6 Clio on-device pipeline (`packages/clio`)

Per `contracts/06-clio-pipeline.md`. Public surface:

```ts
// packages/clio/src/index.ts
export async function attachPromptRecord(
  event: Event,
  rawPromptText: string,
  ctx: AdapterContext,
): Promise<Event | null>;
```

Adapters call `attachPromptRecord` whenever they have prompt text for a Tier B+ event; adapters never call individual stages. Returns `null` if Stage 3 (verifier) dropped the record — adapter drops the event too.

**Stage implementations:**

1. **Redact** — imports `@bematist/redact` from Walid's package. Runs synchronously. Counters returned for the `redaction_report`.
2. **Abstract** — priority chain implemented in `packages/clio/src/abstract/`:
   - `mcp.ts` — calls local MCP endpoint if available (probe via health check on `ctx.dataDir/.mcp-endpoints.json` written by whichever Claude Code / Codex session is running). Pin the MCP protocol version; open question (contract 06) — start with the minimum needed and bump.
   - `ollama.ts` — POSTs to `http://localhost:11434/api/generate` with Qwen 2.5-7B, 60s timeout. Bundled config ships a recommended `Modelfile` text template but we do NOT download the model — user's responsibility, documented in `devmetrics doctor`.
   - `skip.ts` — returns `{ abstract_pending: true }`; server retries on its permitted models.
3. **Verify** — same priority chain but with the "does this contain identifying content" prompt from contract 06. `YES` → function returns `null` (drop); **no retry ever**.
4. **Embed** — `packages/clio/src/embed/xenova.ts` lazy-loads `@xenova/transformers` MiniLM-L6 on first call, caches loaded model in-process. Keys by `sha256(abstract)` in a separate `clio_embeddings` table (same SQLite file). ~80% cache hit expected on real corpora.
5. **Emit** — returns the mutated `Event` with `prompt_record` attached. Forbidden fields (`rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`) are never attached — enforced by a runtime assert that throws if a caller tries.

**`pipeline_version`** = semver string in `packages/clio/src/version.ts`. Bumped on any stage 1/2/3 rule or prompt-template change. Shipped in every `PromptRecord.redaction_report.pipeline_version`.

### 3.7 Collector-side redact (defense-in-depth)

Before an `Event` is persisted to the egress journal, if it has any Tier-C `prompt_text`/`tool_input`/`tool_output` fields or any `raw_attrs`, it runs through `@bematist/redact` first. Rationale: prevents forbidden content from sitting in local SQLite even briefly (theft-of-laptop threat). **Server re-runs this; server is authoritative.**

### 3.8 Logging & observability

- **Logger:** pino, JSON to stderr. Minimum shape: `{ time, level, msg, adapter, session_id_hash?, client_event_id?, error? }`.
- **Level:** `DEVMETRICS_LOG_LEVEL` env var. Default `warn` (quiet-by-default; dev UX requirement).
- **Metrics:** for M2, emit Prometheus-format text on `:9873/metrics` (local dashboard's same port; gated by `--prom` flag in daemon). Minimal counters: `adapter_events_emitted_total{adapter}`, `adapter_errors_total{adapter}`, `egress_submitted_total`, `egress_failed_total{reason}`, `clio_drops_total{stage}`. Not a Sprint-1 requirement.
- **No Sentry by default**, but `SENTRY_DSN` env var if set enables pino-sentry transport. Off unless user opts in.

### 3.9 Dev-machine policy

Loaded at daemon start from `~/.bematist/policy.yaml` (path overridable via `DEVMETRICS_POLICY_PATH`). Schema in `packages/config/src/policy.ts`:

```yaml
tier: B          # A / B / C — defaults to B (D7)
adapters:
  claude-code: { enabled: true, tier: B, pollIntervalMs: 5000 }
  codex:       { enabled: true, tier: B, pollIntervalMs: 5000 }
  # ...
ingest:
  endpoint: https://ingest.example.com
  onlyTo:   ingest.example.com    # cert pinning
clio:
  reviewBeforePublish: false       # optional user review before egress
```

`devmetrics policy show` prints the effective resolved policy. `devmetrics policy set <key>=<value>` edits the file with atomic write + `.bak` (Phase 0 P0 onboarding safety). `devmetrics dry-run` forces egress worker into log-only mode.

---

## 4. Adapter implementations

Each v1 adapter ships a directory under `apps/collector/src/adapters/<id>/` with:

```
<id>/
  index.ts              # the Adapter class
  discovery.ts          # env / file probing
  parsers/              # vendored field-level parsers from grammata (per file judgment)
  normalize.ts          # raw → Event mapper
  <id>.test.ts          # adapter unit test
  fixtures/             # raw-shape inputs for parser tests (NOT canonical Event[])
```

The canonical golden fixture (already in `packages/fixtures/<id>/session-fixture.jsonl`) is the **output** assertion target; `normalize.ts` tests prove `rawInput → goldenOutput`.

### 4.1 Claude Code — M1

Sprint 1 primary deliverable. The one adapter that must emit real events at M1.

**Two data paths:**

1. **JSONL backfill (primary for M1)** — scans `~/.claude/projects/*/sessions/*.jsonl` on every poll. For each file, maintains a byte-offset cursor (`jsonl-offset:<path>` in `CursorStore`); reads only new lines since last poll using a line-oriented `readline` stream over `fs.createReadStream` — **drops the 50 MB silent-drop limit from grammata** (Phase 0 P0). Each new JSONL entry runs through:
   - `parsers/parseSessionFile.ts` — reimplemented from grammata's `src/claude.ts` (source in the `pharos` repo) with the `Map<requestId, usage>` keyed dedup + max-per-field (D17).
   - `normalize.ts` — maps parsed objects to `Event[]` matching the canonical schema. Each Event gets `client_event_id = hash(source, session_id, event_seq, raw_event_hash)`.
   - `durationMs` for Claude sessions = `lastTimestamp − firstTimestamp` across the file (D17).
   - `pricing_version` stamped on every `llm_response`-derived event with `cost_usd` (D21 — LiteLLM JSON commit SHA captured at ingest time).
2. **OTEL discovery (M1 light, receiver M2)** — detect `CLAUDE_CODE_ENABLE_TELEMETRY=1`; surface in `health().caveats`. M1 ships discovery + a caveat advising the user to enable JSONL-only capture until the OTLP receiver lands. **The actual OTLP HTTP receiver on `:4318` loopback is M2 work** (see §4.1.1 below) — this unblocks Walid's M1 gate because JSONL alone satisfies "first event E2E".

**Fidelity:** `"full"` (per CLAUDE.md adapter matrix). Caveats set only when both `CLAUDE_CODE_ENABLE_TELEMETRY=0` and `~/.claude/projects` missing → `status: "disabled"`.

**Hook fallback — M2.** Append a `SessionStart` + `SessionStop` hook entry to `~/.claude/settings.json` via `devmetrics install --with-claude-hooks`. Writes use atomic-write + `.bak` + diff preview; honor `CLAUDE_CONFIG_DIR`; never clobber unrelated keys (Phase 0 P0 onboarding safety, D17).

#### 4.1.1 OTLP HTTP receiver — M2

Second path for live capture. Bun-native HTTP server listening on `127.0.0.1:4318` only (loopback; not externally reachable). Accepts POST on `/v1/{traces,metrics,logs}` (OTLP HTTP/Protobuf and JSON both). Maps OTel `gen_ai.*` + `dev_metrics.*` attributes to the canonical `Event` shape using `packages/otel`'s mapping helpers. Events land in the same egress journal. Claude Code is configured to point its telemetry at `127.0.0.1:4318` via `install --with-claude-otel` or manual env export.

### 4.2 Codex CLI — M2

JSONL tail of wherever Codex logs. Cumulative `token_count` values must be diffed against the previous running total stored in cursor (`codex-session-total:<session_id>` → JSON `{ input, output, cache_read, cache_creation }`). Survives restart because totals are in SQLite, not memory. Emits `dev_metrics.first_try_failure` on `exec_command_end.exit_code != 0` and `patch_apply_end.success=false` events (Phase 0 P0 `firstTryRate` fix, D17).

**Fidelity:** `"full"` with caveat "cumulative token-count diffing".

### 4.3 Cursor — M2

Read-only SQLite: each poll opens `~/Library/Application Support/Cursor/sessions.db` (or platform equivalent) with `file:...?mode=ro`; **never UPDATE/INSERT**. Copy-and-read pattern for atomicity: `fs.copyFileSync` to `${dataDir}/cursor.db.snapshot`, query the snapshot, delete. Maintains a `cursor:<path>` cursor on the max session-ordinal read.

**Auto-mode detection:** read the Cursor settings JSON (discovery step); if `mode == "auto"` set `cost_estimated: true` on every emitted event and set `fidelity: "estimated"`. Pro mode: `fidelity: "full"`.

Emits `first_try_failure` on `toolFormerData.additionalData.status='error'` rows.

### 4.4 OpenCode — M2

Post-v1.2 SQLite read-only (same pattern as Cursor, different path). Pre-v1.2 sharded JSON **skipped with a warning** in `health().caveats`. Orphaned sessions (rows with missing parent refs) skipped with counter.

**Fidelity:** `"post-migration"`.

### 4.5 Continue.dev — M2

Four discrete JSONL streams at `~/.continue/dev_data/0.2.0/{chatInteraction,tokensGenerated,editOutcome,toolUsage}.jsonl`. **One adapter, four cursor keys** (`continue-offset:chatInteraction`, etc.) — decision per contract 03 Open Q. `normalize.ts` fans the four streams into the unified `Event[]` sequence, ordered by timestamp.

**Fidelity:** `"full"` (richest native telemetry of any source).

### 4.6 VS Code generic — M2

Adapter SDK consumer entrypoint. Ship one real example adapter (probably a simple one that reads `~/.vscode-server/logs/*.log` for a nominated extension) to prove the SDK works end-to-end and to seed docs. Community additions are additive; v1 plugin-loading-at-runtime stays disabled.

---

## 5. Cross-cutting work (by checkpoint)

### 5.1 Phase 0 P0 fixes (D17) — M1 + M2

**M1 (Claude Code scope):**

- Reimplemented `parseSessionFile` with `Map<requestId, usage>` keyed dedup + max-per-field; captured-JSONL vitest fixtures asserting `maxPerRid === naiveSum` only on the clean control case.
- `durationMs = lastTimestamp − firstTimestamp` for Claude sessions; unit test with a fixture containing a mid-session 30-minute idle gap.
- Safe file reader: `readline` over `createReadStream` with no size cap; test with a 60 MB synthetic JSONL fixture.
- Pricing-version on every `cost_usd` event (D21); banner rendering is Sandesh's concern — we just emit the field.
- LiteLLM JSON freshness probe — daemon fetches `model_prices_and_context_window.json` on boot + every 24 h; emits a `health().caveats` warning if older than 7 days. Path: `packages/config/src/pricing.ts`. Pinned commit SHA in `devmetrics --version`.
- Onboarding safety: atomic write + `.bak` + unified diff preview for every file the installer touches (`~/.claude/settings.json`, `~/.continue/config.json`, etc.); honor `CLAUDE_CONFIG_DIR`; never clobber foreign keys (read-modify-write on a parsed object, preserve unknown keys).

**M2 (cross-adapter scope):**

- `first_try_failure` normalization across Codex + Cursor as above (D17).

### 5.2 AI-Assisted commit trailer (D29) — M2

`devmetrics policy set ai-assisted-trailer=on` enables a local `post-commit` git hook:

```bash
#!/usr/bin/env bash
# .git/hooks/post-commit — installed by bematist
sid=$(bematist _current-session-id 2>/dev/null) || exit 0
[ -n "$sid" ] || exit 0
git log -1 --pretty=%B | grep -q "^AI-Assisted:" && exit 0
msg=$(git log -1 --pretty=%B)
printf '%s\n\nAI-Assisted: bematist-%s\n' "$msg" "$sid" | git commit --amend -F -
```

Hook file written atomically via `devmetrics install`. Active session id is whatever adapter emitted the most recent event in the last 15 min (simple heuristic; documented). Never amends commits that already carry the trailer.

### 5.3 CLI commands

**M2:**

| Command | Behavior |
|---|---|
| `devmetrics status` | Adapter list + health + last event timestamp + queue depth + binary SHA. |
| `devmetrics audit --tail [-n N]` | Dumps last N `events` rows from the egress journal as newline-delimited JSON. |
| `devmetrics dry-run` | Forces egress worker into log-only mode for the current process. |
| `devmetrics policy show` / `set k=v` | Prints / edits the policy YAML. |
| `devmetrics doctor` | ulimit check, binary signature SHA, ingest reachability, adapter health, LiteLLM freshness. |
| `devmetrics purge --session <id>` | DELETE from events WHERE json_extract(body_json,'$.session_id')=? — local only. |
| `devmetrics outcomes` | Cost per merged PR / commit / green test for this project. Reads local egress journal + git log; for Sprint 2 the ingest join-side version is not required. |
| `devmetrics waste` | In-session anti-pattern report (heuristic Waste Radar — PRD §8.2). |
| `devmetrics prompts` | Personal prompt-quality patterns with cohort sizes (local abstracted-prompt view, read-only). |

**M3:**

| Command | Behavior |
|---|---|
| `devmetrics install` | Installer — detects every IDE on the machine, configures adapters, registers daemon (launchd/systemd/service). Runs Phase 0 P0 onboarding-safe writes. |
| `devmetrics erase --user <id> --org <id>` | POST `/v1/gdpr/erase` on ingest (triggers Jorge's partition-drop worker); after 202 response, local SQLite is also wiped for that scope. |
| `devmetrics export --compliance` | Phase-2-only per PRD; signed JSON bundle + SHA-256 manifest. Scaffolded in M3, full rollout post-MVP. |
| `devmetrics scan --phi` | Phase-3-only per PRD; scaffolded-not-implemented at M3. |
| `devmetrics serve --embedded` | Single-binary solo mode: starts bundled Postgres+TimescaleDB via Docker-in-binary or a child process, plus a tiny Next.js static export at `:9873`. Scope for M3 is "works on a demo machine"; production hardening Phase 2. |

### 5.4 Binary build + signing — M3

- `bun build --compile --target bun-<platform>` for macos-arm64, macos-x64, linux-x64, linux-arm64, windows-x64. One GH Actions matrix job per target.
- Output binaries consumed by Sebastian's SLSA L3 + Sigstore + cosign reusable workflow. David's job: produce the binaries and supply the metadata (`devmetrics --version` prints build SHA + pricing-version pin); **Sebastian owns the signing pipeline itself**.
- Distro packages (Homebrew formula, apt `.deb`, AUR PKGBUILD, Chocolatey `.nuspec`) authored by Sebastian; David provides a stable CLI surface and release asset names.

---

## 6. Testing strategy

Per CLAUDE.md §Testing Rules and user's `tdd.md`:

- **Co-located `*.test.ts`** next to every source file with behavior worth asserting.
- **Per-workstream minimum B ≥ 30 tests** (PRD §10 Phase 1). Spread across adapters (6+ per adapter = 36+), shared infrastructure (egress journal, orchestrator, Clio plumbing, policy loader — ~15), CLI (~10).
- **TDD ordering:** each new behavior = failing test first → minimum implementation → refactor. Documented in commits.
- **Per-adapter golden-fixture contract test** (release gate): `packages/fixtures/<id>/session-fixture.jsonl` is the assertion target; `normalize.ts`-level test consumes raw-shape input and asserts the exact canonical `Event[]` output.
- **Collector side of privacy adversarial gate (M2 MERGE BLOCKER)** — `bun run test:privacy` (authored by Walid) must pass when the collector is in the pipeline. Collector contribution: 100 % refuse-to-emit on seeded forbidden fields; pipe Clio verifier drops correctly; `raw_attrs` respects Tier-A allowlist boundaries at the collector boundary too (defense-in-depth).
- **Perf (M2 MERGE BLOCKER)** — Sebastian scaffolds k6; David's contribution is ensuring the collector sustains all 6 adapters polling at default intervals on a developer laptop without pegging CPU or exceeding 50 MB RSS. Measured by a k6 script that feeds synthetic JSONL at realistic rates (`packages/fixtures/<id>/synthetic-1h.jsonl`).

---

## 7. Checkpoint gates — what ships at each PR boundary

### 7.1 M1 gate — "first event end-to-end"

**Acceptance criteria — every item is a merge-blocker for tagging M1:**

- ☐ Claude Code JSONL adapter emits real `Event[]` from a real `~/.claude/projects/*/sessions/*.jsonl` on the developer's machine.
- ☐ `bun run test` green; at least 10 new Claude-Code-adapter tests landed.
- ☐ Event flows: adapter → egress journal (SQLite) → egress worker → Walid's `/v1/events` → 202 Accepted → `submitted_at` set.
- ☐ Jorge's ClickHouse `events` table receives the row; `dev_daily_rollup` MV populates for that engineer.
- ☐ Sandesh's single dashboard tile (cost-over-7d) renders from real data — not a mock.
- ☐ Phase 0 P0 for Claude Code: `parseSessionFile` dedup, `durationMs` fix, safe file reader, pricing-version stamped, onboarding safety on any file write.
- ☐ Egress journal survives a kill -9 + restart: pending rows still pending, no dupes on resend (SETNX on ingest side proves this).
- ☐ `devmetrics status` + `devmetrics audit --tail` + `devmetrics dry-run` work.
- ☐ M0 contract drift (`@devmetrics/*` → `@bematist/*`) fixed with additive changelog bump on contracts 01/03/06.

**PR:** single branch into `main`, reviewed by at least one consumer (Walid or Jorge makes sense — Walid sees the wire, Jorge sees the landing).

### 7.2 M2 gate — "feature-complete MVP"

All merge-blockers from WORKSTREAMS.md §M2 that touch David + Collector-owned:

- ☐ All 6 v1 adapters working with golden fixtures: Claude Code (JSONL + OTLP receiver + hook fallback), Codex, Cursor, OpenCode, Continue.dev, VS Code generic.
- ☐ On-device Clio pipeline wired into every adapter that captures prompt text. Stage-2 priority chain (MCP → Ollama → skip) implemented. Stage-3 verifier drops work.
- ☐ CLI M2 set landed: status, audit --tail, dry-run, policy, doctor, purge, outcomes, waste, prompts.
- ☐ AI-Assisted commit trailer (D29) opt-in flow working end to end.
- ☐ Collector side of privacy adversarial gate green (≥ 98 % secret recall attributable to Clio stage 1 calling `@bematist/redact`; 100 % forbidden-field refuse-to-emit).
- ☐ Perf: collector sustains 6-adapter poll rate on a dev laptop, RSS < 50 MB, CPU < 5 % median at idle.
- ☐ Per-adapter contract tests pinned to golden fixtures — each one is its own PR-review gate.
- ☐ Phase 0 P0 cross-adapter: `first_try_failure` normalized across Codex + Cursor.

**PR:** one or two branches (splitting by "adapter suite" vs "Clio + CLI" is reasonable) into `main`; both reviewed at the M2 integration window.

### 7.3 M3 gate — "PoC ship"

- ☐ `bun build --compile` produces per-OS binaries for macOS-arm64 / macOS-x64 / linux-x64 / linux-arm64 / windows-x64.
- ☐ Binaries consumed by Sebastian's SLSA L3 + Sigstore + cosign signed-release workflow. David's side: stable CLI surface + release asset names + `devmetrics --version` prints build SHA + pricing-version pin.
- ☐ `devmetrics install` works on a fresh user account on each target OS; writes a systemd-user / launchd / Windows Service unit; registers adapter configs for every IDE it detects.
- ☐ `devmetrics erase` round-trip verified (INT12 GDPR E2E per CLAUDE.md §Testing Rules).
- ☐ `devmetrics serve --embedded` brings up the local stack and opens `:9873` on a demo machine.
- ☐ 15-minute fresh-install → capture → dashboard tile test passes on macOS, Windows, Linux (PRD §10 Phase 1 acceptance).
- ☐ All Phase 0 P0 items verified green (D17 full checklist).
- ☐ `export --compliance` and `scan --phi` scaffolded (not full rollout — Phase 2/3 per PRD).

**PR:** one final branch into `main` for polish / bug-bash / binary tooling.

---

## 8. Risks & open questions

- **Raw Claude Code JSONL schema drift.** Claude Code releases every few days; the JSONL shape can change. Mitigation: golden fixture committed from a known-good session; contract test asserts exact field set; adapter must fail-loud on unknown top-level keys (not silent-skip). Source-of-truth for the real shape: the `pharos` repo's `src/claude.ts` parseSessionFile — read it before landing M1 code.
- **bun:sqlite crash-resume atomicity.** WAL mode + `synchronous=NORMAL` is not `fsync`-after-every-commit. If power is lost mid-write, the last batch of inserts may vanish. Mitigation: `client_event_id` is deterministic, so a lost insert re-appears on the next poll; SETNX dedups. Document that the guarantee is at-least-once-after-fsync, which is fine for analytics.
- **`bun build --compile` maturity.** Native compilation story is maturing; Windows-x64 especially may have quirks. Mitigation: CI matrix catches breakage early; fallback is `bun install -g bematist-cli` which is Node-ish (Bun-runtime-required) — less elegant but ships.
- **MCP surface for "user's own Claude Code / Codex abstractor".** No stable cross-vendor contract yet; pin to the version we observe at implementation time, design a swap-able provider interface in `packages/clio/src/abstract/`, bump as upstream evolves.
- **Cross-platform paths in discovery.** `~/.claude/projects/` is a POSIX shape; Windows is `%AppData%\.claude\projects\`. Abstracted via `packages/config/src/paths.ts`; test with a mock filesystem.
- **`RLIMIT_CORE` on Windows.** Not a direct concept. Use `SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX)` as the closest analog; `devmetrics doctor` explains the platform difference.
- **`ai-assisted-trailer` on repos with `pre-commit` hook frameworks.** Husky / lefthook may overwrite or chain our hook. Mitigation: our installer detects those frameworks and instead adds a `lefthook.yml` / `.husky/post-commit` entry; falls back to direct hook file if none detected. Document limitation.

---

## 9. References

- GH Issue [#1](https://github.com/pella-labs/bematist/issues/1) — authoritative task list
- `WORKSTREAMS.md` — team mapping, checkpoints, dependency graph
- `dev-docs/PRD.md` — §5 architecture, §8.7 Clio, §9 adapter matrix, §10 Phase 0 P0 + Phase 1 B, §11 distribution
- `CLAUDE.md` — locked conventions, adapter matrix, privacy rules, env vars
- `contracts/01-event-wire.md`, `contracts/02-ingest-api.md`, `contracts/03-adapter-sdk.md`, `contracts/06-clio-pipeline.md`, `contracts/08-redaction.md`
- `pharos` repo (https://github.com/pella-labs/pharos) — reference source for grammata's `src/claude.ts` parseSessionFile (reimplement with D17 fixes; do not install as a dep)

## 10. Changelog

- 2026-04-16 — initial draft (David, via brainstorming skill)
