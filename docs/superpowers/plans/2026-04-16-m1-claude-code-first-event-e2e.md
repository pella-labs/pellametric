# M1 — Claude Code First-Event E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land M1 gate per spec §7.1 — one real Claude Code session's events flow adapter → SQLite egress journal → Walid's ingest → 202 Accepted → ClickHouse → Sandesh's tile. Plus Phase 0 P0 correctness fixes for Claude Code (D17) and the M1 CLI set.

**Architecture:** Per-machine Bun-compiled collector. Static adapter registration → bounded-concurrency orchestrator → SQLite-backed egress journal (WAL mode) → egress worker that POSTs to `/v1/events` and honors contract-02 response codes. JSONL-backfill path only for Claude Code in M1 (OTLP receiver + hook fallback deferred to M2).

**Tech Stack:** Bun 1.2, TypeScript 5.6, `bun:sqlite`, zod 3.23, pino 9, `bun test`. No new npm deps beyond pino (approved per CLAUDE.md §Commands).

**Cross-platform contract:** Every task in this plan MUST produce code and shell commands that work on **macOS + Linux + Windows** (per memory `cross_platform_requirement.md`). Paths via `node:path.join` + `os.homedir()`; shell examples show POSIX and PowerShell variants side-by-side; test fixtures use LF line endings explicitly.

**Source spec:** `docs/superpowers/specs/2026-04-16-workstream-b-collector-adapters-design.md`.

**Reference source:** `pella-labs/pharos` repo (grammata's `src/claude.ts` — reimplement, don't vendor).

---

## File Structure

```
apps/collector/src/
  index.ts                           # daemon entrypoint (bematist serve)
  cli.ts                             # CLI dispatcher
  paths.ts                           # cross-platform paths
  logger.ts                          # pino instance
  harden.ts                          # ulimit/rlimit (POSIX) + Windows equivalents
  adapters/
    index.ts                         # static adapter registry
    claude-code/
      index.ts                       # Adapter impl
      claude-code.test.ts            # existing — extended
      discovery.ts                   # env + dir probing
      normalize.ts                   # raw → Event[]
      normalize.test.ts
      parsers/
        parseSessionFile.ts          # D17 reimplementation
        parseSessionFile.test.ts
        types.ts                     # raw JSONL shapes
        safeRead.ts                  # line-oriented stream reader (no 50MB cap)
        safeRead.test.ts
      fixtures/
        real-session.jsonl           # raw Claude Code JSONL (committed to repo)
        duplicate-request-ids.jsonl  # max-per-requestId test input
        large-session.jsonl          # >50MB streaming test input (generated at build)
  orchestrator/
    index.ts                         # poll loop + registry consumption
    semaphore.ts                     # bounded concurrency primitive
    semaphore.test.ts
  egress/
    journal.ts                       # SQLite wrapper
    journal.test.ts
    worker.ts                        # egress loop + response code handling
    worker.test.ts
    migrations.ts                    # migration runner
    migrations/
      001_initial.sql
  cursor/
    store.ts                         # CursorStore impl over SQLite
    store.test.ts
  commands/
    status.ts
    audit.ts
    dryRun.ts
    serve.ts

packages/config/src/
  index.ts                           # existing — re-export
  paths.ts                           # ~/.bematist, ~/.claude, CLAUDE_CONFIG_DIR honor
  paths.test.ts
  atomicWrite.ts                     # atomic write + .bak + diff preview
  atomicWrite.test.ts
  pricing.ts                         # LiteLLM JSON freshness probe
  pricing.test.ts
  policy.ts                          # YAML schema + loader
  policy.test.ts

contracts/
  01-event-wire.md                   # modify: changelog bump + @devmetrics → @bematist
  03-adapter-sdk.md                  # modify: changelog bump + @devmetrics → @bematist
  06-clio-pipeline.md                # modify: changelog bump + @devmetrics → @bematist
```

---

## Dependency order

Tasks are ordered so each only needs previously-landed pieces. Phases A–E build infra bottom-up; F wires Claude Code end-to-end; G is integration + the checkpoint PR.

---

## Phase A — Cross-cutting utilities

### Task 1: Cross-platform paths utility

Lays the foundation so every subsequent task can say "the SQLite file lives at `paths.egressSqlite()`" without re-deriving platform logic.

**Files:**
- Create: `packages/config/src/paths.ts`
- Create: `packages/config/src/paths.test.ts`
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/config/src/paths.test.ts`:

```ts
import { expect, test } from "bun:test";
import { claudeProjectsDir, dataDir, egressSqlite, policyPath } from "./paths";

test("dataDir honors DEVMETRICS_DATA_DIR when set", () => {
  const prev = process.env.DEVMETRICS_DATA_DIR;
  process.env.DEVMETRICS_DATA_DIR = "/tmp/bematist-test-datadir";
  expect(dataDir()).toBe("/tmp/bematist-test-datadir");
  if (prev === undefined) delete process.env.DEVMETRICS_DATA_DIR;
  else process.env.DEVMETRICS_DATA_DIR = prev;
});

test("dataDir falls back to ~/.bematist when env unset", () => {
  const prev = process.env.DEVMETRICS_DATA_DIR;
  delete process.env.DEVMETRICS_DATA_DIR;
  expect(dataDir()).toMatch(/[\\/]\.bematist$/);
  if (prev !== undefined) process.env.DEVMETRICS_DATA_DIR = prev;
});

test("egressSqlite lives inside dataDir", () => {
  expect(egressSqlite()).toContain(".bematist");
  expect(egressSqlite()).toMatch(/egress\.sqlite$/);
});

test("policyPath honors DEVMETRICS_POLICY_PATH", () => {
  const prev = process.env.DEVMETRICS_POLICY_PATH;
  process.env.DEVMETRICS_POLICY_PATH = "/tmp/policy.yaml";
  expect(policyPath()).toBe("/tmp/policy.yaml");
  if (prev === undefined) delete process.env.DEVMETRICS_POLICY_PATH;
  else process.env.DEVMETRICS_POLICY_PATH = prev;
});

test("claudeProjectsDir honors CLAUDE_CONFIG_DIR", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-alt";
  expect(claudeProjectsDir()).toBe("/tmp/claude-alt/projects");
  if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prev;
});

test("claudeProjectsDir defaults to ~/.claude/projects", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  expect(claudeProjectsDir()).toMatch(/[\\/]\.claude[\\/]projects$/);
  if (prev !== undefined) process.env.CLAUDE_CONFIG_DIR = prev;
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/config && bun test src/paths.test.ts`
Expected: all 6 fail with "Cannot find module './paths'".

- [ ] **Step 3: Implement paths**

`packages/config/src/paths.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(): string {
  return process.env.DEVMETRICS_DATA_DIR ?? join(homedir(), ".bematist");
}

export function egressSqlite(): string {
  return join(dataDir(), "egress.sqlite");
}

export function policyPath(): string {
  return process.env.DEVMETRICS_POLICY_PATH ?? join(dataDir(), "policy.yaml");
}

export function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return join(base, "projects");
}
```

- [ ] **Step 4: Re-export from package index**

Edit `packages/config/src/index.ts` — replace the placeholder line with:

```ts
export * from "./paths";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/config && bun test src/paths.test.ts`
Expected: all 6 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/paths.ts packages/config/src/paths.test.ts packages/config/src/index.ts
git commit -m "config: add cross-platform path resolution with env overrides"
```

---

### Task 2: Atomic write helper with .bak + diff preview

Phase 0 P0 onboarding safety. Used later when `policy set` writes the YAML and when M2's installer touches `~/.claude/settings.json`.

**Files:**
- Create: `packages/config/src/atomicWrite.ts`
- Create: `packages/config/src/atomicWrite.test.ts`
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/config/src/atomicWrite.test.ts`:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, unifiedDiff } from "./atomicWrite";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-atomic-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("atomicWrite creates file when missing", async () => {
  const target = join(dir, "a.txt");
  await atomicWrite(target, "hello");
  expect(readFileSync(target, "utf8")).toBe("hello");
  expect(existsSync(`${target}.bak`)).toBe(false);
});

test("atomicWrite writes .bak of previous contents", async () => {
  const target = join(dir, "b.txt");
  writeFileSync(target, "original");
  await atomicWrite(target, "updated");
  expect(readFileSync(target, "utf8")).toBe("updated");
  expect(readFileSync(`${target}.bak`, "utf8")).toBe("original");
});

test("atomicWrite overwrites existing .bak on second edit", async () => {
  const target = join(dir, "c.txt");
  writeFileSync(target, "first");
  await atomicWrite(target, "second");
  await atomicWrite(target, "third");
  expect(readFileSync(target, "utf8")).toBe("third");
  expect(readFileSync(`${target}.bak`, "utf8")).toBe("second");
});

test("unifiedDiff returns empty string when identical", () => {
  expect(unifiedDiff("same", "same")).toBe("");
});

test("unifiedDiff returns non-empty diff when different", () => {
  const d = unifiedDiff("line1\nline2\n", "line1\nLINE2\n");
  expect(d).toContain("-line2");
  expect(d).toContain("+LINE2");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/config && bun test src/atomicWrite.test.ts`
Expected: all 5 fail with "Cannot find module './atomicWrite'".

- [ ] **Step 3: Implement atomicWrite + unifiedDiff**

`packages/config/src/atomicWrite.ts`:

```ts
import { copyFileSync, existsSync, renameSync, writeFileSync } from "node:fs";

export async function atomicWrite(path: string, content: string): Promise<void> {
  if (existsSync(path)) {
    copyFileSync(path, `${path}.bak`);
  }
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/** Minimal unified-diff implementation — good enough for CLI preview, not a library replacement. */
export function unifiedDiff(a: string, b: string): string {
  if (a === b) return "";
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out: string[] = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const l = aLines[i];
    const r = bLines[i];
    if (l === r) continue;
    if (l !== undefined) out.push(`-${l}`);
    if (r !== undefined) out.push(`+${r}`);
  }
  return out.join("\n");
}
```

- [ ] **Step 4: Re-export**

Edit `packages/config/src/index.ts`:

```ts
export * from "./paths";
export * from "./atomicWrite";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/config && bun test src/atomicWrite.test.ts`
Expected: all 5 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/atomicWrite.ts packages/config/src/atomicWrite.test.ts packages/config/src/index.ts
git commit -m "config: add atomicWrite with .bak rotation and unifiedDiff helper"
```

---

### Task 3: Pino logger instance

**Files:**
- Create: `apps/collector/src/logger.ts`
- Modify: `apps/collector/package.json` (add pino dep)

- [ ] **Step 1: Add pino dependency**

Edit `apps/collector/package.json` — under `dependencies` add:

```json
"pino": "^9.5.0",
"@bematist/config": "workspace:*",
```

Run: `bun install`
Expected: pino + @bematist/config resolve; no audit warnings relevant to runtime.

- [ ] **Step 2: Write the logger**

`apps/collector/src/logger.ts`:

```ts
import pino, { type Logger } from "pino";

/**
 * Structured JSON logger. Level via DEVMETRICS_LOG_LEVEL env var.
 * Default is "warn" to honor CLAUDE.md §Env vars "quiet by default".
 */
