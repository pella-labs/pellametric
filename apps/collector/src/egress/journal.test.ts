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
