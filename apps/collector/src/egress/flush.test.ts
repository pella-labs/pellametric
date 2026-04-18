import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EgressLog } from "./egressLog";
import { flushBatch } from "./flush";
import { Journal } from "./journal";
import { migrate } from "./migrations";

let dir: string;
let db: Database;
let j: Journal;
let egress: EgressLog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-flush-"));
  db = new Database(join(dir, "w.sqlite"));
  db.exec("PRAGMA journal_mode=DELETE");
  migrate(db);
  j = new Journal(db);
  egress = new EgressLog(dir);
});

afterEach(() => {
  try {
    db.exec("PRAGMA journal_mode=DELETE");
  } catch {}
  db.close();
  Bun.sleepSync(25);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const ev = (n: number) => ({
  client_event_id: `00000000-0000-0000-0000-00000000000${n}`,
  schema_version: 1,
  ts: "2026-04-18T14:00:00.000Z",
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

test("202 marks all submitted + writes one egress-log line", async () => {
  j.enqueue(ev(0));
  j.enqueue(ev(1));
  const fetchMock = async () => new Response(JSON.stringify({ accepted: 2 }), { status: 202 });
  const result = await flushBatch(j, egress, {
    endpoint: "http://h.test",
    token: "bm_x",
    fetchImpl: fetchMock as unknown as typeof fetch,
    dryRun: false,
    batchSize: 10,
    ingestOnlyTo: null,
  });
  expect(result.submitted).toBe(2);
  expect(j.pendingCount()).toBe(0);
  expect(egress.count()).toBe(1);
  const tail = egress.tail(1);
  expect(tail[0]?.eventCount).toBe(2);
  expect(tail[0]?.dryRun).toBe(false);
});

test("dry-run writes egress log but sends nothing", async () => {
  j.enqueue(ev(0));
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };
  const result = await flushBatch(j, egress, {
    endpoint: "http://h.test",
    token: "bm_x",
    fetchImpl: fetchMock as unknown as typeof fetch,
    dryRun: true,
    batchSize: 10,
    ingestOnlyTo: null,
  });
  expect(calls).toBe(0);
  expect(result.note).toBe("dry-run");
  expect(egress.count()).toBe(1);
  expect(egress.tail(1)[0]?.dryRun).toBe(true);
  // rows stay pending
  expect(j.pendingCount()).toBe(1);
});

test("401 returns fatal + halts", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () => new Response(null, { status: 401 });
  const result = await flushBatch(j, egress, {
    endpoint: "http://h.test",
    token: "bm_bad",
    fetchImpl: fetchMock as unknown as typeof fetch,
    dryRun: false,
    batchSize: 10,
    ingestOnlyTo: null,
  });
  expect(result.fatal).toBe(true);
});

test("transient 503 recovers on retry", async () => {
  j.enqueue(ev(0));
  let calls = 0;
  const fetchMock = async () => {
    calls += 1;
    if (calls < 3) return new Response(null, { status: 503 });
    return new Response(JSON.stringify({ accepted: 1 }), { status: 202 });
  };
  const result = await flushBatch(j, egress, {
    endpoint: "http://h.test",
    token: "bm_x",
    fetchImpl: fetchMock as unknown as typeof fetch,
    dryRun: false,
    batchSize: 10,
    ingestOnlyTo: null,
  });
  expect(calls).toBe(3);
  expect(result.submitted).toBe(1);
  expect(j.pendingCount()).toBe(0);
});

test("network error keeps rows pending", async () => {
  j.enqueue(ev(0));
  const fetchMock = async () => {
    throw new Error("ECONNREFUSED");
  };
  const result = await flushBatch(j, egress, {
    endpoint: "http://h.test",
    token: "bm_x",
    fetchImpl: fetchMock as unknown as typeof fetch,
    dryRun: false,
    batchSize: 10,
    ingestOnlyTo: null,
  });
  expect(result.note).toContain("network");
  expect(j.pendingCount()).toBe(1);
}, 15000);

test("207 partial splits by index", async () => {
  j.enqueue(ev(0));
  j.enqueue(ev(1));
  const fetchMock = async () =>
    new Response(
      JSON.stringify({
        accepted: 1,
        rejected: [{ index: 1, reason: "bad" }],
      }),
      { status: 207 },
    );
  const result = await flushBatch(j, egress, {
    endpoint: "http://h.test",
    token: "bm_x",
    fetchImpl: fetchMock as unknown as typeof fetch,
    dryRun: false,
    batchSize: 10,
    ingestOnlyTo: null,
  });
  expect(result.submitted).toBe(1);
  expect(result.failed).toBe(1);
  expect(j.pendingCount()).toBe(1);
});

test("empty pending is a no-op; no egress log entry", async () => {
  const result = await flushBatch(j, egress, {
    endpoint: "http://h.test",
    token: "bm_x",
    fetchImpl: (async () => new Response()) as unknown as typeof fetch,
    dryRun: false,
    batchSize: 10,
    ingestOnlyTo: null,
  });
  expect(result.submitted).toBe(0);
  expect(egress.count()).toBe(0);
});