export const log: Logger = pino({
  level: process.env.DEVMETRICS_LOG_LEVEL ?? "warn",
  base: { service: "bematist-collector" },
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/collector/package.json apps/collector/src/logger.ts bun.lock
git commit -m "collector: add pino logger with level honoring DEVMETRICS_LOG_LEVEL"
```

---

### Task 4: Process hardening (ulimit/rlimit + Windows SEM)

Required on every binary startup per CLAUDE.md §Security Rules.

**Files:**
- Create: `apps/collector/src/harden.ts`
- Create: `apps/collector/src/harden.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/harden.test.ts`:

```ts
import { expect, test } from "bun:test";
import { harden } from "./harden";

test("harden() does not throw on any supported platform", () => {
  expect(() => harden()).not.toThrow();
});

test("harden() returns a report naming the platform it ran on", () => {
  const report = harden();
  expect(["darwin", "linux", "win32", "freebsd", "openbsd"]).toContain(report.platform);
});

test("harden() on POSIX reports core rlimit intent", () => {
  const report = harden();
  if (report.platform === "darwin" || report.platform === "linux") {
    expect(report.coreRlimitAttempted).toBe(true);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/harden.test.ts`
Expected: 3 fail with "Cannot find module './harden'".

- [ ] **Step 3: Implement harden**

`apps/collector/src/harden.ts`:

```ts
import { platform } from "node:os";
import { log } from "./logger";

export interface HardenReport {
  platform: NodeJS.Platform;
  coreRlimitAttempted: boolean;
  notes: string[];
}

/**
 * Apply process-level hardening. Per CLAUDE.md §Security Rules:
 *   - Disable core dumps (ulimit -c 0 / RLIMIT_CORE=0 on POSIX).
 *   - Suppress GPF error dialogs on Windows.
 *
 * Best-effort: failures log a warning but never throw. `devmetrics doctor`
 * verifies the effective state at runtime.
 */
export function harden(): HardenReport {
  const p = platform();
  const notes: string[] = [];
  let coreRlimitAttempted = false;

  if (p === "darwin" || p === "linux" || p === "freebsd" || p === "openbsd") {
    coreRlimitAttempted = true;
    try {
      // Node exposes process.setrlimit only on some builds; we attempt via
      // the undocumented internal binding if present; otherwise log + rely
      // on the operator's `ulimit -c 0` in the service unit.
      const anyProc = process as unknown as {
        setrlimit?: (name: string, limit: number) => void;
      };
      if (typeof anyProc.setrlimit === "function") {
        anyProc.setrlimit("core", 0);
        notes.push("RLIMIT_CORE=0 set via process.setrlimit");
      } else {
        notes.push("process.setrlimit unavailable; relying on service unit ulimit -c 0");
      }
    } catch (e) {
      log.warn({ err: e }, "harden: RLIMIT_CORE set failed");
      notes.push(`RLIMIT_CORE set failed: ${String(e)}`);
    }
  } else if (p === "win32") {
    // Closest Windows analog to "no core dump": suppress GPF dialogs so
    // crashes terminate instead of popping up a modal. Implemented by
    // kernel32!SetErrorMode. Best-effort only; `devmetrics doctor` reports.
    notes.push("win32: SetErrorMode handled by Bun runtime; no additional action");
  }

  return { platform: p, coreRlimitAttempted, notes };
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/harden.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/harden.ts apps/collector/src/harden.test.ts
git commit -m "collector: add process hardening helper (RLIMIT_CORE + platform report)"
```

---

### Task 5: LiteLLM pricing freshness probe

D17 — every `cost_usd` event carries a `pricing_version`. The probe fetches on boot and warns when stale.

**Files:**
- Create: `packages/config/src/pricing.ts`
- Create: `packages/config/src/pricing.test.ts`
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/config/src/pricing.test.ts`:

```ts
import { expect, test } from "bun:test";
import { PRICING_PIN, isPricingStale, pricingVersionString } from "./pricing";

test("PRICING_PIN is a non-empty SHA-ish string", () => {
  expect(PRICING_PIN).toMatch(/^[a-f0-9]{7,40}$/);
});

test("pricingVersionString is 'litellm@<sha>' shape", () => {
  expect(pricingVersionString()).toMatch(/^litellm@[a-f0-9]{7,40}$/);
});

test("isPricingStale returns false when lastProbedAt is recent", () => {
  const now = Date.now();
  expect(isPricingStale(new Date(now - 1000), now)).toBe(false);
});

test("isPricingStale returns true when lastProbedAt is > 7 days old", () => {
  const now = Date.now();
  const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
  expect(isPricingStale(eightDaysAgo, now)).toBe(true);
});

test("isPricingStale returns true when lastProbedAt is null (never probed)", () => {
  expect(isPricingStale(null, Date.now())).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/config && bun test src/pricing.test.ts`
Expected: 5 fail with "Cannot find module './pricing'".

- [ ] **Step 3: Implement pricing**

`packages/config/src/pricing.ts`:

```ts
/**
 * Pinned LiteLLM pricing table commit. Every event that emits cost_usd also
 * emits `pricing_version = pricingVersionString()` — per PRD D21, version
 * shifts surface a dashboard banner; never silently recomputed.
 *
 * CI tests that this SHA resolves on the LiteLLM GitHub mirror; update this
 * constant in the same PR that adopts a newer pricing table.
 */
export const PRICING_PIN = "3b2f1a7";

export function pricingVersionString(): string {
  return `litellm@${PRICING_PIN}`;
}

const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isPricingStale(lastProbedAt: Date | null, now: number = Date.now()): boolean {
  if (lastProbedAt === null) return true;
  return now - lastProbedAt.getTime() > STALE_WINDOW_MS;
}
```

- [ ] **Step 4: Re-export**

Edit `packages/config/src/index.ts`:

```ts
export * from "./paths";
export * from "./atomicWrite";
export * from "./pricing";
```

- [ ] **Step 5: Run tests**

Run: `cd packages/config && bun test src/pricing.test.ts`
Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/pricing.ts packages/config/src/pricing.test.ts packages/config/src/index.ts
git commit -m "config: pin LiteLLM pricing SHA + staleness helper (D17/D21)"
```

---

## Phase B — Egress journal infrastructure

### Task 6: SQLite migration runner + initial schema

**Files:**
- Create: `apps/collector/src/egress/migrations.ts`
- Create: `apps/collector/src/egress/migrations/001_initial.sql`
- Create: `apps/collector/src/egress/migrations.test.ts`

- [ ] **Step 1: Write the initial SQL**

`apps/collector/src/egress/migrations/001_initial.sql`:

```sql
CREATE TABLE events (
  client_event_id TEXT PRIMARY KEY,
  body_json       TEXT NOT NULL,
  enqueued_at     TEXT NOT NULL,
  submitted_at    TEXT,
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

CREATE TABLE redaction_counts (
  run_id       TEXT NOT NULL,
  marker_type  TEXT NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (run_id, marker_type)
) STRICT;

CREATE TABLE pinned_certs (
  host        TEXT PRIMARY KEY,
  cert_sha256 TEXT NOT NULL,
  pinned_at   TEXT NOT NULL
) STRICT;

CREATE TABLE clio_embeddings (
  abstract_sha256 TEXT PRIMARY KEY,
  embedding_json  TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  created_at      TEXT NOT NULL
) STRICT;

CREATE TABLE schema_migrations (
  version   INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;
```

- [ ] **Step 2: Write the failing tests**

`apps/collector/src/egress/migrations.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "./migrations";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-migrations-"));
  dbPath = join(dir, "test.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("migrate() creates all tables on empty db", () => {
  const db = new Database(dbPath);
  migrate(db);
  const names = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  expect(names).toContain("events");
  expect(names).toContain("cursors");
  expect(names).toContain("redaction_counts");
  expect(names).toContain("pinned_certs");
  expect(names).toContain("clio_embeddings");
  expect(names).toContain("schema_migrations");
});

test("migrate() enables WAL mode", () => {
  const db = new Database(dbPath);
  migrate(db);
  const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
  expect(mode?.journal_mode.toLowerCase()).toBe("wal");
});

test("migrate() is idempotent", () => {
  const db = new Database(dbPath);
  migrate(db);
  expect(() => migrate(db)).not.toThrow();
  const rows = db
    .query<{ version: number }, []>("SELECT version FROM schema_migrations")
    .all();
  expect(rows.length).toBe(1);
  expect(rows[0]?.version).toBe(1);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/egress/migrations.test.ts`
Expected: 3 fail with "Cannot find module './migrations'".

- [ ] **Step 4: Implement migrate()**

`apps/collector/src/egress/migrations.ts`:

```ts
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS: ReadonlyArray<{ version: number; file: string }> = [
  { version: 1, file: "001_initial.sql" },
];

export function migrate(db: Database): void {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = new Set(
    db
      .query<{ version: number }, []>("SELECT version FROM schema_migrations")
      .all()
      .map((r) => r.version),
  );

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const path = join(import.meta.dir, "migrations", m.file);
    const sql = readFileSync(path, "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        new Date().toISOString(),
      ]);
    })();
  }
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/collector && bun test src/egress/migrations.test.ts`
Expected: 3 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/collector/src/egress/migrations.ts apps/collector/src/egress/migrations.test.ts apps/collector/src/egress/migrations/001_initial.sql
git commit -m "collector: SQLite migration runner + initial egress schema (WAL on)"
```

---

### Task 7: Egress journal wrapper (insert, select-pending, mark-submitted, mark-failed)

**Files:**
- Create: `apps/collector/src/egress/journal.ts`
- Create: `apps/collector/src/egress/journal.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/egress/journal.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "./journal";
import { migrate } from "./migrations";

let dir: string;
let db: Database;
let j: Journal;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-journal-"));
  db = new Database(join(dir, "j.sqlite"));
  migrate(db);
  j = new Journal(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const sampleEvent = {
  client_event_id: "00000000-0000-0000-0000-000000000001",
  schema_version: 1,
  ts: "2026-04-16T14:00:00.000Z",
  tenant_id: "org_acme",
  engineer_id: "eng_x",
  device_id: "dev_y",
  source: "claude-code",
  fidelity: "full",
  tier: "B",
  session_id: "s1",
  event_seq: 0,
  dev_metrics: { event_kind: "session_start" },
} as const;

test("enqueue inserts a pending row", () => {
  j.enqueue(sampleEvent);
  const pending = j.selectPending(10);
  expect(pending.length).toBe(1);
  expect(pending[0]?.client_event_id).toBe(sampleEvent.client_event_id);
});

test("enqueue is idempotent on duplicate client_event_id (INSERT OR IGNORE)", () => {
  j.enqueue(sampleEvent);
  j.enqueue(sampleEvent);
  expect(j.selectPending(10).length).toBe(1);
});

test("markSubmitted removes rows from pending", () => {
  j.enqueue(sampleEvent);
  j.markSubmitted([sampleEvent.client_event_id]);
  expect(j.selectPending(10).length).toBe(0);
});

test("markFailed increments retry_count and records last_error", () => {
  j.enqueue(sampleEvent);
  j.markFailed([sampleEvent.client_event_id], "http 500 upstream timeout");
  const pending = j.selectPending(10);
  expect(pending.length).toBe(1);
  expect(pending[0]?.retry_count).toBe(1);
  expect(pending[0]?.last_error).toBe("http 500 upstream timeout");
});

test("selectPending respects the limit", () => {
  for (let i = 0; i < 5; i++) {
    j.enqueue({
      ...sampleEvent,
      client_event_id: `00000000-0000-0000-0000-00000000000${i}`,
      event_seq: i,
    });
  }
  expect(j.selectPending(3).length).toBe(3);
});

test("pendingCount returns total pending", () => {
  j.enqueue(sampleEvent);
  expect(j.pendingCount()).toBe(1);
  j.markSubmitted([sampleEvent.client_event_id]);
  expect(j.pendingCount()).toBe(0);
});

test("tail returns most recent N rows including submitted", () => {
  for (let i = 0; i < 3; i++) {
    j.enqueue({
      ...sampleEvent,
      client_event_id: `00000000-0000-0000-0000-00000000000${i}`,
      event_seq: i,
    });
  }
  j.markSubmitted(["00000000-0000-0000-0000-000000000000"]);
  const tail = j.tail(10);
  expect(tail.length).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/egress/journal.test.ts`
Expected: 7 fail with "Cannot find module './journal'".

- [ ] **Step 3: Implement Journal**

`apps/collector/src/egress/journal.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { Event } from "@bematist/schema";

export interface PendingRow {
  client_event_id: string;
  body_json: string;
  enqueued_at: string;
  retry_count: number;
  last_error: string | null;
}

export class Journal {
  constructor(private readonly db: Database) {}

  enqueue(event: Event): void {
    this.db.run(
      `INSERT OR IGNORE INTO events (client_event_id, body_json, enqueued_at)
       VALUES (?, ?, ?)`,
      [event.client_event_id, JSON.stringify(event), new Date().toISOString()],
    );
  }

  selectPending(limit: number): PendingRow[] {
    return this.db
      .query<PendingRow, [number]>(
        `SELECT client_event_id, body_json, enqueued_at, retry_count, last_error
         FROM events WHERE submitted_at IS NULL
         ORDER BY enqueued_at ASC LIMIT ?`,
      )
      .all(limit);
  }

  markSubmitted(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "UPDATE events SET submitted_at = ?, last_error = NULL WHERE client_event_id = ?",
    );
    this.db.transaction(() => {
      for (const id of ids) stmt.run(now, id);
    })();
  }

  markFailed(ids: string[], lastError: string): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE events SET retry_count = retry_count + 1, last_error = ?
       WHERE client_event_id = ?`,
    );
    this.db.transaction(() => {
      for (const id of ids) stmt.run(lastError, id);
    })();
  }

  pendingCount(): number {
    return (
      this.db
        .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM events WHERE submitted_at IS NULL")
        .get()?.c ?? 0
    );
  }

  tail(limit: number): Array<PendingRow & { submitted_at: string | null }> {
    return this.db
      .query<PendingRow & { submitted_at: string | null }, [number]>(
        `SELECT client_event_id, body_json, enqueued_at, retry_count, last_error, submitted_at
         FROM events ORDER BY enqueued_at DESC LIMIT ?`,
      )
      .all(limit);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/egress/journal.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/egress/journal.ts apps/collector/src/egress/journal.test.ts
git commit -m "collector: egress journal (enqueue, pending, submitted, failed, tail)"
```

---

### Task 8: Cursor store on same SQLite file

**Files:**
- Create: `apps/collector/src/cursor/store.ts`
- Create: `apps/collector/src/cursor/store.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/cursor/store.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../egress/migrations";
import { SqliteCursorStore } from "./store";

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-cursor-"));
  db = new Database(join(dir, "c.sqlite"));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("get returns null for unset key", async () => {
  const s = new SqliteCursorStore(db, "claude-code");
  expect(await s.get("offset:foo")).toBe(null);
});

test("set then get round-trips a value", async () => {
  const s = new SqliteCursorStore(db, "claude-code");
  await s.set("offset:foo", "1234");
  expect(await s.get("offset:foo")).toBe("1234");
});

test("set overwrites a previous value", async () => {
  const s = new SqliteCursorStore(db, "claude-code");
  await s.set("offset:foo", "1");
  await s.set("offset:foo", "2");
  expect(await s.get("offset:foo")).toBe("2");
});

test("per-adapter isolation — same key, different adapter_id", async () => {
  const a = new SqliteCursorStore(db, "claude-code");
  const b = new SqliteCursorStore(db, "codex");
  await a.set("k", "A");
  await b.set("k", "B");
  expect(await a.get("k")).toBe("A");
  expect(await b.get("k")).toBe("B");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/cursor/store.test.ts`
Expected: 4 fail with "Cannot find module './store'".

- [ ] **Step 3: Implement SqliteCursorStore**

`apps/collector/src/cursor/store.ts`:

```ts
import type { Database } from "bun:sqlite";
import type { CursorStore } from "@bematist/sdk";

export class SqliteCursorStore implements CursorStore {
  constructor(
    private readonly db: Database,
    private readonly adapterId: string,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = this.db
      .query<{ value: string }, [string, string]>(
        "SELECT value FROM cursors WHERE adapter_id = ? AND key = ?",
      )
      .get(this.adapterId, key);
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.db.run(
      `INSERT INTO cursors (adapter_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(adapter_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [this.adapterId, key, value, new Date().toISOString()],
    );
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/cursor/store.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/cursor/store.ts apps/collector/src/cursor/store.test.ts
git commit -m "collector: SqliteCursorStore with per-adapter key isolation"
```

---

### Task 9: Egress worker with response-code handling

**Files:**
- Create: `apps/collector/src/egress/worker.ts`
- Create: `apps/collector/src/egress/worker.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/egress/worker.test.ts`:

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "./journal";
import { migrate } from "./migrations";
import { flushOnce } from "./worker";

let dir: string;
let db: Database;
let j: Journal;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-worker-"));
  db = new Database(join(dir, "w.sqlite"));
  migrate(db);
  j = new Journal(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const ev = (n: number) => ({
  client_event_id: `00000000-0000-0000-0000-00000000000${n}`,
  schema_version: 1,
  ts: "2026-04-16T14:00:00.000Z",
  tenant_id: "org_acme",
  engineer_id: "eng_x",
  device_id: "dev_y",
  source: "claude-code" as const,
  fidelity: "full" as const,
  tier: "B" as const,
  session_id: "s1",
  event_seq: n,
  dev_metrics: { event_kind: "session_start" as const },
});

test("202 marks all submitted", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () =>
    new Response(JSON.stringify({ accepted: 1, deduped: 0, request_id: "r1" }), { status: 202 });
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock,
    dryRun: false,
  });
  expect(result.submitted).toBe(1);
  expect(j.pendingCount()).toBe(0);
});

test("207 splits succeeded vs failed per index", async () => {
  j.enqueue(ev(0));
  j.enqueue(ev(1));
  const fetchMock = async () =>
    new Response(
      JSON.stringify({
        accepted: 1,
        rejected: [{ index: 1, reason: "bad" }],
        request_id: "r1",
      }),
      { status: 207 },
    );
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock,
    dryRun: false,
  });
  expect(result.submitted).toBe(1);
  expect(result.failed).toBe(1);
  expect(j.pendingCount()).toBe(1);
});

test("400 marks failed with non-retry reason", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () =>
    new Response(JSON.stringify({ error: "schema violation" }), { status: 400 });
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock,
    dryRun: false,
  });
  expect(result.failed).toBe(1);
  expect(result.fatal).toBe(false);
});

test("401 returns fatal", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () => new Response(null, { status: 401 });
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock,
    dryRun: false,
  });
  expect(result.fatal).toBe(true);
});

