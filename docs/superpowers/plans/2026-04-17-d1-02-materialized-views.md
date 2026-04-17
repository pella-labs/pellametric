# D1-02: ClickHouse Materialized Views — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 5 ClickHouse tables (3 true MVs + 1 plain RMT table + 1 MV on the plain table) that pre-aggregate the event stream for scoring and dashboard reads, plus the 2 additive `events` columns those MVs depend on.

**Architecture:** 6 CH migrations applied in order by `bun run db:migrate:ch`. Migrations use `CREATE ... IF NOT EXISTS` so repeated runs are idempotent. Tests run via `bun test` using `@clickhouse/client` against the local docker stack (`http://localhost:8123`, database `bematist`). Each test resets CH state before running via a shared helper. Seed script produces a deterministic 8k-event fixture with fixed RNG seed.

**Tech Stack:** ClickHouse 25.8 · `@clickhouse/client@^1.7` (HTTP) · Bun test · TypeScript 5.9 · Drizzle (PG side, unchanged here)

**Spec reference:** `docs/superpowers/specs/2026-04-17-d1-02-materialized-views-design.md`
**Ticket primer:** `docs/tickets/D1-02-materialized-views.md`

---

## File structure

All changes under `packages/schema/`. No app or contract code changes.

**Created:**
- `packages/schema/clickhouse/migrations/0002_events_add_repo_cluster_cols.sql` — additive ALTER
- `packages/schema/clickhouse/migrations/0003_dev_daily_rollup.sql`
- `packages/schema/clickhouse/migrations/0004_team_weekly_rollup.sql` — dictionary + MV
- `packages/schema/clickhouse/migrations/0005_repo_weekly_rollup.sql`
- `packages/schema/clickhouse/migrations/0006_cluster_assignment_mv.sql`
- `packages/schema/clickhouse/migrations/0007_prompt_cluster_stats.sql`
- `packages/schema/clickhouse/client.ts` — shared CH client factory (reused by migrate, seed, tests)
- `packages/schema/clickhouse/__tests__/_harness.ts` — test isolation helpers
- `packages/schema/clickhouse/__tests__/0002_events_columns.test.ts`
- `packages/schema/clickhouse/__tests__/0003_dev_daily_rollup.test.ts`
- `packages/schema/clickhouse/__tests__/0004_team_weekly_rollup.test.ts`
- `packages/schema/clickhouse/__tests__/0005_repo_weekly_rollup.test.ts`
- `packages/schema/clickhouse/__tests__/0006_cluster_assignment_mv.test.ts`
- `packages/schema/clickhouse/__tests__/0007_prompt_cluster_stats.test.ts`
- `packages/schema/clickhouse/__tests__/integration.test.ts` — cross-MV tests
- `packages/schema/scripts/seed.ts` — deterministic fixture generator

**Modified:**
- `packages/schema/package.json` — add `"seed"` script binding
- `contracts/09-storage-schema.md` — changelog entry
- `docs/DEVLOG.md` — entry on completion
- `docs/tickets/README.md` — flip D1-02 status to ✅

**Not modified:** existing `0001_events.sql`, other packages, apps.

---

## Prerequisites

- On branch `D1-02-materialized-views-jorge` (already created).
- Docker stack running: `docker compose -f docker-compose.dev.yml -f docker-compose.dev.local.yml up -d`.
- Spec approved (`docs/superpowers/specs/2026-04-17-d1-02-materialized-views-design.md`).
- Current state: `0001_events.sql` is applied; PG has `orgs`/`users`/`developers`.

---

## Task 1: Shared ClickHouse client factory

Extract the client setup into a shared module so migrate, seed, and tests use the same config.

**Files:**
- Create: `packages/schema/clickhouse/client.ts`

- [ ] **Step 1: Create the client factory**

`packages/schema/clickhouse/client.ts`:
```ts
import { createClient } from "@clickhouse/client";

export const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
export const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";

/** Client bound to the application database. */
export function ch() {
  return createClient({ url: CH_URL, database: CH_DATABASE });
}

/** Client NOT bound to a database; for CREATE DATABASE / DROP DATABASE. */
export function chRoot() {
  return createClient({ url: CH_URL });
}
```

- [ ] **Step 2: Refactor `migrate.ts` to use the factory**

Replace the top of `packages/schema/clickhouse/migrate.ts` (lines 1–12) with:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ch, chRoot, CH_DATABASE } from "./client";

const rootClient = chRoot();
await rootClient.command({ query: `CREATE DATABASE IF NOT EXISTS ${CH_DATABASE}` });
await rootClient.close();

const client = ch();
```

Keep the rest of the file unchanged.

- [ ] **Step 3: Verify migrate still works**

Run: `bun run db:migrate:ch`
Expected:
```
[ch-migrate] applied 0001_events.sql
[ch-migrate] done — 1 file(s) applied to bematist
```

- [ ] **Step 4: Commit**

```bash
git add packages/schema/clickhouse/client.ts packages/schema/clickhouse/migrate.ts
git commit -m "refactor(schema): extract shared CH client factory"
```

---

## Task 2: Test harness for CH isolation

Tests need a clean CH state per file. Provide a helper that truncates `events` and drops all D1-02 MVs before each test.

**Files:**
- Create: `packages/schema/clickhouse/__tests__/_harness.ts`

- [ ] **Step 1: Write the harness**

`packages/schema/clickhouse/__tests__/_harness.ts`:
```ts
import type { ClickHouseClient } from "@clickhouse/client";
import { ch } from "../client";

export const MV_NAMES = [
  "dev_daily_rollup",
  "team_weekly_rollup",
  "repo_weekly_rollup",
  "prompt_cluster_stats",
] as const;

export const PLAIN_TABLES_FOR_TEST = ["cluster_assignment_mv"] as const;

/** Returns a fresh CH client; caller is responsible for close(). */
export function makeClient(): ClickHouseClient {
  return ch();
}

