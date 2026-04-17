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
  // Disable WAL for testing to avoid Windows lock issues
  db.exec("PRAGMA journal_mode=DELETE");
  migrate(db);
  j = new Journal(db);
});

afterEach(() => {
  // Switch to DELETE journal mode to avoid WAL lock issues on Windows cleanup
  try {
    db.exec("PRAGMA journal_mode=DELETE");
  } catch {
    // ignore
  }
  db.close();
  // Ensure all file handles are released
  Bun.sleepSync(50);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may still have the directory locked; that's ok for test cleanup
  }
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
  cost_estimated: false,
});

test("202 marks all submitted", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () =>
    new Response(JSON.stringify({ accepted: 1, deduped: 0, request_id: "r1" }), { status: 202 });
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock as unknown as typeof fetch,
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
    fetch: fetchMock as unknown as typeof fetch,
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
    fetch: fetchMock as unknown as typeof fetch,
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
    fetch: fetchMock as unknown as typeof fetch,
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
    fetch: fetchMock as unknown as typeof fetch,
    dryRun: false,
  });
  expect(result.retryAfterSeconds).toBe(7);
  expect(j.pendingCount()).toBe(1);
});

test("500 marks failed but not fatal", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () =>
    new Response(JSON.stringify({ error: "upstream" }), { status: 500 });
  const result = await flushOnce(j, {
    endpoint: "https://ingest.test",
    token: "dm_x",
    fetch: fetchMock as unknown as typeof fetch,
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
    fetch: fetchMock as unknown as typeof fetch,
    dryRun: true,
  });
  expect(calls.length).toBe(0);
  expect(result.submitted).toBe(0);
  expect(j.pendingCount()).toBe(1);
});