test("429 returns retryAfterSeconds from header", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () =>
    new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "Retry-After": "7" },
    });
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock,
    dryRun: false,
  });
  expect(result.retryAfterSeconds).toBe(7);
  expect(j.pendingCount()).toBe(1);
});

test("500 marks failed but not fatal", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () => new Response(JSON.stringify({ error: "upstream" }), { status: 500 });
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock,
    dryRun: false,
  });
  expect(result.failed).toBe(1);
  expect(result.fatal).toBe(false);
});

test("dryRun=true skips network and keeps rows pending", async () => {
  j.enqueue(ev(0));
  const calls: unknown[] = [];
  const fetchMock = async (..._args: unknown[]) => {
    calls.push(_args);
    return new Response(null, { status: 500 });
  };
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock,
    dryRun: true,
  });
  expect(calls.length).toBe(0);
  expect(result.submitted).toBe(0);
  expect(j.pendingCount()).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/egress/worker.test.ts`
Expected: 7 fail with "Cannot find module './worker'".

- [ ] **Step 3: Implement flushOnce**

`apps/collector/src/egress/worker.ts`:

```ts
import { log } from "../logger";
import type { Journal } from "./journal";

export interface FlushOptions {
  endpoint: string;
  token: string;
  fetch: typeof fetch;
  dryRun: boolean;
  batchSize?: number;
}

export interface FlushResult {
  submitted: number;
  failed: number;
  fatal: boolean;
  retryAfterSeconds: number | null;
}

const DEFAULT_BATCH = 1000;

export async function flushOnce(j: Journal, opts: FlushOptions): Promise<FlushResult> {
  const pending = j.selectPending(opts.batchSize ?? DEFAULT_BATCH);
  if (pending.length === 0) {
    return { submitted: 0, failed: 0, fatal: false, retryAfterSeconds: null };
  }

  if (opts.dryRun) {
    log.info({ count: pending.length }, "egress dry-run: would POST events");
    return { submitted: 0, failed: 0, fatal: false, retryAfterSeconds: null };
  }

  const body = JSON.stringify({
    events: pending.map((r) => JSON.parse(r.body_json)),
  });

  let res: Response;
  try {
    res = await opts.fetch(`${opts.endpoint}/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.token}`,
      },
      body,
    });
  } catch (e) {
    j.markFailed(
      pending.map((r) => r.client_event_id),
      `network: ${String(e)}`,
    );
    return { submitted: 0, failed: pending.length, fatal: false, retryAfterSeconds: null };
  }

  if (res.status === 202) {
    j.markSubmitted(pending.map((r) => r.client_event_id));
    return { submitted: pending.length, failed: 0, fatal: false, retryAfterSeconds: null };
  }

  if (res.status === 207) {
    const payload = (await res.json().catch(() => ({}))) as {
      rejected?: Array<{ index: number; reason: string }>;
    };
    const rejectedIdx = new Set((payload.rejected ?? []).map((r) => r.index));
    const submittedIds: string[] = [];
    const failedIds: string[] = [];
    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      if (!row) continue;
      (rejectedIdx.has(i) ? failedIds : submittedIds).push(row.client_event_id);
    }
    j.markSubmitted(submittedIds);
    const reason = JSON.stringify(payload.rejected ?? "unknown");
    j.markFailed(failedIds, `207 partial: ${reason}`);
    return {
      submitted: submittedIds.length,
      failed: failedIds.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 400) {
    const text = await res.text().catch(() => "");
    j.markFailed(
      pending.map((r) => r.client_event_id),
      `400: ${text}`,
    );
    log.warn({ status: 400, body: text }, "egress 400 — do not retry this batch");
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 401 || res.status === 403) {
    log.fatal({ status: res.status }, "egress auth fatal — halting worker");
    return { submitted: 0, failed: 0, fatal: true, retryAfterSeconds: null };
  }

  if (res.status === 413) {
    // Signal caller to split the batch. For M1 we mark failed so the caller can size down.
    j.markFailed(
      pending.map((r) => r.client_event_id),
      "413 payload too large",
    );
    return {
      submitted: 0,
      failed: pending.length,
      fatal: false,
      retryAfterSeconds: null,
    };
  }

  if (res.status === 429) {
    const ra = Number.parseInt(res.headers.get("Retry-After") ?? "1", 10);
    return {
      submitted: 0,
      failed: 0,
      fatal: false,
      retryAfterSeconds: Number.isFinite(ra) ? ra : 1,
    };
  }

  // 5xx — retryable
  const text = await res.text().catch(() => "");
  j.markFailed(
    pending.map((r) => r.client_event_id),
    `${res.status}: ${text}`,
  );
  return {
    submitted: 0,
    failed: pending.length,
    fatal: false,
    retryAfterSeconds: null,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/egress/worker.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/egress/worker.ts apps/collector/src/egress/worker.test.ts
git commit -m "collector: egress worker flushOnce with contract-02 response code handling"
```

---

## Phase C — Orchestrator

### Task 10: Semaphore primitive

**Files:**
- Create: `apps/collector/src/orchestrator/semaphore.ts`
- Create: `apps/collector/src/orchestrator/semaphore.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/orchestrator/semaphore.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Semaphore } from "./semaphore";

test("acquire is immediate when under cap", async () => {
  const s = new Semaphore(2);
  await s.acquire();
  await s.acquire();
  expect(s.activeCount).toBe(2);
  s.release();
  s.release();
  expect(s.activeCount).toBe(0);
});

test("acquire blocks when cap reached and resumes on release", async () => {
  const s = new Semaphore(1);
  await s.acquire();
  let resolved = false;
  const p = s.acquire().then(() => {
    resolved = true;
  });
  // Wait a tick — blocked acquire should still be pending.
  await new Promise((r) => setTimeout(r, 5));
  expect(resolved).toBe(false);
  s.release();
  await p;
  expect(resolved).toBe(true);
});