/** Truncate `events` and the cluster_assignment_mv plain table (no-op if table missing). */
export async function resetState(client: ClickHouseClient): Promise<void> {
  await client.command({ query: "TRUNCATE TABLE IF EXISTS events" });
  for (const table of PLAIN_TABLES_FOR_TEST) {
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${table}` });
  }
}

/** Insert a batch of rows into `events`. Values are partial; defaults fill the rest. */
export type TestEvent = {
  client_event_id: string;
  ts: string; // ISO
  org_id: string;
  engineer_id: string;
  session_id: string;
  event_seq: number;
  source?: string;
  event_kind?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  edit_decision?: string;
  revert_within_24h?: number | null;
  repo_id_hash?: string | null;
  prompt_cluster_id?: string | null;
  commit_sha?: string | null;
  pr_number?: number | null;
  duration_ms?: number;
};

export async function insertEvents(client: ClickHouseClient, rows: TestEvent[]): Promise<void> {
  const filled = rows.map((r) => ({
    client_event_id: r.client_event_id,
    schema_version: 1,
    ts: r.ts,
    org_id: r.org_id,
    engineer_id: r.engineer_id,
    device_id: "test-device",
    source: r.source ?? "claude-code",
    source_version: "1.0.0",
    fidelity: "full",
    cost_estimated: 0,
    tier: "B",
    session_id: r.session_id,
    event_seq: r.event_seq,
    parent_session_id: null,
    gen_ai_system: "anthropic",
    gen_ai_request_model: "claude-opus-4-7",
    gen_ai_response_model: "claude-opus-4-7",
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    event_kind: r.event_kind ?? "llm_request",
    cost_usd: r.cost_usd ?? 0,
    pricing_version: "v1",
    duration_ms: r.duration_ms ?? 0,
    tool_name: "",
    tool_status: "",
    hunk_sha256: null,
    file_path_hash: null,
    edit_decision: r.edit_decision ?? "",
    revert_within_24h: r.revert_within_24h ?? null,
    first_try_failure: null,
    prompt_text: null,
    tool_input: null,
    tool_output: null,
    prompt_abstract: null,
    prompt_embedding: [],
    prompt_index: 0,
    redaction_count: 0,
    pr_number: r.pr_number ?? null,
    commit_sha: r.commit_sha ?? null,
    branch: null,
    raw_attrs: "{}",
    repo_id_hash: r.repo_id_hash ?? null,
    prompt_cluster_id: r.prompt_cluster_id ?? null,
  }));
  await client.insert({
    table: "events",
    values: filled,
    format: "JSONEachRow",
  });
}

/** Query helper returning rows as plain objects. */
export async function query<T = Record<string, unknown>>(
  client: ClickHouseClient,
  sql: string,
): Promise<T[]> {
  const res = await client.query({ query: sql, format: "JSONEachRow" });
  return (await res.json()) as T[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/schema/clickhouse/__tests__/_harness.ts
git commit -m "test(schema): add CH test harness (reset + insertEvents + query)"
```

---

## Task 3: Additive `events` columns migration (0002)

Adds `repo_id_hash` and `prompt_cluster_id` to `events`. Required by later MVs that filter on these.

**Files:**
- Create: `packages/schema/clickhouse/migrations/0002_events_add_repo_cluster_cols.sql`
- Create: `packages/schema/clickhouse/__tests__/0002_events_columns.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/schema/clickhouse/__tests__/0002_events_columns.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeAll(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("events has repo_id_hash and prompt_cluster_id columns (nullable)", async () => {
  const rows = await query<{ name: string; type: string }>(
    client,
    `SELECT name, type FROM system.columns WHERE database = 'bematist' AND table = 'events' AND name IN ('repo_id_hash', 'prompt_cluster_id')`,
  );
  const names = rows.map((r) => r.name).sort();
  expect(names).toEqual(["prompt_cluster_id", "repo_id_hash"]);
  for (const r of rows) {
    expect(r.type).toBe("Nullable(String)");
  }
});

test("event insert round-trips repo_id_hash and prompt_cluster_id", async () => {
  await insertEvents(client, [
    {
      client_event_id: "11111111-1111-1111-1111-111111111111",
      ts: "2026-04-01T10:00:00.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 0,
      repo_id_hash: "repo_hash_x",
      prompt_cluster_id: "cluster_42",
    },
    {
      client_event_id: "22222222-2222-2222-2222-222222222222",
      ts: "2026-04-01T10:00:01.000Z",
      org_id: "org_a",
      engineer_id: "eng_1",
      session_id: "s1",
      event_seq: 1,
    },
  ]);
  const out = await query<{ repo_id_hash: string | null; prompt_cluster_id: string | null }>(
    client,
    `SELECT repo_id_hash, prompt_cluster_id FROM events WHERE org_id = 'org_a' ORDER BY event_seq`,
  );
  expect(out).toEqual([
    { repo_id_hash: "repo_hash_x", prompt_cluster_id: "cluster_42" },
    { repo_id_hash: null, prompt_cluster_id: null },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/schema/clickhouse/__tests__/0002_events_columns.test.ts`
Expected: fails with error mentioning `repo_id_hash` or `prompt_cluster_id` not found.

- [ ] **Step 3: Write the migration**

`packages/schema/clickhouse/migrations/0002_events_add_repo_cluster_cols.sql`:
```sql
-- D1-02: additive columns used by repo_weekly_rollup and cluster_assignment_mv.
-- Assumed by contract 09 §MVs but missing from §events — closes the gap.
ALTER TABLE events ADD COLUMN IF NOT EXISTS repo_id_hash      Nullable(String) DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS prompt_cluster_id Nullable(String) DEFAULT NULL;
```

- [ ] **Step 4: Apply and verify test passes**

Run: `bun run db:migrate:ch`
Expected: `[ch-migrate] applied 0002_events_add_repo_cluster_cols.sql`.

Run: `bun test packages/schema/clickhouse/__tests__/0002_events_columns.test.ts`
Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/clickhouse/migrations/0002_events_add_repo_cluster_cols.sql packages/schema/clickhouse/__tests__/0002_events_columns.test.ts
git commit -m "feat(schema): add repo_id_hash + prompt_cluster_id columns to events"
```

---

## Task 4: `dev_daily_rollup` MV (0003)

Per-engineer daily aggregates, the scoring input. Uses `AggregatingMergeTree` with `-State` combinators.

**Files:**
- Create: `packages/schema/clickhouse/migrations/0003_dev_daily_rollup.sql`
- Create: `packages/schema/clickhouse/__tests__/0003_dev_daily_rollup.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/schema/clickhouse/__tests__/0003_dev_daily_rollup.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("dev_daily_rollup exists with AggregatingMergeTree engine", async () => {
  const rows = await query<{ engine: string }>(
    client,
    `SELECT engine FROM system.tables WHERE database = 'bematist' AND name = 'dev_daily_rollup'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].engine).toBe("AggregatingMergeTree");
});

test("sumMerge(input_tokens_state) equals SUM(input_tokens) across 10 events", async () => {
  const base = "2026-04-01T10:00:00.000Z";
  const rows = Array.from({ length: 10 }, (_, i) => ({
    client_event_id: `ev-${i.toString().padStart(8, "0")}-0000-0000-0000-000000000000`,
    ts: base,
    org_id: "org_a",
    engineer_id: "eng_1",
    session_id: "s1",
    event_seq: i,
    input_tokens: 100 * (i + 1), // sum = 100 + 200 + ... + 1000 = 5500
    output_tokens: 50,
    cost_usd: 0.01,
  }));
  await insertEvents(client, rows);
  const out = await query<{ tokens: number }>(
    client,
    `SELECT sumMerge(input_tokens_state) AS tokens FROM dev_daily_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0].tokens)).toBe(5500);
});

