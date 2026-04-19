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
  cost_estimated: false,
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

// --- Dead-letter / cooling state tests (bugs #1/#15/#16) ---

test("markFailed with permanent=true moves to dead_letter immediately", () => {
  j.enqueue(sampleEvent);
  j.markFailed([sampleEvent.client_event_id], "400 schema", { permanent: true });
  expect(j.pendingCount()).toBe(0);
  expect(j.deadLetterCount()).toBe(1);
  // Poison pill no longer blocks the queue.
  expect(j.selectPending(10).length).toBe(0);
});

test("markFailed with retryAfterMs sets state=cooling and next_attempt_at", () => {
  j.enqueue(sampleEvent);
  j.markFailed([sampleEvent.client_event_id], "500", { retryAfterMs: 60_000 });
  const row = j.tail(1)[0];
  expect(row?.state).toBe("cooling");
  expect(row?.next_attempt_at).toBeTruthy();
  // Not reselectable yet (window hasn't elapsed).
  expect(j.selectPending(10).length).toBe(0);
  expect(j.pendingCount()).toBe(0);
});

test("cooling row becomes reselectable after next_attempt_at elapses", () => {
  j.enqueue(sampleEvent);
  j.markFailed([sampleEvent.client_event_id], "500", { retryAfterMs: 1 });
  Bun.sleepSync(25);
  expect(j.selectPending(10).length).toBe(1);
  expect(j.pendingCount()).toBe(1);
});

test("retry_count cap → forced dead_letter at MAX_RETRIES", () => {
  j.enqueue(sampleEvent);
  // Call markFailed until the cap is hit. Each call uses retryAfterMs=0 so
  // the row alternates cooling -> pending quickly, accumulating retry_count.
  const MAX = 12;
  for (let i = 0; i < MAX; i++) {
    j.markFailed([sampleEvent.client_event_id], `try ${i}`, { retryAfterMs: 0 });
  }
  expect(j.deadLetterCount()).toBe(1);
  expect(j.pendingCount()).toBe(0);
  const row = j.tail(1)[0];
  expect(row?.state).toBe("dead_letter");
  expect(row?.retry_count).toBe(12);
});

test("deadLetterCount + tailDeadLetter surface dead rows", () => {
  for (let i = 0; i < 3; i++) {
    j.enqueue({
      ...sampleEvent,
      client_event_id: `00000000-0000-0000-0000-00000000000${i}`,
      event_seq: i,
    });
    j.markFailed([`00000000-0000-0000-0000-00000000000${i}`], `bad ${i}`, { permanent: true });
  }
  expect(j.deadLetterCount()).toBe(3);
  const dl = j.tailDeadLetter(2);
  expect(dl.length).toBe(2);
  for (const r of dl) expect(r.state).toBe("dead_letter");
});

test("prune drops old submitted + dead_letter rows at configured thresholds", () => {
  j.enqueue({ ...sampleEvent, client_event_id: "00000000-0000-0000-0000-000000000001" });
  j.enqueue({ ...sampleEvent, client_event_id: "00000000-0000-0000-0000-000000000002" });
  j.enqueue({ ...sampleEvent, client_event_id: "00000000-0000-0000-0000-000000000003" });
  j.markSubmitted(["00000000-0000-0000-0000-000000000001"]);
  j.markFailed(["00000000-0000-0000-0000-000000000002"], "bad", { permanent: true });

  const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const hundredDaysAgo = new Date(Date.now() - 100 * 86_400_000).toISOString();
  db.run("UPDATE events SET submitted_at = ? WHERE client_event_id = ?", [
    twentyDaysAgo,
    "00000000-0000-0000-0000-000000000001",
  ]);
  db.run("UPDATE events SET enqueued_at = ? WHERE client_event_id = ?", [
    hundredDaysAgo,
    "00000000-0000-0000-0000-000000000002",
  ]);

  const result = j.prune({ submittedRetentionDays: 14, deadLetterRetentionDays: 90 });
  expect(result.submittedDeleted).toBe(1);
  expect(result.deadLetterDeleted).toBe(1);
  expect(j.pendingCount()).toBe(1);
});

test("prune keeps rows newer than retention window", () => {
  j.enqueue(sampleEvent);
  j.markSubmitted([sampleEvent.client_event_id]);
  const result = j.prune({ submittedRetentionDays: 14, deadLetterRetentionDays: 90 });
  expect(result.submittedDeleted).toBe(0);
});