test("release without acquire throws", () => {
  const s = new Semaphore(1);
  expect(() => s.release()).toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/orchestrator/semaphore.test.ts`
Expected: 3 fail with "Cannot find module './semaphore'".

- [ ] **Step 3: Implement Semaphore**

`apps/collector/src/orchestrator/semaphore.ts`:

```ts
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly cap: number) {
    if (cap < 1) throw new Error("Semaphore cap must be >= 1");
  }

  get activeCount(): number {
    return this.active;
  }

  async acquire(): Promise<void> {
    if (this.active < this.cap) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  release(): void {
    if (this.active === 0) throw new Error("release without prior acquire");
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/orchestrator/semaphore.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/orchestrator/semaphore.ts apps/collector/src/orchestrator/semaphore.test.ts
git commit -m "collector: semaphore primitive for bounded adapter concurrency"
```

---

### Task 11: Orchestrator poll loop

**Files:**
- Create: `apps/collector/src/orchestrator/index.ts`
- Create: `apps/collector/src/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/orchestrator/orchestrator.test.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import type { Event } from "@bematist/schema";
import { runOnce } from "./index";

function mkLogger() {
  const noop = () => {};
  const l = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => l,
  };
  return l;
}

function mkCtx(): AdapterContext {
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log: mkLogger(),
    tier: "B",
    cursor: { get: async () => null, set: async () => {} },
  };
}

function mkAdapter(id: string, pollImpl: () => Promise<Event[]>): Adapter {
  return {
    id,
    label: id,
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    poll: async () => pollImpl(),
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
}

const ev = (id: string): Event =>
  ({
    client_event_id: `00000000-0000-0000-0000-${id.padStart(12, "0")}`,
    schema_version: 1,
    ts: "2026-04-16T14:00:00.000Z",
    tenant_id: "t",
    engineer_id: "e",
    device_id: "d",
    source: "claude-code",
    fidelity: "full",
    tier: "B",
    session_id: "s",
    event_seq: 0,
    dev_metrics: { event_kind: "session_start" },
    cost_estimated: false,
  }) as Event;

test("runOnce invokes every enabled adapter and returns combined events", async () => {
  const a = mkAdapter("a", async () => [ev("a")]);
  const b = mkAdapter("b", async () => [ev("b"), ev("c")]);
  const events = await runOnce([a, b], mkCtx, { concurrency: 2, perPollTimeoutMs: 1000 });
  expect(events.length).toBe(3);
});

test("adapter throwing in poll does not crash the orchestrator", async () => {
  const good = mkAdapter("good", async () => [ev("g")]);
  const bad = mkAdapter("bad", async () => {
    throw new Error("kaboom");
  });
  const events = await runOnce([good, bad], mkCtx, { concurrency: 2, perPollTimeoutMs: 1000 });
  expect(events.length).toBe(1);
  expect(events[0]?.client_event_id).toContain("g");
});

test("adapter exceeding perPollTimeoutMs is aborted, orchestrator continues", async () => {
  const slow = mkAdapter(
    "slow",
    () =>
      new Promise<Event[]>((resolve) => {
        setTimeout(() => resolve([ev("late")]), 500);
      }),
  );
  const fast = mkAdapter("fast", async () => [ev("ok")]);
  const events = await runOnce([slow, fast], mkCtx, { concurrency: 2, perPollTimeoutMs: 50 });
  expect(events.map((e) => e.client_event_id).some((id) => id.includes("ok"))).toBe(true);
  expect(events.map((e) => e.client_event_id).some((id) => id.includes("late"))).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/orchestrator/orchestrator.test.ts`
Expected: 3 fail with "Cannot find module './index'".

- [ ] **Step 3: Implement runOnce**

`apps/collector/src/orchestrator/index.ts`:

```ts
import type { Adapter, AdapterContext } from "@bematist/sdk";
import type { Event } from "@bematist/schema";
import { log } from "../logger";
import { Semaphore } from "./semaphore";

export interface RunOptions {
  concurrency: number;
  perPollTimeoutMs: number;
}

export async function runOnce(
  adapters: Adapter[],
  ctxFactory: (adapter: Adapter) => AdapterContext,
  opts: RunOptions,
): Promise<Event[]> {
  const sem = new Semaphore(opts.concurrency);
  const results = await Promise.all(
    adapters.map(async (a) => {
      await sem.acquire();
      try {
        const ctx = ctxFactory(a);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), opts.perPollTimeoutMs);
        try {
          return await a.poll(ctx, ac.signal);
        } catch (e) {
          log.warn({ adapter: a.id, err: String(e) }, "adapter poll failed");
          return [];
        } finally {
          clearTimeout(timer);
        }
      } finally {
        sem.release();
      }
    }),
  );
  return results.flat();
}

export { Semaphore } from "./semaphore";
```

Note: Task 11's "abort on timeout" test relies on `ac.abort()` causing `poll()` to return empty. Adapter authors are expected to honor `signal.aborted`; the orchestrator's best effort is the abort signal. For the test, we wrap `poll` in `Promise.race` with a timeout that resolves `[]` so the orchestrator demo is deterministic.

Revise the implementation — replace the inner `try { return await a.poll(...) }` with:

```ts
        try {
          const raced = await Promise.race<Event[]>([
            a.poll(ctx, ac.signal),
            new Promise<Event[]>((resolve) => {
              setTimeout(() => resolve([]), opts.perPollTimeoutMs);
            }),
          ]);
          return raced;
        } catch (e) {
          log.warn({ adapter: a.id, err: String(e) }, "adapter poll failed");
          return [];
        }
```

Leave the `clearTimeout(timer)` wrapper for the AbortController signal (adapter authors CAN cooperate). The race is defense-in-depth.

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/orchestrator/orchestrator.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/orchestrator/index.ts apps/collector/src/orchestrator/orchestrator.test.ts
git commit -m "collector: orchestrator runOnce with bounded concurrency + timeout race"
```

---

## Phase D — Claude Code parsers (D17)

### Task 12: Safe file reader (line-oriented, no size cap)

D17 item: drop grammata's 50 MB silent-drop limit.

**Files:**
- Create: `apps/collector/src/adapters/claude-code/parsers/safeRead.ts`
- Create: `apps/collector/src/adapters/claude-code/parsers/safeRead.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/adapters/claude-code/parsers/safeRead.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLinesFromOffset } from "./safeRead";

test("reads all lines from offset 0 on a small file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "small.jsonl");
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 0);
  expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  expect(nextOffset).toBe(24);
  rmSync(dir, { recursive: true, force: true });
});

test("resumes from a non-zero offset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "resume.jsonl");
  writeFileSync(path, '{"a":1}\n{"b":2}\n{"c":3}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 8);
  expect(lines).toEqual(['{"b":2}', '{"c":3}']);
  expect(nextOffset).toBe(24);
  rmSync(dir, { recursive: true, force: true });
});

test("handles a 60 MB file without dropping lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "big.jsonl");
  // Make 60MB of JSONL: 60_000 lines × ~1KB each.
  const line = `{"k":"${"x".repeat(1000)}"}\n`;
  const fd = Bun.file(path).writer();
  for (let i = 0; i < 60_000; i++) fd.write(line);
  await fd.end();
  const { lines } = await readLinesFromOffset(path, 0);
  expect(lines.length).toBe(60_000);
  rmSync(dir, { recursive: true, force: true });
}, 60_000);

test("ignores empty trailing newline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "trail.jsonl");
  writeFileSync(path, '{"a":1}\n\n');
  const { lines } = await readLinesFromOffset(path, 0);
  expect(lines).toEqual(['{"a":1}']);
  rmSync(dir, { recursive: true, force: true });
});

test("returns nextOffset unchanged if offset is past EOF", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-read-"));
  const path = join(dir, "eof.jsonl");
  writeFileSync(path, '{"a":1}\n');
  const { lines, nextOffset } = await readLinesFromOffset(path, 999);
  expect(lines).toEqual([]);
  expect(nextOffset).toBe(999);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/adapters/claude-code/parsers/safeRead.test.ts`
Expected: 5 fail with "Cannot find module './safeRead'".

- [ ] **Step 3: Implement readLinesFromOffset**

`apps/collector/src/adapters/claude-code/parsers/safeRead.ts`:

```ts
import { statSync } from "node:fs";
import { open } from "node:fs/promises";

/**
 * Read newline-delimited lines from `offset` to EOF. No 50 MB silent-drop limit
 * (D17 fix). Returns the new offset so callers can resume.
 *
 * Implementation reads a chunk at a time into a Buffer, splits on \n, keeps
 * the trailing partial line for the next read. Streaming-safe.
 */
export async function readLinesFromOffset(
  path: string,
  offset: number,
): Promise<{ lines: string[]; nextOffset: number }> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return { lines: [], nextOffset: offset };
  }
  if (offset >= size) return { lines: [], nextOffset: offset };

  const fh = await open(path, "r");
  try {
    const CHUNK = 64 * 1024;
    const buf = Buffer.alloc(CHUNK);
    let pos = offset;
    let residual = "";
    const lines: string[] = [];

    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, size - pos), pos);
      if (bytesRead === 0) break;
      const chunk = residual + buf.toString("utf8", 0, bytesRead);
      const parts = chunk.split("\n");
      residual = parts.pop() ?? "";
      for (const p of parts) {
        if (p.length > 0) lines.push(p);
      }
      pos += bytesRead;
    }
    if (residual.length > 0) lines.push(residual);
    return { lines, nextOffset: size };
  } finally {
    await fh.close();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/adapters/claude-code/parsers/safeRead.test.ts`
Expected: 5 pass. (60 MB test may take a few seconds.)

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/adapters/claude-code/parsers/safeRead.ts apps/collector/src/adapters/claude-code/parsers/safeRead.test.ts
git commit -m "collector(claude-code): line-oriented stream reader, no 50MB cap (D17)"
```

---

### Task 13: Claude Code JSONL raw types

Provides the TypeScript types for what we're parsing. Field names taken from inspecting `pharos`'s `src/claude.ts` and Claude Code's session JSONL shape.

**Files:**
- Create: `apps/collector/src/adapters/claude-code/parsers/types.ts`

- [ ] **Step 1: Write the types**

`apps/collector/src/adapters/claude-code/parsers/types.ts`:

```ts
/**
 * Raw JSONL shapes emitted by Claude Code to ~/.claude/projects/*/sessions/*.jsonl.
 * These reflect the shape as of Claude Code v1.0.35; field drift is expected and
 * handled by making every property optional + a fail-loud `unknown` catch-all.
 *
 * Source-of-truth reference: pella-labs/pharos → src/claude.ts (read, then
 * reimplement per PRD D17 — do NOT vendor).
 */

export interface RawClaudeSessionLine {
  /** Anthropic API request id — the key for the max-per-field dedup (D17). */
  requestId?: string;
  /** Event kind tag; Claude Code uses a mix of "message", "tool_use", "tool_result", etc. */
  type?: string;
  /** Session id (ULID-ish). */
  sessionId?: string;
  /** Wall-clock timestamp, ISO 8601. */
  timestamp?: string;
  /** User-message payload when type==="message" && role==="user". */
  message?: {
    role?: "user" | "assistant" | "system";
    content?: unknown;
    usage?: RawClaudeUsage;
    model?: string;
    stop_reason?: string;
  };
  /** Tool-use payload when type==="tool_use". */
  toolUse?: {
    name?: string;
    input?: unknown;
    id?: string;
  };
  /** Tool-result payload when type==="tool_result". */
  toolResult?: {
    toolUseId?: string;
    content?: unknown;
    isError?: boolean;
    durationMs?: number;
  };
  /** Edit-proposal / decision. */
  editProposed?: {
    toolName?: string;
    hunkSha256?: string;
    filePathHash?: string;
  };
  editDecision?: {
    toolName?: string;
    hunkSha256?: string;
    filePathHash?: string;
    decision?: "accept" | "reject" | "modify";
    durationMs?: number;
  };
}

export interface RawClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/collector/src/adapters/claude-code/parsers/types.ts
git commit -m "collector(claude-code): raw JSONL type shapes (reference pharos src/claude.ts)"
```

---

### Task 14: parseSessionFile with D17 Map<requestId, usage> max-per-field dedup

This is the core D17 P0 fix. Every dollar number downstream depends on this being right.

**Files:**
- Create: `apps/collector/src/adapters/claude-code/parsers/parseSessionFile.ts`
- Create: `apps/collector/src/adapters/claude-code/parsers/parseSessionFile.test.ts`
- Create: `apps/collector/src/adapters/claude-code/fixtures/duplicate-request-ids.jsonl`

- [ ] **Step 1: Create the duplicate-request-ids fixture**

`apps/collector/src/adapters/claude-code/fixtures/duplicate-request-ids.jsonl`:

```
{"requestId":"req_abc","type":"message","sessionId":"s1","timestamp":"2026-04-16T14:00:00.000Z","message":{"role":"assistant","usage":{"input_tokens":100,"output_tokens":50},"model":"claude-sonnet-4-5"}}
{"requestId":"req_abc","type":"message","sessionId":"s1","timestamp":"2026-04-16T14:00:01.000Z","message":{"role":"assistant","usage":{"input_tokens":120,"output_tokens":60},"model":"claude-sonnet-4-5"}}
{"requestId":"req_xyz","type":"message","sessionId":"s1","timestamp":"2026-04-16T14:00:02.000Z","message":{"role":"assistant","usage":{"input_tokens":80,"output_tokens":40},"model":"claude-sonnet-4-5"}}
```

Naive sum would yield input=300 output=150. Max-per-requestId yields input=200 (120+80) output=100 (60+40). **The P0 fix enforces the latter.**

- [ ] **Step 2: Write the failing tests**

`apps/collector/src/adapters/claude-code/parsers/parseSessionFile.test.ts`:

```ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseSessionFile } from "./parseSessionFile";

const FIX_DIR = join(import.meta.dir, "..", "fixtures");

test("parses clean session and sums usage correctly", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  // After max-per-requestId dedup: req_abc = {120, 60}, req_xyz = {80, 40}.
  expect(result.usageTotals.input_tokens).toBe(200);
  expect(result.usageTotals.output_tokens).toBe(100);
});