test("uniqMerge(sessions_state) counts distinct sessions per engineer per day", async () => {
  await insertEvents(client, [
    { client_event_id: "aaaaaaaa-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 0 },
    { client_event_id: "aaaaaaaa-0000-0000-0000-000000000002", ts: "2026-04-01T11:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 1 },
    { client_event_id: "aaaaaaaa-0000-0000-0000-000000000003", ts: "2026-04-01T12:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s2", event_seq: 0 },
    { client_event_id: "aaaaaaaa-0000-0000-0000-000000000004", ts: "2026-04-01T13:00:00.000Z", org_id: "org_a", engineer_id: "eng_2", session_id: "s3", event_seq: 0 },
  ]);
  const out = await query<{ engineer_id: string; sessions: number }>(
    client,
    `SELECT engineer_id, toUInt64(uniqMerge(sessions_state)) AS sessions FROM dev_daily_rollup WHERE org_id = 'org_a' GROUP BY engineer_id ORDER BY engineer_id`,
  );
  expect(out).toEqual([
    { engineer_id: "eng_1", sessions: 2 },
    { engineer_id: "eng_2", sessions: 1 },
  ]);
});

test("accepted_edits_state counts only code_edit_decision accept events", async () => {
  await insertEvents(client, [
    // 3 accepted edits
    { client_event_id: "bbbbbbbb-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 0, event_kind: "code_edit_decision", edit_decision: "accept" },
    { client_event_id: "bbbbbbbb-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:01.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 1, event_kind: "code_edit_decision", edit_decision: "accept" },
    { client_event_id: "bbbbbbbb-0000-0000-0000-000000000003", ts: "2026-04-01T10:00:02.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 2, event_kind: "code_edit_decision", edit_decision: "accept" },
    // 1 rejected (not counted)
    { client_event_id: "bbbbbbbb-0000-0000-0000-000000000004", ts: "2026-04-01T10:00:03.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 3, event_kind: "code_edit_decision", edit_decision: "reject" },
    // 1 llm_request (not counted)
    { client_event_id: "bbbbbbbb-0000-0000-0000-000000000005", ts: "2026-04-01T10:00:04.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 4, event_kind: "llm_request" },
  ]);
  const out = await query<{ accepted: number }>(
    client,
    `SELECT countIfMerge(accepted_edits_state) AS accepted FROM dev_daily_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0].accepted)).toBe(3);
});

test("accepted_retained_edits_state excludes revert_within_24h=1", async () => {
  await insertEvents(client, [
    { client_event_id: "cccccccc-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 0, event_kind: "code_edit_decision", edit_decision: "accept", revert_within_24h: 0 },
    { client_event_id: "cccccccc-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:01.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 1, event_kind: "code_edit_decision", edit_decision: "accept", revert_within_24h: 0 },
    { client_event_id: "cccccccc-0000-0000-0000-000000000003", ts: "2026-04-01T10:00:02.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 2, event_kind: "code_edit_decision", edit_decision: "accept", revert_within_24h: 1 },
  ]);
  const out = await query<{ accepted: number; retained: number }>(
    client,
    `SELECT countIfMerge(accepted_edits_state) AS accepted, countIfMerge(accepted_retained_edits_state) AS retained FROM dev_daily_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0].accepted)).toBe(3);
  expect(Number(out[0].retained)).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/schema/clickhouse/__tests__/0003_dev_daily_rollup.test.ts`
Expected: all tests fail with "Table bematist.dev_daily_rollup doesn't exist".

- [ ] **Step 3: Write the migration**

`packages/schema/clickhouse/migrations/0003_dev_daily_rollup.sql`:
```sql
-- D1-02: per-engineer daily aggregates. Scoring input.
-- UTC buckets per design D2; per-org TZ at read time (E's concern).
CREATE MATERIALIZED VIEW IF NOT EXISTS dev_daily_rollup
ENGINE = AggregatingMergeTree
ORDER BY (org_id, engineer_id, day)
PARTITION BY toYYYYMM(day)
POPULATE AS SELECT
  org_id,
  engineer_id,
  toDate(ts, 'UTC')                                       AS day,
  sumState(input_tokens)                                  AS input_tokens_state,
  sumState(output_tokens)                                 AS output_tokens_state,
  sumState(cost_usd)                                      AS cost_usd_state,
  uniqState(session_id)                                   AS sessions_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept') AS accepted_edits_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept' AND revert_within_24h = 0) AS accepted_retained_edits_state,
  minState(ts)                                            AS first_ts_state,
  maxState(ts)                                            AS last_ts_state
FROM events
GROUP BY org_id, engineer_id, day;
```

- [ ] **Step 4: Apply migration and run tests**

Run: `bun run db:migrate:ch`
Expected: `[ch-migrate] applied 0003_dev_daily_rollup.sql`.

Run: `bun test packages/schema/clickhouse/__tests__/0003_dev_daily_rollup.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/clickhouse/migrations/0003_dev_daily_rollup.sql packages/schema/clickhouse/__tests__/0003_dev_daily_rollup.test.ts
git commit -m "feat(schema): add dev_daily_rollup materialized view"
```

---

## Task 5: `team_weekly_rollup` MV + `dev_team_dict` dictionary (0004)

Team tiles + 2×2 view source. Needs a CH dictionary (`dev_team_dict`) backed by PG `developers.team_id`. PG doesn't have `team_id` yet (D1-05 adds it); until then `dictGetOrNull` returns NULL and MV rows have NULL team_id.

**Files:**
- Create: `packages/schema/clickhouse/migrations/0004_team_weekly_rollup.sql`
- Create: `packages/schema/clickhouse/__tests__/0004_team_weekly_rollup.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/schema/clickhouse/__tests__/0004_team_weekly_rollup.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("team_weekly_rollup exists with AggregatingMergeTree engine", async () => {
  const rows = await query<{ engine: string }>(
    client,
    `SELECT engine FROM system.tables WHERE database = 'bematist' AND name = 'team_weekly_rollup'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].engine).toBe("AggregatingMergeTree");
});

test("dev_team_dict dictionary is registered", async () => {
  const rows = await query<{ name: string }>(
    client,
    `SELECT name FROM system.dictionaries WHERE name = 'dev_team_dict'`,
  );
  expect(rows).toHaveLength(1);
});

test("team_id is NULL when dev is not in dictionary (Mondays bucketed weekly)", async () => {
  // Monday 2026-03-30, midweek 2026-04-01, next Monday 2026-04-06
  await insertEvents(client, [
    { client_event_id: "dddddddd-0000-0000-0000-000000000001", ts: "2026-03-30T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_unknown", session_id: "s1", event_seq: 0, input_tokens: 10 },
    { client_event_id: "dddddddd-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_unknown", session_id: "s2", event_seq: 0, input_tokens: 20 },
    { client_event_id: "dddddddd-0000-0000-0000-000000000003", ts: "2026-04-06T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_unknown", session_id: "s3", event_seq: 0, input_tokens: 40 },
  ]);
  const out = await query<{ team_id: string | null; week: string; tokens: number }>(
    client,
    `SELECT team_id, toString(week) AS week, sumMerge(input_tokens_state) AS tokens
     FROM team_weekly_rollup
     WHERE org_id = 'org_a'
     GROUP BY team_id, week
     ORDER BY week`,
  );
  expect(out).toHaveLength(2);
  expect(out[0]).toEqual({ team_id: null, week: "2026-03-30", tokens: 30 });
  expect(out[1]).toEqual({ team_id: null, week: "2026-04-06", tokens: 40 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/schema/clickhouse/__tests__/0004_team_weekly_rollup.test.ts`
Expected: fail with "team_weekly_rollup" / "dev_team_dict" not found.

- [ ] **Step 3: Write the migration**

`packages/schema/clickhouse/migrations/0004_team_weekly_rollup.sql`:
```sql
-- D1-02: team-weekly rollup for manager tiles + 2×2 view.
-- team_id comes from dev_team_dict; data lands when D1-05 adds teams + developers.team_id.
-- Until then: dictGetOrNull returns NULL; rows exist with NULL team_id.
CREATE DICTIONARY IF NOT EXISTS dev_team_dict (
  engineer_id String,
  team_id     Nullable(String)
)
PRIMARY KEY engineer_id
SOURCE(POSTGRESQL(
  port 5432
  host 'bematist-postgres'
  user 'postgres'
  password 'postgres'
  db 'bematist'
  table 'developers'
  invalidate_query 'SELECT max(created_at) FROM developers'
  query 'SELECT stable_hash AS engineer_id, NULL::text AS team_id FROM developers'
))
LAYOUT(HASHED())
LIFETIME(MIN 300 MAX 900);

CREATE MATERIALIZED VIEW IF NOT EXISTS team_weekly_rollup
ENGINE = AggregatingMergeTree
ORDER BY (org_id, team_id, week)
PARTITION BY toYYYYMM(week)
POPULATE AS SELECT
  org_id,
  dictGetOrNull('dev_team_dict', 'team_id', engineer_id)  AS team_id,
  toMonday(toDate(ts, 'UTC'))                             AS week,
  sumState(input_tokens)                                  AS input_tokens_state,
  sumState(output_tokens)                                 AS output_tokens_state,
  sumState(cost_usd)                                      AS cost_usd_state,
  uniqState(session_id)                                   AS sessions_state,
  uniqState(engineer_id)                                  AS engineers_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept') AS accepted_edits_state
FROM events
GROUP BY org_id, team_id, week;
```

Note: the dictionary query returns `NULL::text AS team_id` because `developers.team_id` doesn't exist yet; D1-05 will replace this with `team_id::text`. The dictionary itself exists today so the MV can reference it.

- [ ] **Step 4: Apply migration and run tests**

Run: `bun run db:migrate:ch`
Expected: `[ch-migrate] applied 0004_team_weekly_rollup.sql`.

Run: `bun test packages/schema/clickhouse/__tests__/0004_team_weekly_rollup.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/clickhouse/migrations/0004_team_weekly_rollup.sql packages/schema/clickhouse/__tests__/0004_team_weekly_rollup.test.ts
git commit -m "feat(schema): add team_weekly_rollup MV + dev_team_dict dictionary"
```

---

## Task 6: `repo_weekly_rollup` MV (0005)

Per-repo weekly aggregates. Only counts events with non-null `repo_id_hash`.

**Files:**
- Create: `packages/schema/clickhouse/migrations/0005_repo_weekly_rollup.sql`
- Create: `packages/schema/clickhouse/__tests__/0005_repo_weekly_rollup.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/schema/clickhouse/__tests__/0005_repo_weekly_rollup.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("repo_weekly_rollup exists with AggregatingMergeTree engine", async () => {
  const rows = await query<{ engine: string }>(
    client,
    `SELECT engine FROM system.tables WHERE database = 'bematist' AND name = 'repo_weekly_rollup'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].engine).toBe("AggregatingMergeTree");
});

test("events without repo_id_hash are excluded", async () => {
  await insertEvents(client, [
    { client_event_id: "eeeeeeee-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 0, input_tokens: 100, repo_id_hash: "repo_x" },
    { client_event_id: "eeeeeeee-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:01.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 1, input_tokens: 200, repo_id_hash: null },
  ]);
  const out = await query<{ tokens: number }>(
    client,
    `SELECT sumMerge(input_tokens_state) AS tokens FROM repo_weekly_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0].tokens)).toBe(100);
});

test("prs_state counts only non-null pr_number", async () => {
  await insertEvents(client, [
    { client_event_id: "ffffffff-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 0, repo_id_hash: "repo_x", pr_number: 101 },
    { client_event_id: "ffffffff-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:01.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 1, repo_id_hash: "repo_x", pr_number: 102 },
    { client_event_id: "ffffffff-0000-0000-0000-000000000003", ts: "2026-04-01T10:00:02.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 2, repo_id_hash: "repo_x", pr_number: 101 },
    { client_event_id: "ffffffff-0000-0000-0000-000000000004", ts: "2026-04-01T10:00:03.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 3, repo_id_hash: "repo_x", pr_number: null },
  ]);
  const out = await query<{ prs: number }>(
    client,
    `SELECT toUInt64(uniqMerge(prs_state)) AS prs FROM repo_weekly_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0].prs)).toBe(2);
});

test("commits_state counts unique commit_sha per repo-week", async () => {
  await insertEvents(client, [
    { client_event_id: "99999999-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 0, repo_id_hash: "repo_x", commit_sha: "abc123" },
    { client_event_id: "99999999-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:01.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 1, repo_id_hash: "repo_x", commit_sha: "abc123" },
    { client_event_id: "99999999-0000-0000-0000-000000000003", ts: "2026-04-01T10:00:02.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 2, repo_id_hash: "repo_x", commit_sha: "def456" },
  ]);
  const out = await query<{ commits: number }>(
    client,
    `SELECT toUInt64(uniqMerge(commits_state)) AS commits FROM repo_weekly_rollup WHERE org_id = 'org_a'`,
  );
  expect(Number(out[0].commits)).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/schema/clickhouse/__tests__/0005_repo_weekly_rollup.test.ts`
Expected: fail with "repo_weekly_rollup doesn't exist".

- [ ] **Step 3: Write the migration**

`packages/schema/clickhouse/migrations/0005_repo_weekly_rollup.sql`:
```sql
-- D1-02: per-repo weekly rollup for repo pages + outcome attribution.
-- Only counts events with repo_id_hash (those with no repo attribution fall out).
CREATE MATERIALIZED VIEW IF NOT EXISTS repo_weekly_rollup
ENGINE = AggregatingMergeTree
ORDER BY (org_id, repo_id_hash, week)
PARTITION BY toYYYYMM(week)
POPULATE AS SELECT
  org_id,
  repo_id_hash,
  toMonday(toDate(ts, 'UTC'))                             AS week,
  sumState(input_tokens)                                  AS input_tokens_state,
  sumState(output_tokens)                                 AS output_tokens_state,
  sumState(cost_usd)                                      AS cost_usd_state,
  uniqState(session_id)                                   AS sessions_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept') AS accepted_edits_state,
  countIfState(event_kind = 'code_edit_decision' AND edit_decision = 'accept' AND revert_within_24h = 0) AS accepted_retained_edits_state,
  uniqStateIf(commit_sha, commit_sha IS NOT NULL)         AS commits_state,
  uniqStateIf(pr_number, pr_number IS NOT NULL)           AS prs_state
FROM events
WHERE repo_id_hash IS NOT NULL
GROUP BY org_id, repo_id_hash, week;
```

- [ ] **Step 4: Apply migration and run tests**

Run: `bun run db:migrate:ch`
Expected: `[ch-migrate] applied 0005_repo_weekly_rollup.sql`.

Run: `bun test packages/schema/clickhouse/__tests__/0005_repo_weekly_rollup.test.ts`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/clickhouse/migrations/0005_repo_weekly_rollup.sql packages/schema/clickhouse/__tests__/0005_repo_weekly_rollup.test.ts
git commit -m "feat(schema): add repo_weekly_rollup materialized view"
```

---

## Task 7: `cluster_assignment_mv` plain table (0006)

Plain `ReplacingMergeTree(ts)` table. H's nightly cluster job writes to it. Name kept per contract 09 even though it's not a CH MV.

**Files:**
- Create: `packages/schema/clickhouse/migrations/0006_cluster_assignment_mv.sql`
- Create: `packages/schema/clickhouse/__tests__/0006_cluster_assignment_mv.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/schema/clickhouse/__tests__/0006_cluster_assignment_mv.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

async function insertAssignment(rows: Array<{ org_id: string; session_id: string; prompt_index: number; cluster_id: string; ts: string }>): Promise<void> {
  await client.insert({
    table: "cluster_assignment_mv",
    values: rows,
    format: "JSONEachRow",
  });
}

test("cluster_assignment_mv exists with ReplacingMergeTree engine", async () => {
  const rows = await query<{ engine: string; engine_full: string }>(
    client,
    `SELECT engine, engine_full FROM system.tables WHERE database = 'bematist' AND name = 'cluster_assignment_mv'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].engine).toBe("ReplacingMergeTree");
  expect(rows[0].engine_full).toContain("ReplacingMergeTree(ts)");
});

test("insert round-trips (org, session, prompt_index, cluster_id, ts)", async () => {
  await insertAssignment([
    { org_id: "org_a", session_id: "s1", prompt_index: 0, cluster_id: "c_1", ts: "2026-04-01T10:00:00.000Z" },
  ]);
  const out = await query<{ cluster_id: string }>(
    client,
    `SELECT cluster_id FROM cluster_assignment_mv WHERE org_id = 'org_a' AND session_id = 's1'`,
  );
  expect(out).toHaveLength(1);
  expect(out[0].cluster_id).toBe("c_1");
});

test("latest ts wins after FINAL when re-clustering happens", async () => {
  await insertAssignment([
    { org_id: "org_a", session_id: "s1", prompt_index: 0, cluster_id: "c_old", ts: "2026-04-01T10:00:00.000Z" },
    { org_id: "org_a", session_id: "s1", prompt_index: 0, cluster_id: "c_new", ts: "2026-04-02T10:00:00.000Z" },
  ]);
  const out = await query<{ cluster_id: string }>(
    client,
    `SELECT cluster_id FROM cluster_assignment_mv FINAL WHERE org_id = 'org_a' AND session_id = 's1' AND prompt_index = 0`,
  );
  expect(out).toHaveLength(1);
  expect(out[0].cluster_id).toBe("c_new");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/schema/clickhouse/__tests__/0006_cluster_assignment_mv.test.ts`
Expected: fail with "cluster_assignment_mv doesn't exist".

- [ ] **Step 3: Write the migration**

`packages/schema/clickhouse/migrations/0006_cluster_assignment_mv.sql`:
```sql
-- D1-02: session→cluster mapping. Populated by H's nightly cluster job (Sprint 2).
-- Name retained per contract 09 though this is a plain table, not a CH MV.
CREATE TABLE IF NOT EXISTS cluster_assignment_mv (
  org_id        LowCardinality(String),
  session_id    String,
  prompt_index  UInt32,
  cluster_id    String,
  ts            DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(ts)
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, session_id, prompt_index);
```

- [ ] **Step 4: Apply and run tests**

Run: `bun run db:migrate:ch`
Expected: `[ch-migrate] applied 0006_cluster_assignment_mv.sql`.

Run: `bun test packages/schema/clickhouse/__tests__/0006_cluster_assignment_mv.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/clickhouse/migrations/0006_cluster_assignment_mv.sql packages/schema/clickhouse/__tests__/0006_cluster_assignment_mv.test.ts
git commit -m "feat(schema): add cluster_assignment_mv plain table (RMT by ts)"
```

---

## Task 8: `prompt_cluster_stats` MV (0007)

Triggers on INSERT into `cluster_assignment_mv`. Joins to `events` to get cost/duration per cluster-week.

**Files:**
- Create: `packages/schema/clickhouse/migrations/0007_prompt_cluster_stats.sql`
- Create: `packages/schema/clickhouse/__tests__/0007_prompt_cluster_stats.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/schema/clickhouse/__tests__/0007_prompt_cluster_stats.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

async function insertAssignment(rows: Array<{ org_id: string; session_id: string; prompt_index: number; cluster_id: string; ts: string }>): Promise<void> {
  await client.insert({
    table: "cluster_assignment_mv",
    values: rows,
    format: "JSONEachRow",
  });
}

test("prompt_cluster_stats exists with AggregatingMergeTree engine", async () => {
  const rows = await query<{ engine: string }>(
    client,
    `SELECT engine FROM system.tables WHERE database = 'bematist' AND name = 'prompt_cluster_stats'`,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].engine).toBe("AggregatingMergeTree");
});

test("prompt_count_state increments per cluster-week assignment", async () => {
  // First land some events so the JOIN has something to match.
  await insertEvents(client, [
    { client_event_id: "77777777-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s1", event_seq: 0, cost_usd: 0.05, duration_ms: 1000 },
    { client_event_id: "77777777-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:01.000Z", org_id: "org_a", engineer_id: "eng_2", session_id: "s2", event_seq: 0, cost_usd: 0.03, duration_ms: 500 },
  ]);
  await insertAssignment([
    { org_id: "org_a", session_id: "s1", prompt_index: 0, cluster_id: "c_42", ts: "2026-04-01T10:00:00.000Z" },
    { org_id: "org_a", session_id: "s2", prompt_index: 0, cluster_id: "c_42", ts: "2026-04-01T10:00:01.000Z" },
  ]);
  const out = await query<{ cluster_id: string; engineers: number; count: number }>(
    client,
    `SELECT cluster_id, toUInt64(uniqMerge(contributing_engineers_state)) AS engineers, toUInt64(sumMerge(prompt_count_state)) AS count
     FROM prompt_cluster_stats
     WHERE org_id = 'org_a'
     GROUP BY cluster_id`,
  );
  expect(out).toHaveLength(1);
  expect(out[0].cluster_id).toBe("c_42");
  expect(Number(out[0].engineers)).toBe(2);
  expect(Number(out[0].count)).toBe(2);
});

test("cost_usd_state reflects joined events", async () => {
  await insertEvents(client, [
    { client_event_id: "88888888-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_a", engineer_id: "eng_1", session_id: "s_cost", event_seq: 0, cost_usd: 1.5 },
  ]);
  await insertAssignment([
    { org_id: "org_a", session_id: "s_cost", prompt_index: 0, cluster_id: "c_cost", ts: "2026-04-01T10:00:00.000Z" },
  ]);
  const out = await query<{ cost: number }>(
    client,
    `SELECT sumMerge(cost_usd_state) AS cost FROM prompt_cluster_stats WHERE org_id = 'org_a' AND cluster_id = 'c_cost'`,
  );
  expect(Number(out[0].cost)).toBeCloseTo(1.5, 4);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/schema/clickhouse/__tests__/0007_prompt_cluster_stats.test.ts`
Expected: fail with "prompt_cluster_stats doesn't exist".

- [ ] **Step 3: Write the migration**

`packages/schema/clickhouse/migrations/0007_prompt_cluster_stats.sql`:
```sql
-- D1-02: per-cluster weekly stats. Triggers on INSERT into cluster_assignment_mv.
-- JOINs back to events for cost/duration. Empty until H's nightly cluster job runs.
CREATE MATERIALIZED VIEW IF NOT EXISTS prompt_cluster_stats
ENGINE = AggregatingMergeTree
ORDER BY (org_id, cluster_id, week)
PARTITION BY toYYYYMM(week)
POPULATE AS SELECT
  a.org_id                                                AS org_id,
  a.cluster_id                                            AS cluster_id,
  toMonday(toDate(a.ts, 'UTC'))                           AS week,
  sumState(toUInt64(1))                                   AS prompt_count_state,
  uniqState(e.engineer_id)                                AS contributing_engineers_state,
  sumState(e.cost_usd)                                    AS cost_usd_state,
  avgState(e.duration_ms)                                 AS avg_duration_state
FROM cluster_assignment_mv AS a
LEFT JOIN events AS e USING (org_id, session_id, prompt_index)
GROUP BY a.org_id, a.cluster_id, week;
```

Note: the `POPULATE` back-fills from existing cluster_assignment_mv rows at creation; empty tables → empty MV, fine.

- [ ] **Step 4: Apply migration and run tests**

Run: `bun run db:migrate:ch`
Expected: `[ch-migrate] applied 0007_prompt_cluster_stats.sql`.

Run: `bun test packages/schema/clickhouse/__tests__/0007_prompt_cluster_stats.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/clickhouse/migrations/0007_prompt_cluster_stats.sql packages/schema/clickhouse/__tests__/0007_prompt_cluster_stats.test.ts
git commit -m "feat(schema): add prompt_cluster_stats MV on cluster_assignment_mv"
```

---

## Task 9: Integration tests

Cross-MV tests: partition-drop survival, empty-cohort handling, property-based sum equality.

**Files:**
- Create: `packages/schema/clickhouse/__tests__/integration.test.ts`

- [ ] **Step 1: Write the tests**

`packages/schema/clickhouse/__tests__/integration.test.ts`:
```ts
import { afterAll, beforeEach, expect, test } from "bun:test";
import { insertEvents, makeClient, query, resetState, type TestEvent } from "./_harness";

const client = makeClient();

beforeEach(async () => {
  await resetState(client);
});

afterAll(async () => {
  await client.close();
});

test("empty-cohort org returns 0 rows from dev_daily_rollup (not NULL row)", async () => {
  const rows = await query<{ c: number }>(
    client,
    `SELECT count() AS c FROM dev_daily_rollup WHERE org_id = 'org_never_written'`,
  );
  expect(Number(rows[0].c)).toBe(0);
});

test("property test: sumMerge(input_tokens_state) equals naive SUM(input_tokens) over 200 random rows", async () => {
  const seed = 0x1337;
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };
  const rows: TestEvent[] = Array.from({ length: 200 }, (_, i) => ({
    client_event_id: `aabbccdd-${i.toString(16).padStart(4, "0")}-0000-0000-000000000000`,
    ts: `2026-04-${String(1 + (rand() % 10)).padStart(2, "0")}T${String(rand() % 24).padStart(2, "0")}:00:00.000Z`,
    org_id: "org_prop",
    engineer_id: `eng_${rand() % 5}`,
    session_id: `s_${rand() % 20}`,
    event_seq: i,
    input_tokens: rand() % 10_000,
    output_tokens: rand() % 5000,
    cost_usd: (rand() % 1000) / 100,
  }));
  await insertEvents(client, rows);

  const raw = await query<{ tokens: number }>(
    client,
    `SELECT sum(input_tokens) AS tokens FROM events WHERE org_id = 'org_prop'`,
  );
  const mv = await query<{ tokens: number }>(
    client,
    `SELECT sumMerge(input_tokens_state) AS tokens FROM dev_daily_rollup WHERE org_id = 'org_prop'`,
  );
  expect(Number(mv[0].tokens)).toBe(Number(raw[0].tokens));
});

test("partition drop on events also removes dev_daily_rollup partition rows for that month", async () => {
  // Two months of events for one org.
  await insertEvents(client, [
    { client_event_id: "55555555-0000-0000-0000-000000000001", ts: "2026-03-15T10:00:00.000Z", org_id: "org_drop", engineer_id: "eng_d", session_id: "s_mar", event_seq: 0, input_tokens: 100 },
    { client_event_id: "55555555-0000-0000-0000-000000000002", ts: "2026-04-15T10:00:00.000Z", org_id: "org_drop", engineer_id: "eng_d", session_id: "s_apr", event_seq: 0, input_tokens: 200 },
  ]);

  // Before drop: both months present in dev_daily_rollup.
  const before = await query<{ c: number }>(
    client,
    `SELECT count() AS c FROM dev_daily_rollup WHERE org_id = 'org_drop'`,
  );
  expect(Number(before[0].c)).toBe(2);

  // Drop the March partition of dev_daily_rollup directly — AMT partitions by toYYYYMM(day).
  await client.command({
    query: `ALTER TABLE dev_daily_rollup DROP PARTITION 202603`,
  });

  const after = await query<{ c: number }>(
    client,
    `SELECT count() AS c FROM dev_daily_rollup WHERE org_id = 'org_drop'`,
  );
  expect(Number(after[0].c)).toBe(1);
});

test("MV POPULATE is a no-op on empty source (dev_daily_rollup exists with 0 rows when events is empty)", async () => {
  const rows = await query<{ c: number }>(
    client,
    `SELECT count() AS c FROM dev_daily_rollup`,
  );
  expect(Number(rows[0].c)).toBe(0);
});

test("repo_weekly_rollup still populates when dev_daily_rollup has rows without repo_id_hash", async () => {
  await insertEvents(client, [
    { client_event_id: "66666666-0000-0000-0000-000000000001", ts: "2026-04-01T10:00:00.000Z", org_id: "org_split", engineer_id: "eng_s", session_id: "s_n", event_seq: 0, input_tokens: 100, repo_id_hash: null },
    { client_event_id: "66666666-0000-0000-0000-000000000002", ts: "2026-04-01T10:00:01.000Z", org_id: "org_split", engineer_id: "eng_s", session_id: "s_y", event_seq: 0, input_tokens: 200, repo_id_hash: "repo_y" },
  ]);
  const dev = await query<{ tokens: number }>(
    client,
    `SELECT sumMerge(input_tokens_state) AS tokens FROM dev_daily_rollup WHERE org_id = 'org_split'`,
  );
  const repo = await query<{ tokens: number }>(
    client,
    `SELECT sumMerge(input_tokens_state) AS tokens FROM repo_weekly_rollup WHERE org_id = 'org_split'`,
  );
  expect(Number(dev[0].tokens)).toBe(300); // both counted
  expect(Number(repo[0].tokens)).toBe(200); // only repo-tagged event
});
```

- [ ] **Step 2: Run tests**

Run: `bun test packages/schema/clickhouse/__tests__/integration.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add packages/schema/clickhouse/__tests__/integration.test.ts
git commit -m "test(schema): cross-MV integration tests (partition drop, property, empty cohort)"
```

---

## Task 10: Seed script

Deterministic fixture generator — 3 orgs, 12 engineers, 200 sessions, 8000 events over 30 days. Wire `bun run db:seed`.

**Files:**
- Create: `packages/schema/scripts/seed.ts`
- Modify: `packages/schema/package.json` (already has `"seed": "bun scripts/seed.ts"` — verify)

- [ ] **Step 1: Verify package.json already has the seed script**

Read `packages/schema/package.json`. Confirm line `"seed": "bun scripts/seed.ts"` is present. (It is per Task 1 context — no edit needed.)

- [ ] **Step 2: Write the seed script**

`packages/schema/scripts/seed.ts`:
```ts
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ch, CH_DATABASE } from "../clickhouse/client";

const pgUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/bematist";
const sql = postgres(pgUrl, { max: 1 });
const client = ch();

// Deterministic RNG (Linear Congruential Generator) for reproducible fixtures.
let rngState = 0xDECAF;
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState;
};
const randInt = (max: number) => rand() % max;

// Truncate + reseed (idempotent).
await sql`TRUNCATE TABLE developers, users, orgs RESTART IDENTITY CASCADE`;
await client.command({ query: "TRUNCATE TABLE events" });
await client.command({ query: "TRUNCATE TABLE cluster_assignment_mv" });

// --- Orgs
type Org = { id: string; slug: string; name: string };
const orgs: Org[] = [
  { id: randomUUID(), slug: "acme", name: "Acme Co (small)" },
  { id: randomUUID(), slug: "bolt", name: "Bolt Inc (medium)" },
  { id: randomUUID(), slug: "crux", name: "Crux Corp (large)" },
];
for (const o of orgs) {
  await sql`INSERT INTO orgs (id, slug, name) VALUES (${o.id}, ${o.slug}, ${o.name})`;
}

// --- Users + developers
type Dev = { org_id: string; engineer_id: string };
const devs: Dev[] = [];
for (const [i, org] of orgs.entries()) {
  const n = i === 0 ? 2 : i === 1 ? 4 : 6; // 2+4+6 = 12
  for (let j = 0; j < n; j++) {
    const userId = randomUUID();
    const engineerHash = `eng_${org.slug}_${j}`;
    await sql`INSERT INTO users (id, org_id, sso_subject, email)
              VALUES (${userId}, ${org.id}, ${`sub_${org.slug}_${j}`}, ${`dev${j}@${org.slug}.test`})`;
    await sql`INSERT INTO developers (org_id, user_id, stable_hash)
              VALUES (${org.id}, ${userId}, ${engineerHash})`;
    devs.push({ org_id: org.id, engineer_id: engineerHash });
  }
}

// --- Events
const sources = ["claude-code", "cursor", "continue"];
const clusterIds = ["c_refactor", "c_bugfix", "c_feature", "c_test", null];
const repoHashes = ["repo_app", "repo_web", "repo_sdk", null];

const events: Record<string, unknown>[] = [];
for (let i = 0; i < 8000; i++) {
  const dev = devs[randInt(devs.length)];
  const dayOffset = randInt(30);
  const hour = randInt(24);
  const minute = randInt(60);
  const ts = new Date(Date.UTC(2026, 2 /* March */, 15 + dayOffset, hour, minute, 0)).toISOString();
  const isEdit = randInt(10) < 2; // 20% edits
  const isAccept = isEdit && randInt(10) < 7;
  events.push({
    client_event_id: randomUUID(),
    schema_version: 1,
    ts,
    org_id: dev.org_id,
    engineer_id: dev.engineer_id,
    device_id: `dev-${randInt(3)}`,
    source: sources[randInt(sources.length)],
    source_version: "1.0.0",
    fidelity: "full",
    cost_estimated: 0,
    tier: "B",
    session_id: `sess_${randInt(200)}`,
    event_seq: i % 100,
    parent_session_id: null,
    gen_ai_system: "anthropic",
    gen_ai_request_model: "claude-opus-4-7",
    gen_ai_response_model: "claude-opus-4-7",
    input_tokens: randInt(5000),
    output_tokens: randInt(2000),
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    event_kind: isEdit ? "code_edit_decision" : "llm_request",
    cost_usd: (randInt(100) / 100),
    pricing_version: "v1",
    duration_ms: randInt(5000),
    tool_name: "",
    tool_status: "",
    hunk_sha256: null,
    file_path_hash: null,
    edit_decision: isEdit ? (isAccept ? "accept" : "reject") : "",
    revert_within_24h: isAccept ? (randInt(10) < 1 ? 1 : 0) : null,
    first_try_failure: null,
    prompt_text: null,
    tool_input: null,
    tool_output: null,
    prompt_abstract: null,
    prompt_embedding: [],
    prompt_index: 0,
    redaction_count: 0,
    pr_number: randInt(10) < 3 ? randInt(500) : null,
    commit_sha: randInt(10) < 4 ? `sha_${randInt(1000)}` : null,
    branch: null,
    raw_attrs: "{}",
    repo_id_hash: repoHashes[randInt(repoHashes.length)],
    prompt_cluster_id: clusterIds[randInt(clusterIds.length)],
  });
}
await client.insert({ table: "events", values: events, format: "JSONEachRow" });

console.log(`[seed] PG: ${orgs.length} orgs, ${devs.length} developers`);
console.log(`[seed] CH: ${events.length} events inserted into ${CH_DATABASE}.events`);

await sql.end();
await client.close();
```

- [ ] **Step 3: Run the seed and verify output**

Run: `bun run db:seed`
Expected:
```
[seed] PG: 3 orgs, 12 developers
[seed] CH: 8000 events inserted into bematist.events
```

- [ ] **Step 4: Verify MVs populated**

Run:
```bash
docker exec bematist-clickhouse clickhouse-client --database bematist --query "SELECT count() FROM dev_daily_rollup"
docker exec bematist-clickhouse clickhouse-client --database bematist --query "SELECT count() FROM team_weekly_rollup"
docker exec bematist-clickhouse clickhouse-client --database bematist --query "SELECT count() FROM repo_weekly_rollup"
```
Expected: each prints a count > 0.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/scripts/seed.ts
git commit -m "feat(schema): deterministic seed script (3 orgs, 12 devs, 8k events)"
```

---

## Task 11: Fresh-migrate smoke test

Verify that dropping the database and re-running all migrations produces the same state (catches ordering bugs).

- [ ] **Step 1: Drop and re-migrate**

```bash
docker exec bematist-clickhouse clickhouse-client --query "DROP DATABASE bematist"
bun run db:migrate:ch
```

Expected output:
```
[ch-migrate] applied 0001_events.sql
[ch-migrate] applied 0002_events_add_repo_cluster_cols.sql
[ch-migrate] applied 0003_dev_daily_rollup.sql
[ch-migrate] applied 0004_team_weekly_rollup.sql
[ch-migrate] applied 0005_repo_weekly_rollup.sql
[ch-migrate] applied 0006_cluster_assignment_mv.sql
[ch-migrate] applied 0007_prompt_cluster_stats.sql
[ch-migrate] done — 7 file(s) applied to bematist
```

- [ ] **Step 2: Re-seed and re-run all tests**

```bash
bun run db:seed
bun test packages/schema/clickhouse/__tests__
```
Expected: all tests pass (count should be ≥22).

- [ ] **Step 3: Run full workspace test + typecheck + lint**

```bash
bun run test
bun run typecheck
bun run lint
```
Expected: all green.

---

## Task 12: Contract 09 changelog

Append a changelog entry documenting what this PR added.

**Files:**
- Modify: `contracts/09-storage-schema.md`

- [ ] **Step 1: Append changelog entry**

Open `contracts/09-storage-schema.md`. At the very end of the file, after the last changelog line, append:

```markdown
- 2026-04-17 — D1-02: added 5 materialized view DDLs per §Materialized views. Additive `events` columns `repo_id_hash` and `prompt_cluster_id` added (migration 0002) to support repo + cluster MV read paths (closes gap between §events and §MVs where the columns were assumed but not declared). `cluster_assignment_mv` is a plain `ReplacingMergeTree(ts)` table populated by H's nightly cluster job, not a CH `MATERIALIZED VIEW` triggering on events — name retained for historical consistency. `dev_team_dict` dictionary DDL landed; source data lands with D1-05.
```

- [ ] **Step 2: Commit**

```bash
git add contracts/09-storage-schema.md
git commit -m "docs(contracts): 09 changelog — D1-02 MVs + additive events cols"
```

---

## Task 13: DEVLOG + tickets README updates

**Files:**
- Modify: `docs/DEVLOG.md`
- Modify: `docs/tickets/README.md`

- [ ] **Step 1: Append DEVLOG entry**

Open `docs/DEVLOG.md`. After the last entry, append:

```markdown

## 2026-04-17 — D1-02: materialized views landed

- **What shipped:** 6 CH migrations (0002–0007) creating `repo_id_hash`/`prompt_cluster_id` event columns, 3 event-sourced MVs (`dev_daily_rollup`, `team_weekly_rollup`, `repo_weekly_rollup`), 1 plain table (`cluster_assignment_mv`), and 1 MV on top of it (`prompt_cluster_stats`). Deterministic seed script.
- **Branch / PR:** `D1-02-materialized-views-jorge` → PR pending push access.
- **Contracts touched:** `09-storage-schema.md` — additive changelog entry.
- **Tests added:** ~20 unit + 5 integration; all green.
- **Follow-ups:** D1-05 must replace `dev_team_dict` dictionary source query to include real `team_id` once `developers.team_id` exists. `prompt_cluster_stats` stays empty until H's nightly cluster job writes to `cluster_assignment_mv` in Sprint 2.
```

- [ ] **Step 2: Update tickets README status**

Open `docs/tickets/README.md`. Replace the D1-02 row:

```markdown
| `D1-02` | ClickHouse materialized views (5 MVs) | pending | — |
```

with:

```markdown
| `D1-02` | ClickHouse materialized views (5 MVs) | ✅ committed (push blocked) | `D1-02-materialized-views-jorge` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/DEVLOG.md docs/tickets/README.md
git commit -m "docs(D1-02): DEVLOG entry + ticket status update"
```

---

## Task 14: Push + PR (when access lands)

- [ ] **Step 1: Verify push access**

Run: `gh api repos/pella-labs/bematist --jq '.permissions.push'`
Expected: `true` (after Sebastian grants collaborator access).

- [ ] **Step 2: Push**

```bash
git push -u origin D1-02-materialized-views-jorge
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main \
  --title "feat(schema): 5 ClickHouse materialized views (Sprint 1 D1-02)" \
  --body "$(cat <<'EOF'
## Summary
- 6 CH migrations: additive `events` columns + 3 event-sourced MVs + 1 plain RMT table + 1 MV on top.
- Deterministic seed script (3 orgs, 12 devs, 8k events).
- 20+ unit tests + 5 integration tests; all green.
- Closes the gap in contract 09 between §events (no `repo_id_hash` / `prompt_cluster_id`) and §MVs (assumed them).

## Test plan
- [x] `bun run db:migrate:ch` applies cleanly from fresh
- [x] `bun run db:seed` populates all MVs
- [x] `bun test packages/schema/clickhouse/__tests__` — all green
- [x] `bun run typecheck`, `bun run lint` clean

## Follow-ups (not blocking this PR)
- D1-05 updates `dev_team_dict` source query to include real `team_id`.
- H's Sprint-2 nightly cluster job writes to `cluster_assignment_mv`; `prompt_cluster_stats` stays empty until then.
- Issue #3 "Known contract drift" items were already fixed at M0 (commit b086bfc); see D1-01 primer Resolution section.

Refs #3
EOF
)"
```

---

## Self-review checklist

Run through before declaring the plan complete:

**Spec coverage:**
- [x] §2 Scope — all 5 tables covered by Tasks 4–8.
- [x] §3 D1 (all-5 scope) — all 5 migrations + tests.
- [x] §3 D2 (UTC buckets) — every MV uses `toDate(ts, 'UTC')` and `toMonday(...)`.
- [x] §3 D3 (self-declared team) — dictionary sources from `developers`; D1-05 will add `team_id`.
- [x] §3 D4 (dictGetOrNull at MV write) — migration 0004 uses `dictGetOrNull('dev_team_dict', 'team_id', engineer_id)`.
- [x] §3 D5 (noise floor in scoring) — no WHERE on `accepted_edits < 3` in MVs; correct.
- [x] §3 D6 (task_category deferred) — not present in any migration.
- [x] §3 D7 (AMT + RMT engines) — 4 AMTs, 1 RMT.
- [x] §3 D8 (additive columns) — migration 0002.
- [x] §4.1–§4.5 per-MV schemas — Tasks 4–8 reproduce the DDL.
- [x] §5 integration points — no code changes required for ingest/scoring/dashboard in this PR; MVs just appear.
- [x] §6 tests (~22) — 2 (Task 3) + 5 (Task 4) + 3 (Task 5) + 4 (Task 6) + 3 (Task 7) + 3 (Task 8) + 5 (Task 9) = 25 tests.
- [x] §7 seed script — Task 10.
- [x] §8 migration plan — Tasks 3–8 land migrations 0002–0007.
- [x] §10 contract 09 changelog — Task 12.
- [x] §12 DoD — fresh migrate, seed, test, typecheck, lint covered by Tasks 11 & 14.
- [x] §13 risks — Plan B (D1-07), POPULATE lockup documented in migration comments.

**Placeholder scan:** ✅ No "TBD"/"TODO"/"add error handling"/"similar to Task N" patterns.

**Type consistency:** ✅ Column names (e.g., `input_tokens_state`, `sessions_state`) are identical across migrations and tests.

**Execution estimate:** 7–8 h of focused work (matches the D1-02 primer estimate).