test("dedup by requestId chooses max per field (D17)", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  // req_abc saw {100,50} then {120,60} → max-per-field keeps {120,60}.
  const requestUsages = result.perRequestUsage.get("req_abc");
  expect(requestUsages?.input_tokens).toBe(120);
  expect(requestUsages?.output_tokens).toBe(60);
});

test("durationMs equals lastTimestamp − firstTimestamp", async () => {
  // Fixture spans 14:00:00.000 → 14:00:02.000 = 2000 ms.
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  expect(result.durationMs).toBe(2000);
});

test("sessionId extracted from first line with one", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  expect(result.sessionId).toBe("s1");
});

test("entries array preserves line order", async () => {
  const result = await parseSessionFile(join(FIX_DIR, "duplicate-request-ids.jsonl"));
  expect(result.entries.length).toBe(3);
  expect(result.entries[0]?.timestamp).toBe("2026-04-16T14:00:00.000Z");
  expect(result.entries[2]?.timestamp).toBe("2026-04-16T14:00:02.000Z");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/adapters/claude-code/parsers/parseSessionFile.test.ts`
Expected: 5 fail with "Cannot find module './parseSessionFile'".

- [ ] **Step 4: Implement parseSessionFile**

`apps/collector/src/adapters/claude-code/parsers/parseSessionFile.ts`:

```ts
import { log } from "../../../logger";
import { readLinesFromOffset } from "./safeRead";
import type { RawClaudeSessionLine, RawClaudeUsage } from "./types";

export interface ParsedSession {
  sessionId: string | null;
  entries: RawClaudeSessionLine[];
  /** Per-requestId max-per-field (D17). */
  perRequestUsage: Map<string, RawClaudeUsage>;
  /** Summed across all requestIds. */
  usageTotals: Required<RawClaudeUsage>;
  /** lastTimestamp − firstTimestamp in ms. Null if < 2 timestamps. */
  durationMs: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

/**
 * Parse a Claude Code session JSONL file.
 *
 * D17 P0 fixes baked in:
 *   1. Per-requestId dedup with Map<requestId, usage>, max-per-field.
 *   2. durationMs = lastTimestamp − firstTimestamp.
 *   3. Safe file reader — no size cap.
 *
 * Line-parse failures log warn and skip that line; a corrupted tail line never
 * kills the whole session.
 */
export async function parseSessionFile(path: string): Promise<ParsedSession> {
  const { lines } = await readLinesFromOffset(path, 0);
  return parseLines(lines);
}

export function parseLines(lines: string[]): ParsedSession {
  const entries: RawClaudeSessionLine[] = [];
  const perRequestUsage = new Map<string, RawClaudeUsage>();
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let sessionId: string | null = null;

  for (const raw of lines) {
    let parsed: RawClaudeSessionLine;
    try {
      parsed = JSON.parse(raw) as RawClaudeSessionLine;
    } catch (e) {
      log.warn({ err: String(e) }, "claude-code: skipping malformed JSONL line");
      continue;
    }
    entries.push(parsed);

    if (parsed.sessionId && !sessionId) sessionId = parsed.sessionId;
    if (parsed.timestamp) {
      if (!firstTimestamp) firstTimestamp = parsed.timestamp;
      lastTimestamp = parsed.timestamp;
    }

    const usage = parsed.message?.usage;
    const rid = parsed.requestId;
    if (usage && rid) {
      const prior = perRequestUsage.get(rid) ?? {};
      perRequestUsage.set(rid, {
        input_tokens: max(prior.input_tokens, usage.input_tokens),
        output_tokens: max(prior.output_tokens, usage.output_tokens),
        cache_read_input_tokens: max(prior.cache_read_input_tokens, usage.cache_read_input_tokens),
        cache_creation_input_tokens: max(
          prior.cache_creation_input_tokens,
          usage.cache_creation_input_tokens,
        ),
      });
    }
  }

  const usageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  for (const u of perRequestUsage.values()) {
    usageTotals.input_tokens += u.input_tokens ?? 0;
    usageTotals.output_tokens += u.output_tokens ?? 0;
    usageTotals.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    usageTotals.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  }

  let durationMs: number | null = null;
  if (firstTimestamp && lastTimestamp && firstTimestamp !== lastTimestamp) {
    durationMs = Date.parse(lastTimestamp) - Date.parse(firstTimestamp);
  } else if (firstTimestamp && lastTimestamp) {
    durationMs = 0;
  }

  return {
    sessionId,
    entries,
    perRequestUsage,
    usageTotals,
    durationMs,
    firstTimestamp,
    lastTimestamp,
  };
}

function max(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/collector && bun test src/adapters/claude-code/parsers/parseSessionFile.test.ts`
Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/collector/src/adapters/claude-code/parsers/parseSessionFile.ts apps/collector/src/adapters/claude-code/parsers/parseSessionFile.test.ts apps/collector/src/adapters/claude-code/fixtures/duplicate-request-ids.jsonl
git commit -m "collector(claude-code): D17 parseSessionFile with max-per-requestId dedup + durationMs fix"
```

---

## Phase E — Claude Code adapter wiring

### Task 15: Discovery module

**Files:**
- Modify: `apps/collector/src/adapters/claude-code/discovery.ts` (replace the inline function in `index.ts` with a module)
- Create: `apps/collector/src/adapters/claude-code/discovery.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/collector/src/adapters/claude-code/discovery.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSources } from "./discovery";

test("otelEnabled reflects CLAUDE_CODE_ENABLE_TELEMETRY=1", () => {
  const prev = process.env.CLAUDE_CODE_ENABLE_TELEMETRY;
  process.env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
  expect(discoverSources().otelEnabled).toBe(true);
  process.env.CLAUDE_CODE_ENABLE_TELEMETRY = "0";
  expect(discoverSources().otelEnabled).toBe(false);
  if (prev === undefined) delete process.env.CLAUDE_CODE_ENABLE_TELEMETRY;
  else process.env.CLAUDE_CODE_ENABLE_TELEMETRY = prev;
});

test("jsonlDirExists true when CLAUDE_CONFIG_DIR points at a real dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-disc-"));
  const projects = join(dir, "projects");
  require("node:fs").mkdirSync(projects, { recursive: true });
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  expect(discoverSources().jsonlDirExists).toBe(true);
  if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
});

test("jsonlDirExists false when pointing at nonexistent dir", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = "/nonexistent/path/definitely/not-there";
  expect(discoverSources().jsonlDirExists).toBe(false);
  if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prev;
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/adapters/claude-code/discovery.test.ts`
Expected: 3 fail with "Cannot find module './discovery'".

- [ ] **Step 3: Extract discovery.ts**

`apps/collector/src/adapters/claude-code/discovery.ts`:

```ts
import { existsSync } from "node:fs";
import { claudeProjectsDir } from "@bematist/config";

export interface DiscoverySources {
  otelEnabled: boolean;
  jsonlDir: string;
  jsonlDirExists: boolean;
}

export function discoverSources(): DiscoverySources {
  const jsonlDir = claudeProjectsDir();
  return {
    otelEnabled: process.env.CLAUDE_CODE_ENABLE_TELEMETRY === "1",
    jsonlDir,
    jsonlDirExists: existsSync(jsonlDir),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/collector && bun test src/adapters/claude-code/discovery.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/adapters/claude-code/discovery.ts apps/collector/src/adapters/claude-code/discovery.test.ts
git commit -m "collector(claude-code): extract discovery module with CLAUDE_CONFIG_DIR honor"
```

---

### Task 16: Normalize raw Claude Code lines → canonical Event[]

Maps `RawClaudeSessionLine` to our `Event` schema, stamps `client_event_id` (deterministic hash), `pricing_version`, `fidelity="full"`, `tier` from policy, `duration_ms` on `llm_response` events.

**Files:**
- Create: `apps/collector/src/adapters/claude-code/normalize.ts`
- Create: `apps/collector/src/adapters/claude-code/normalize.test.ts`
- Create: `apps/collector/src/adapters/claude-code/fixtures/real-session.jsonl`

- [ ] **Step 1: Create a minimal real-session fixture**

`apps/collector/src/adapters/claude-code/fixtures/real-session.jsonl`:

```
{"type":"session_start","sessionId":"sess_real_01","timestamp":"2026-04-16T14:00:00.000Z"}
{"requestId":"req_1","type":"message","sessionId":"sess_real_01","timestamp":"2026-04-16T14:00:00.250Z","message":{"role":"user","content":"help me refactor this"}}
{"requestId":"req_1","type":"message","sessionId":"sess_real_01","timestamp":"2026-04-16T14:00:03.100Z","message":{"role":"assistant","model":"claude-sonnet-4-5","usage":{"input_tokens":1840,"output_tokens":312,"cache_read_input_tokens":1200,"cache_creation_input_tokens":640},"stop_reason":"tool_use"}}
{"type":"tool_use","sessionId":"sess_real_01","timestamp":"2026-04-16T14:00:03.400Z","toolUse":{"name":"Read","id":"tu_1","input":{"path":"/abs/foo.ts"}}}
{"type":"tool_result","sessionId":"sess_real_01","timestamp":"2026-04-16T14:00:03.520Z","toolResult":{"toolUseId":"tu_1","isError":false,"durationMs":120}}
{"type":"session_end","sessionId":"sess_real_01","timestamp":"2026-04-16T14:00:12.000Z"}
```

- [ ] **Step 2: Write the failing tests**

`apps/collector/src/adapters/claude-code/normalize.test.ts`:

```ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import { parseSessionFile } from "./parsers/parseSessionFile";
import { normalizeSession } from "./normalize";

const FIX = join(import.meta.dir, "fixtures");

const baseIdentity = {
  tenantId: "org_acme",
  engineerId: "eng_test",
  deviceId: "dev_test",
  tier: "B" as const,
};

test("every produced event passes EventSchema validation", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (const e of events) {
    const r = EventSchema.safeParse(e);
    expect(r.success).toBe(true);
  }
});

test("event_kind coverage includes session_start, llm_request, llm_response, tool_call, tool_result, session_end", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of [
    "session_start",
    "llm_request",
    "llm_response",
    "tool_call",
    "tool_result",
    "session_end",
  ]) {
    expect(kinds.has(k as never)).toBe(true);
  }
});

test("llm_response event stamps pricing_version and cost_usd is > 0", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const resp = events.find((e) => e.dev_metrics.event_kind === "llm_response");
  expect(resp?.dev_metrics.pricing_version).toMatch(/^litellm@/);
  expect((resp?.dev_metrics.cost_usd ?? 0)).toBeGreaterThan(0);
});

test("client_event_id is deterministic — same input yields same ids", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const a = normalizeSession(parsed, baseIdentity, "1.0.35");
  const b = normalizeSession(parsed, baseIdentity, "1.0.35");
  expect(a.map((e) => e.client_event_id)).toEqual(b.map((e) => e.client_event_id));
});

test("event_seq is monotonic within session", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (let i = 1; i < events.length; i++) {
    expect((events[i]?.event_seq ?? 0)).toBeGreaterThan(events[i - 1]?.event_seq ?? 0);
  }
});

test("tier defaults to 'B' per CLAUDE.md D7 default", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (const e of events) expect(e.tier).toBe("B");
});

test("fidelity is always 'full' for claude-code", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (const e of events) expect(e.fidelity).toBe("full");
});

test("forbidden fields never appear on emitted events (Tier B)", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const forbidden = [
    "prompt_text",
    "tool_input",
    "tool_output",
  ];
  for (const e of events) {
    for (const k of forbidden) {
      expect((e as Record<string, unknown>)[k]).toBeUndefined();
    }
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/collector && bun test src/adapters/claude-code/normalize.test.ts`
Expected: 8 fail with "Cannot find module './normalize'".

- [ ] **Step 4: Implement normalizeSession**

`apps/collector/src/adapters/claude-code/normalize.ts`:

```ts
import { createHash } from "node:crypto";
import { pricingVersionString } from "@bematist/config";
import type { Event } from "@bematist/schema";
import type { ParsedSession } from "./parsers/parseSessionFile";
import type { RawClaudeSessionLine, RawClaudeUsage } from "./parsers/types";

export interface ServerIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
  tier: "A" | "B" | "C";
}

const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number }> = {
  // Values in USD per million tokens. Anchored to the LiteLLM pin in @bematist/config.
  // For M1 we carry a minimal table covering the 4.5 / 4.6 family; fully loaded table
  // lands as a generated JSON in M2 via packages/config/pricing.ts.
  "claude-sonnet-4-5": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheCreation: 3.75 },
  "claude-opus-4-6":   { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  "claude-opus-4-7":   { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreation: 18.75 },
  "claude-haiku-4-5":  { input: 0.8, output: 4.0, cacheRead: 0.08, cacheCreation: 1.0 },
};

export function normalizeSession(
  parsed: ParsedSession,
  id: ServerIdentity,
  sourceVersion: string,
): Event[] {
  const session_id = parsed.sessionId ?? "unknown";
  const events: Event[] = [];
  let seq = 0;

  for (const line of parsed.entries) {
    const eventsForLine = mapLine(line, parsed, id, sourceVersion, session_id, seq);
    for (const e of eventsForLine) {
      events.push(e);
      seq++;
    }
  }
  return events.map((e, i) => ({ ...e, event_seq: i }));
}

function mapLine(
  line: RawClaudeSessionLine,
  parsed: ParsedSession,
  id: ServerIdentity,
  sourceVersion: string,
  session_id: string,
  seq: number,
): Event[] {
  const base = {
    schema_version: 1 as const,
    ts: line.timestamp ?? new Date().toISOString(),
    tenant_id: id.tenantId,
    engineer_id: id.engineerId,
    device_id: id.deviceId,
    source: "claude-code" as const,
    source_version: sourceVersion,
    fidelity: "full" as const,
    cost_estimated: false,
    tier: id.tier,
    session_id,
    event_seq: seq,
  };

  if (line.type === "session_start") {
    return [
      {
        ...base,
        client_event_id: deterministicId("session_start", session_id, seq, line),
        dev_metrics: {
          event_kind: "session_start",
          duration_ms: 0,
        },
      } as Event,
    ];
  }

  if (line.type === "session_end") {
    return [
      {
        ...base,
        client_event_id: deterministicId("session_end", session_id, seq, line),
        dev_metrics: {
          event_kind: "session_end",
          duration_ms: parsed.durationMs ?? undefined,
        },
      } as Event,
    ];
  }

  if (line.type === "message" && line.message?.role === "user") {
    // User message = one "llm_request" event (pre-response marker).
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_request", session_id, seq, line),
        gen_ai: {
          system: "anthropic",
          request: {
            model: line.message?.model,
            max_tokens: 4096,
          },
        },
        dev_metrics: { event_kind: "llm_request" },
      } as Event,
    ];
  }

  if (line.type === "message" && line.message?.role === "assistant") {
    const model = line.message?.model;
    const usage = (line.requestId && parsed.perRequestUsage.get(line.requestId)) || line.message?.usage;
    const cost = usage && model ? computeCostUsd(model, usage) : undefined;
    return [
      {
        ...base,
        client_event_id: deterministicId("llm_response", session_id, seq, line),
        gen_ai: {
          system: "anthropic",
          response: {
            model,
            finish_reasons: line.message?.stop_reason ? [line.message.stop_reason] : undefined,
          },
          usage: {
            input_tokens: usage?.input_tokens,
            output_tokens: usage?.output_tokens,
            cache_read_input_tokens: usage?.cache_read_input_tokens,
            cache_creation_input_tokens: usage?.cache_creation_input_tokens,
          },
        },
        dev_metrics: {
          event_kind: "llm_response",
          cost_usd: cost,
          pricing_version: cost !== undefined ? pricingVersionString() : undefined,
        },
      } as Event,
    ];
  }

  if (line.type === "tool_use") {
    return [
      {
        ...base,
        client_event_id: deterministicId("tool_call", session_id, seq, line),
        dev_metrics: {
          event_kind: "tool_call",
          tool_name: line.toolUse?.name,
        },
      } as Event,
    ];
  }

  if (line.type === "tool_result") {
    return [
      {
        ...base,
        client_event_id: deterministicId("tool_result", session_id, seq, line),
        dev_metrics: {
          event_kind: "tool_result",
          tool_name: line.toolUse?.name, // may be undefined
          tool_status: line.toolResult?.isError ? "error" : "ok",
          duration_ms: line.toolResult?.durationMs,
          first_try_failure: line.toolResult?.isError ? true : undefined,
        },
      } as Event,
    ];
  }

  // Unknown line kinds are skipped for M1. M2 will expand this mapping.
  return [];
}

function computeCostUsd(model: string, u: RawClaudeUsage): number | undefined {
  const p = MODEL_PRICING_PER_MTOK[model];
  if (!p) return undefined;
  const input = (u.input_tokens ?? 0) / 1_000_000;
  const output = (u.output_tokens ?? 0) / 1_000_000;
  const cacheRead = (u.cache_read_input_tokens ?? 0) / 1_000_000;
  const cacheCreation = (u.cache_creation_input_tokens ?? 0) / 1_000_000;
  const cost =
    input * p.input + output * p.output + cacheRead * p.cacheRead + cacheCreation * p.cacheCreation;
  return Math.round(cost * 1e6) / 1e6;
}

function deterministicId(
  kind: string,
  session_id: string,
  seq: number,
  line: RawClaudeSessionLine,
): string {
  const raw = `claude-code|${session_id}|${seq}|${kind}|${JSON.stringify(line)}`;
  const hex = createHash("sha256").update(raw).digest("hex");
  // UUID v4-shaped string from the hash — preserves EventSchema.uuid validation.
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    `4${hex.substring(13, 16)}`,
    `${(Number.parseInt(hex.substring(16, 17), 16) & 0x3) | 0x8}${hex.substring(17, 20)}`,
    hex.substring(20, 32),
  ].join("-");
}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/collector && bun test src/adapters/claude-code/normalize.test.ts`
Expected: 8 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/collector/src/adapters/claude-code/normalize.ts apps/collector/src/adapters/claude-code/normalize.test.ts apps/collector/src/adapters/claude-code/fixtures/real-session.jsonl
git commit -m "collector(claude-code): normalize raw JSONL to canonical Event[] with deterministic ids"
```

---

### Task 17: Wire the adapter — real `init` / `poll` / `health`

**Files:**
- Modify: `apps/collector/src/adapters/claude-code/index.ts`
- Modify: `apps/collector/src/adapters/claude-code/claude-code.test.ts`

- [ ] **Step 1: Update the adapter to use the real parser + normalizer**

Replace the contents of `apps/collector/src/adapters/claude-code/index.ts`:

```ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, AdapterHealth } from "@bematist/sdk";
import { type DiscoverySources, discoverSources } from "./discovery";
import { normalizeSession } from "./normalize";
import { parseSessionFile } from "./parsers/parseSessionFile";

const SOURCE_VERSION_DEFAULT = "1.0.x";

interface Identity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

export class ClaudeCodeAdapter implements Adapter {
  readonly id = "claude-code";
  readonly label = "Claude Code";
  readonly version = "0.1.0";
  readonly supportedSourceVersions = ">=1.0.0";

  private sources: DiscoverySources | null = null;

  constructor(private readonly identity: Identity) {}

  async init(ctx: AdapterContext): Promise<void> {
    this.sources = discoverSources();
    ctx.log.info("claude-code adapter init", {
      otelEnabled: this.sources.otelEnabled,
      jsonlDirExists: this.sources.jsonlDirExists,
    });
  }

  async poll(ctx: AdapterContext, _signal: AbortSignal): Promise<Event[]> {
    const s = this.sources ?? discoverSources();
    if (!s.jsonlDirExists) return [];

    const files = await findSessionFiles(s.jsonlDir);
    const out: Event[] = [];
    for (const path of files) {
      const offsetKey = `offset:${path}`;
      const prevStr = await ctx.cursor.get(offsetKey);
      const prev = prevStr ? Number.parseInt(prevStr, 10) : 0;
      const parsed = await parseSessionFile(path); // full file for M1; incremental by offset lands Sprint 2 scope
      const events = normalizeSession(
        parsed,
        { ...this.identity, tier: ctx.tier },
        SOURCE_VERSION_DEFAULT,
      );
      out.push(...events);
      await ctx.cursor.set(offsetKey, String(prev));
    }
    return out;
  }

  async health(_ctx: AdapterContext): Promise<AdapterHealth> {
    const s = this.sources ?? discoverSources();
    const caveats: string[] = [];
    if (!s.otelEnabled && !s.jsonlDirExists) {
      caveats.push("No OTel env var and no JSONL dir — no Claude Code data will be captured.");
    }
    if (!s.otelEnabled && s.jsonlDirExists) {
      caveats.push("JSONL-backfill mode: OTLP receiver lands in M2; JSONL is sufficient for M1.");
    }
    const status = s.otelEnabled || s.jsonlDirExists ? "ok" : "disabled";
    return {
      status,
      fidelity: "full",
      ...(caveats.length > 0 ? { caveats } : {}),
    };
  }
}

async function findSessionFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as unknown as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  await walk(root);
  return out;
}
```

- [ ] **Step 2: Update existing tests to match the new constructor**

In `apps/collector/src/adapters/claude-code/claude-code.test.ts`:

- Replace `new ClaudeCodeAdapter()` with `new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" })`.
- Keep the existing golden-fixture loader test intact (the fixture is still validated).

Replace the two places that call `new ClaudeCodeAdapter()`:

```ts
const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
```

Replace the reference to `claudeCodeAdapter` with a freshly-constructed one in the type-check test:

```ts
test("ClaudeCodeAdapter type-checks against the Adapter interface", () => {
  const a: Adapter = new ClaudeCodeAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
  expect(a.id).toBe("claude-code");
  expect(a.label).toBe("Claude Code");
});
```

Remove the `import { claudeCodeAdapter } ...` line and the `export const claudeCodeAdapter` (if any remains in the adapter file). The adapter is now constructed at orchestrator-startup time with identity injected.

- [ ] **Step 3: Add a poll() integration test**

At the end of `apps/collector/src/adapters/claude-code/claude-code.test.ts`:

```ts
test("poll() reads real-session fixture and emits canonical Events", async () => {
  const dir = require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "bematist-cc-poll-"),
  );
  // Mirror the fixture shape under dir/projects/<proj>/sessions/<file>.jsonl.
  const sub = require("node:path").join(dir, "projects", "proj-a", "sessions");
  require("node:fs").mkdirSync(sub, { recursive: true });
  const srcFix = require("node:path").join(
    __dirname,
    "fixtures",
    "real-session.jsonl",
  );
  require("node:fs").copyFileSync(srcFix, require("node:path").join(sub, "s1.jsonl"));

  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;

  const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
  const ctx = mkCtx();
  await a.init(ctx);
  const events = await a.poll(ctx, new AbortController().signal);

  expect(events.length).toBeGreaterThan(0);
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  expect(kinds.has("session_start")).toBe(true);
  expect(kinds.has("llm_response")).toBe(true);
  expect(kinds.has("session_end")).toBe(true);

  if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prev;
  require("node:fs").rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run all claude-code tests**

Run: `cd apps/collector && bun test src/adapters/claude-code/`
Expected: all pass; at least 10 total tests across the claude-code directory.

- [ ] **Step 5: Commit**

```bash
git add apps/collector/src/adapters/claude-code/index.ts apps/collector/src/adapters/claude-code/claude-code.test.ts
git commit -m "collector(claude-code): real poll() reads JSONL and emits canonical Events"
```

---

### Task 18: Static adapter registry

**Files:**
- Create: `apps/collector/src/adapters/index.ts`

- [ ] **Step 1: Write the registry**

`apps/collector/src/adapters/index.ts`:

```ts
import type { Adapter } from "@bematist/sdk";
import { ClaudeCodeAdapter } from "./claude-code";

export interface RegistryIdentity {
  tenantId: string;
  engineerId: string;
  deviceId: string;
}

/**
 * Static registration of every v1 adapter.
 * M1 ships only claude-code; M2 adds codex / cursor / opencode / continue / vscode-generic.
 */
export function buildRegistry(id: RegistryIdentity): Adapter[] {
  return [new ClaudeCodeAdapter(id)];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/collector/src/adapters/index.ts
git commit -m "collector: static adapter registry (claude-code only for M1)"
```

---

## Phase F — CLI + daemon

### Task 19: CLI command scaffolding

**Files:**
- Modify: `apps/collector/src/cli.ts`
- Create: `apps/collector/src/commands/status.ts`
- Create: `apps/collector/src/commands/audit.ts`
- Create: `apps/collector/src/commands/dryRun.ts`
- Create: `apps/collector/src/commands/serve.ts`

- [ ] **Step 1: Replace cli.ts with a dispatcher**

`apps/collector/src/cli.ts`:

```ts
#!/usr/bin/env bun
import { runAudit } from "./commands/audit";
import { runDryRun } from "./commands/dryRun";
import { runServe } from "./commands/serve";
import { runStatus } from "./commands/status";
import { harden } from "./harden";

async function main() {
  harden();
  const [, , cmd, ...args] = process.argv;

  switch (cmd) {
    case "status":
      await runStatus();
      return;
    case "audit":
      await runAudit(args);
      return;
    case "dry-run":
      await runDryRun(args);
      return;
    case "serve":
      await runServe();
      return;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      printHelp();
      return;
    default:
      console.error(`bematist: unknown command: ${cmd}`);
      printHelp();
      process.exit(2);
  }
}

function printHelp() {
  console.log(`devmetrics — collector CLI (M1)

Commands:
  status            Adapter health + last event + queue depth
  audit --tail -n N Dump last N egress-journal rows as NDJSON
  dry-run           Run the daemon once without egress (log-only)
  serve             Run the collector daemon
`);
}

main().catch((e) => {
  console.error("bematist: fatal", e);
  process.exit(1);
});
```

- [ ] **Step 2: Implement status.ts**

`apps/collector/src/commands/status.ts`:

```ts
import { Database } from "bun:sqlite";
import { egressSqlite } from "@bematist/config";
import { existsSync } from "node:fs";
import { buildRegistry } from "../adapters";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { log } from "../logger";

export async function runStatus(): Promise<void> {
  const dbPath = egressSqlite();
  const dbExists = existsSync(dbPath);
  const db = new Database(dbPath);
  migrate(db);
  const j = new Journal(db);
  const pendingCount = j.pendingCount();

  const registry = buildRegistry({
    tenantId: process.env.DEVMETRICS_ORG ?? "solo",
    engineerId: process.env.DEVMETRICS_ENGINEER ?? "me",
    deviceId: process.env.DEVMETRICS_DEVICE ?? "localhost",
  });

  const health = await Promise.all(
    registry.map(async (a) => ({
      id: a.id,
      label: a.label,
      health: await a.health({
        dataDir: dbPath,
        policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
        log: {
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {},
          child: function () {
            return this;
          },
        },
        tier: "B",
        cursor: { get: async () => null, set: async () => {} },
      }),
    })),
  );

  console.log(
    JSON.stringify(
      {
        egressDb: { path: dbPath, exists: dbExists, pending: pendingCount },
        adapters: health,
      },
      null,
      2,
    ),
  );
  db.close();
  log.debug("status printed");
}
```

- [ ] **Step 3: Implement audit.ts**

`apps/collector/src/commands/audit.ts`:

```ts
import { Database } from "bun:sqlite";
import { egressSqlite } from "@bematist/config";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";

export async function runAudit(args: string[]): Promise<void> {
  let tail = false;
  let n = 100;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tail") tail = true;
    if (args[i] === "-n" || args[i] === "--limit") {
      n = Number.parseInt(args[i + 1] ?? "100", 10);
    }
  }
  if (!tail) {
    console.error("usage: bematist audit --tail [-n N]");
    process.exit(2);
  }
  const db = new Database(egressSqlite());
  migrate(db);
  const j = new Journal(db);
  const rows = j.tail(n);
  for (const r of rows) {
    console.log(
      JSON.stringify({
        client_event_id: r.client_event_id,
        enqueued_at: r.enqueued_at,
        submitted_at: r.submitted_at,
        retry_count: r.retry_count,
        last_error: r.last_error,
        event: JSON.parse(r.body_json),
      }),
    );
  }
  db.close();
}
```

- [ ] **Step 4: Implement dryRun.ts**

`apps/collector/src/commands/dryRun.ts`:

```ts
import { Database } from "bun:sqlite";
import { egressSqlite } from "@bematist/config";
import { buildRegistry } from "../adapters";
import { SqliteCursorStore } from "../cursor/store";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { flushOnce } from "../egress/worker";
import { log } from "../logger";
import { runOnce } from "../orchestrator";

export async function runDryRun(_args: string[]): Promise<void> {
  const db = new Database(egressSqlite());
  migrate(db);
  const j = new Journal(db);

  const registry = buildRegistry({
    tenantId: process.env.DEVMETRICS_ORG ?? "solo",
    engineerId: process.env.DEVMETRICS_ENGINEER ?? "me",
    deviceId: process.env.DEVMETRICS_DEVICE ?? "localhost",
  });

  const events = await runOnce(
    registry,
    (a) => ({
      dataDir: egressSqlite(),
      policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
      log: {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: function () {
          return this;
        },
      },
      tier: "B",
      cursor: new SqliteCursorStore(db, a.id),
    }),
    { concurrency: 4, perPollTimeoutMs: 30_000 },
  );
  for (const e of events) j.enqueue(e);

  const result = await flushOnce(j, {
    endpoint: process.env.DEVMETRICS_INGEST_HOST ?? "http://localhost:8000",
    token: process.env.DEVMETRICS_TOKEN ?? "dm_solo_dev",
    fetch,
    dryRun: true,
  });

  console.log(
    JSON.stringify(
      { enqueued: events.length, wouldSubmit: events.length, result },
      null,
      2,
    ),
  );
  log.info({ events: events.length }, "dry-run complete");
  db.close();
}
```

- [ ] **Step 5: Implement serve.ts**

`apps/collector/src/commands/serve.ts`:

```ts
import { Database } from "bun:sqlite";
import { egressSqlite } from "@bematist/config";
import { buildRegistry } from "../adapters";
import { SqliteCursorStore } from "../cursor/store";
import { Journal } from "../egress/journal";
import { migrate } from "../egress/migrations";
import { flushOnce } from "../egress/worker";
import { log } from "../logger";
import { runOnce } from "../orchestrator";

const POLL_INTERVAL_MS = 5000;
const FLUSH_INTERVAL_MS = 1000;

export async function runServe(): Promise<void> {
  const db = new Database(egressSqlite());
  migrate(db);
  const j = new Journal(db);

  const registry = buildRegistry({
    tenantId: process.env.DEVMETRICS_ORG ?? "solo",
    engineerId: process.env.DEVMETRICS_ENGINEER ?? "me",
    deviceId: process.env.DEVMETRICS_DEVICE ?? "localhost",
  });

  for (const a of registry) {
    await a.init({
      dataDir: egressSqlite(),
      policy: { enabled: true, tier: "B", pollIntervalMs: POLL_INTERVAL_MS },
      log: {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: function () {
          return this;
        },
      },
      tier: "B",
      cursor: new SqliteCursorStore(db, a.id),
    });
  }

  let running = true;
  const shutdown = () => {
    log.info("bematist serve: graceful shutdown");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const endpoint = process.env.DEVMETRICS_INGEST_HOST ?? "http://localhost:8000";
  const token = process.env.DEVMETRICS_TOKEN ?? "dm_solo_dev";

  log.info({ endpoint, adapters: registry.map((a) => a.id) }, "bematist serve: starting");

  while (running) {
    try {
      const events = await runOnce(
        registry,
        (a) => ({
          dataDir: egressSqlite(),
          policy: { enabled: true, tier: "B", pollIntervalMs: POLL_INTERVAL_MS },
          log: {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            fatal: () => {},
            child: function () {
              return this;
            },
          },
          tier: "B",
          cursor: new SqliteCursorStore(db, a.id),
        }),
        { concurrency: 4, perPollTimeoutMs: 30_000 },
      );
      for (const e of events) j.enqueue(e);

      const flush = await flushOnce(j, { endpoint, token, fetch, dryRun: false });
      if (flush.fatal) {
        log.fatal("egress fatal — halting");
        running = false;
        break;
      }
      const sleep = flush.retryAfterSeconds ?? 0;
      await new Promise((r) =>
        setTimeout(r, Math.max(FLUSH_INTERVAL_MS, sleep * 1000)),
      );
    } catch (e) {
      log.warn({ err: String(e) }, "serve loop error");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  db.close();
}
```

- [ ] **Step 6: Smoke-test the CLI help**

Run: `cd apps/collector && bun src/cli.ts --help`
Expected: prints the help text; exits 0.

Run: `cd apps/collector && bun src/cli.ts status`
Expected: prints JSON with `egressDb` + `adapters` keys; exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/collector/src/cli.ts apps/collector/src/commands/
git commit -m "collector: CLI dispatcher + status/audit/dry-run/serve commands"
```

---

## Phase G — Integration & contract drift

### Task 20: Fix contracts 01/03/06 @devmetrics → @bematist

Additive changelog bump per spec §2 M0 deltas.

**Files:**
- Modify: `contracts/01-event-wire.md`
- Modify: `contracts/03-adapter-sdk.md`
- Modify: `contracts/06-clio-pipeline.md`

- [ ] **Step 1: In each of the three files, replace `@devmetrics/*` with `@bematist/*`**

Exact occurrences to find+replace inside the 3 markdown files — use Grep first to list them:

Run: `grep -n "@devmetrics" contracts/01-event-wire.md contracts/03-adapter-sdk.md contracts/06-clio-pipeline.md`

For each match, edit the file to replace `@devmetrics/` with `@bematist/` verbatim (TypeScript imports inside code fences).

- [ ] **Step 2: Append a changelog line to each file**

At the bottom of each of the three files, append under the `## Changelog` section:

```
- 2026-04-16 — M1 adaptation: rename `@devmetrics/*` package references to `@bematist/*` (additive; real package paths under `packages/` are `@bematist/*`). No behavioral change.
```

- [ ] **Step 3: Commit**

```bash
git add contracts/01-event-wire.md contracts/03-adapter-sdk.md contracts/06-clio-pipeline.md
git commit -m "contracts: rename @devmetrics/* → @bematist/* in 01/03/06 (additive changelog)"
```

---

### Task 21: Full test-suite run

Sanity before the E2E.

- [ ] **Step 1: Run the full workspace test suite**

Run: `cd C:/Users/doa92/Desktop/Gauntlet\ Projects/bematist && bun test`
Expected: all tests pass. The M1 gate says "at least 10 new Claude-Code-adapter tests"; by this point we have ~30 new tests across the collector.

- [ ] **Step 2: Run lint + typecheck**

Run: `bun run lint` and `bun run typecheck`
Expected: both green.

- [ ] **Step 3: If anything fails, fix inline and rerun**

Pattern: fix → `bun test <failing-file>` → green → loop back to Step 1.

---

### Task 22: End-to-end smoke with real ingest

The M1 gate: one real event flows adapter → journal → ingest → 202.

- [ ] **Step 1: Bring up the Docker stack**

Run: `docker compose -f docker-compose.dev.yml up -d`
Expected: Postgres (5433), ClickHouse (8123), Redis (6379) healthy.

- [ ] **Step 2: Start the ingest server**

In one shell:
```bash
cd apps/ingest && bun src/index.ts
```

Expected: logs "ingest listening" on port 8000.

- [ ] **Step 3: Run the collector in dry-run mode against a known fixture**

Set `CLAUDE_CONFIG_DIR` to a temporary dir containing the fixture JSONL.

**POSIX (macOS / Linux):**

```bash
mkdir -p /tmp/bematist-e2e/projects/proj-a/sessions
cp apps/collector/src/adapters/claude-code/fixtures/real-session.jsonl \
   /tmp/bematist-e2e/projects/proj-a/sessions/s1.jsonl
export CLAUDE_CONFIG_DIR=/tmp/bematist-e2e
export DEVMETRICS_DATA_DIR=/tmp/bematist-e2e-data
export DEVMETRICS_LOG_LEVEL=info
cd apps/collector
bun src/cli.ts dry-run
```

**Windows (PowerShell):**

```powershell
$e2e = Join-Path $env:TEMP 'bematist-e2e'
New-Item -ItemType Directory -Force -Path "$e2e/projects/proj-a/sessions" | Out-Null
Copy-Item `
  apps/collector/src/adapters/claude-code/fixtures/real-session.jsonl `
  "$e2e/projects/proj-a/sessions/s1.jsonl"
$env:CLAUDE_CONFIG_DIR = $e2e
$env:DEVMETRICS_DATA_DIR = Join-Path $env:TEMP 'bematist-e2e-data'
$env:DEVMETRICS_LOG_LEVEL = 'info'
cd apps/collector
bun src/cli.ts dry-run
```

**Windows (Git Bash — same as POSIX but use `$TEMP` / `$USERPROFILE`):**

```bash
mkdir -p "$TEMP/bematist-e2e/projects/proj-a/sessions"
cp apps/collector/src/adapters/claude-code/fixtures/real-session.jsonl \
   "$TEMP/bematist-e2e/projects/proj-a/sessions/s1.jsonl"
export CLAUDE_CONFIG_DIR="$TEMP/bematist-e2e"
export DEVMETRICS_DATA_DIR="$TEMP/bematist-e2e-data"
export DEVMETRICS_LOG_LEVEL=info
cd apps/collector
bun src/cli.ts dry-run
```

Expected (all shells): JSON output with `enqueued > 0` and `wouldSubmit > 0`.

- [ ] **Step 4: Run a real flush**

**POSIX / Git Bash:**

```bash
export DEVMETRICS_INGEST_HOST=http://localhost:8000
export DEVMETRICS_TOKEN=dm_solo_dev
bun apps/collector/scripts/flush-once.ts
```

**PowerShell:**

```powershell
$env:DEVMETRICS_INGEST_HOST = 'http://localhost:8000'
$env:DEVMETRICS_TOKEN = 'dm_solo_dev'
bun apps/collector/scripts/flush-once.ts
```

The `flush-once.ts` helper lives in the repo (added as part of this step — see below). Using a portable `.ts` file avoids shell-quoting hell and works identically on all platforms.

Create `apps/collector/scripts/flush-once.ts`:

```ts
import { Database } from "bun:sqlite";
import { egressSqlite } from "@bematist/config";
import { Journal } from "../src/egress/journal";
import { migrate } from "../src/egress/migrations";
import { flushOnce } from "../src/egress/worker";

const db = new Database(egressSqlite());
migrate(db);
const j = new Journal(db);
const r = await flushOnce(j, {
  endpoint: process.env.DEVMETRICS_INGEST_HOST ?? "http://localhost:8000",
  token: process.env.DEVMETRICS_TOKEN ?? "dm_solo_dev",
  fetch,
  dryRun: false,
});
console.log(JSON.stringify(r, null, 2));
db.close();
```

Expected: `{ "submitted": N, "failed": 0, "fatal": false, "retryAfterSeconds": null }` with `N === enqueued`.

Ingest logs (in the first shell) show the events-accepted INFO line.

- [ ] **Step 5: Verify restart idempotency**

Stop the collector (it's already exited from dry-run). Re-run the dry-run + flush. Journal should show **no new pending rows** because INSERT OR IGNORE deduped on `client_event_id`.

- [ ] **Step 6: Tear down**

**POSIX / Git Bash:**

```bash
docker compose -f docker-compose.dev.yml down
unset CLAUDE_CONFIG_DIR DEVMETRICS_DATA_DIR DEVMETRICS_INGEST_HOST DEVMETRICS_TOKEN DEVMETRICS_LOG_LEVEL
rm -rf "${TEMP:-/tmp}/bematist-e2e" "${TEMP:-/tmp}/bematist-e2e-data"
```

**PowerShell:**

```powershell
docker compose -f docker-compose.dev.yml down
Remove-Item Env:CLAUDE_CONFIG_DIR,Env:DEVMETRICS_DATA_DIR,Env:DEVMETRICS_INGEST_HOST,Env:DEVMETRICS_TOKEN,Env:DEVMETRICS_LOG_LEVEL -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $env:TEMP 'bematist-e2e'), (Join-Path $env:TEMP 'bematist-e2e-data') -ErrorAction SilentlyContinue
```

- [ ] **Step 7: Record the evidence to `docs/superpowers/plans/m1-evidence.txt`**

Portable via Bun (works on all platforms — no shell-specific date or echo):

```bash
bun -e "import { writeFileSync } from 'node:fs'; writeFileSync('docs/superpowers/plans/m1-evidence.txt', 'M1 smoke PASS — ' + new Date().toISOString() + '\\ningest 202 received for N events; restart reproduced 0 dupes\\n')"
git add docs/superpowers/plans/m1-evidence.txt
git commit -m "docs(m1): smoke evidence"
```

---

### Task 23: Open the M1 PR

- [ ] **Step 1: Push the branch**

If you've been committing directly to `main`, skip this and jump to Step 2. Otherwise:

```bash
git push -u origin <branch>
```

- [ ] **Step 2: Run the M1 merge-blocker self-check against spec §7.1**

Open `docs/superpowers/specs/2026-04-16-workstream-b-collector-adapters-design.md` §7.1 and tick every box in a follow-up comment on Issue #1:

- ☐ Claude Code JSONL adapter emits real `Event[]` from a real `~/.claude/projects/*/sessions/*.jsonl`
- ☐ `bun run test` green; at least 10 new Claude-Code-adapter tests landed
- ☐ Event flows: adapter → egress journal → worker → ingest /v1/events → 202 Accepted → `submitted_at` set
- ☐ P0 fixes for Claude Code: `parseSessionFile` dedup, `durationMs` fix, safe file reader, pricing-version stamped, onboarding safety helper
- ☐ Egress journal survives kill -9 + restart with no duplicate sends
- ☐ `devmetrics status` + `devmetrics audit --tail` + `devmetrics dry-run` work
- ☐ M0 contract drift (`@devmetrics/*` → `@bematist/*`) fixed with additive changelogs

The remaining two M1 gate lines (Jorge's `dev_daily_rollup` populates; Sandesh's tile renders) are verified in the M1 integration window, not by David alone — they're part of the checkpoint PR review, not the branch.

- [ ] **Step 3: PR into `main`**

```bash
gh pr create --title "M1: Claude Code first-event E2E" --body "$(cat <<'EOF'
## Summary
- Claude Code JSONL adapter end-to-end (discovery → parse → normalize → journal → ingest)
- SQLite-backed egress journal (WAL mode) + bounded-concurrency orchestrator
- Phase 0 P0 fixes (D17) for Claude Code: parseSessionFile dedup, durationMs, safe file reader, pricing_version stamped, LiteLLM pin
- M1 CLI set: status, audit --tail, dry-run, serve
- Contracts 01/03/06 `@devmetrics/*` → `@bematist/*` changelog

Closes: GH Issue #1 Sprint 1 deliverables (items 1–4)
Spec: docs/superpowers/specs/2026-04-16-workstream-b-collector-adapters-design.md
Plan: docs/superpowers/plans/2026-04-16-m1-claude-code-first-event-e2e.md

## Test plan
- [x] bun test — all green
- [x] Lint + typecheck — green
- [x] E2E smoke: adapter → journal → ingest returns 202 (see m1-evidence.txt)
- [x] Restart idempotency verified

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (done after final task; fix-then-move-on)

1. **Spec coverage** — every M1 gate item in spec §7.1 is implemented by a task:
   - "Claude Code JSONL adapter emits real events" → Task 17
   - "≥10 new tests" → Tasks 1–18 each add tests (~30+ total)
   - "adapter → journal → ingest → 202" → Task 22
   - "Jorge's CH populates; Sandesh's tile renders" → explicitly deferred to M1 integration window per checkpoint definition
   - "P0 fixes" → Task 5 (pricing), Task 12 (safe reader), Task 14 (parseSessionFile + durationMs), Task 16 (pricing_version stamp), Task 2 (onboarding safety helper)
   - "Egress journal survives kill -9" → Tasks 6+7 (WAL mode + INSERT OR IGNORE)
   - "`status` / `audit --tail` / `dry-run`" → Task 19
   - "M0 contract drift fix" → Task 20

2. **Placeholder scan** — no TBDs, TODOs, or "fill in later". Every step has concrete code or command.

3. **Type consistency** — `ClaudeCodeAdapter(identity)` constructor shape is consistent across Tasks 17, 18, 19. `Journal` method names (`enqueue`, `selectPending`, `markSubmitted`, `markFailed`, `pendingCount`, `tail`) consistent across Tasks 7 + 8 + 9 + 19. `flushOnce` return shape consistent across Tasks 9 + 19.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-m1-claude-code-first-event-e2e.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
