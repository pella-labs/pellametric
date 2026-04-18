import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { loadConfig } from "./config";
import { EgressLog } from "./egress/egressLog";
import { Journal } from "./egress/journal";
import { migrate } from "./egress/migrations";
import { startLoop } from "./loop";

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bematist-loop-"));
  db = new Database(join(dir, "loop.sqlite"));
  db.exec("PRAGMA journal_mode=DELETE");
  migrate(db);
});

afterEach(async () => {
  try {
    db.exec("PRAGMA journal_mode=DELETE");
  } catch {}
  db.close();
  Bun.sleepSync(50);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

function mkEvent(adapter: string, seq: number): Event {
  const hex = seq.toString(16).padStart(12, "0");
  return {
    client_event_id: `00000000-0000-0000-0000-${hex}`,
    schema_version: 1,
    ts: "2026-04-18T14:00:00.000Z",
    tenant_id: "org_acme",
    engineer_id: "eng_x",
    device_id: "dev_y",
    source: "claude-code",
    fidelity: "full",
    tier: "B",
    session_id: `s_${adapter}`,
    event_seq: seq,
    dev_metrics: { event_kind: "session_start" },
    cost_estimated: false,
  } as Event;
}

/**
 * Test adapter — returns events from a queue on each poll(). This lets us
 * simulate "new events arriving" deterministically, and verify cursor resume
 * after restart by wiring the adapter to skip events it already emitted.
 */
function mkScriptedAdapter(id: string, scriptedRuns: Event[][]): Adapter {
  let callIdx = 0;
  return {
    id,
    label: id,
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init(_ctx: AdapterContext) {},
    async poll(ctx: AdapterContext, _signal: AbortSignal) {
      const emitted = scriptedRuns[callIdx] ?? [];
      callIdx += 1;
      // Record the "cursor" so a restart knows where we left off.
      if (emitted.length > 0) {
        await ctx.cursor.set("max_seq", String(emitted[emitted.length - 1]?.event_seq ?? 0));
      }
      return emitted;
    },
    async health() {
      return { status: "ok" as const, fidelity: "full" as const };
    },
  };
}

test("loop emits events, POSTs to ingest, updates journal", async () => {
  const journal = new Journal(db);
  const egressLog = new EgressLog(dir);
  const adapter = mkScriptedAdapter("test-a", [[mkEvent("a", 1), mkEvent("a", 2)], [], []]);

  const seen: Array<{ events: Event[] }> = [];
  const fetchMock = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push(body);
    return new Response(JSON.stringify({ accepted: body.events?.length ?? 0 }), {
      status: 202,
    });
  };

  const handle = startLoop({
    db,
    journal,
    egressLog,
    config: loadConfig({
      endpoint: "http://ingest.test",
      token: "bm_test",
      dataDir: dir,
      dryRun: false,
      batchSize: 10,
      pollIntervalMs: 50,
      flushIntervalMs: 50,
    }),
    fetchImpl: fetchMock as unknown as typeof fetch,
    registry: [adapter],
  });

  // Give the loop enough ticks to poll + flush at least once.
  await new Promise((r) => setTimeout(r, 400));
  await handle.stop();

  expect(seen.length).toBeGreaterThanOrEqual(1);
  const allSent = seen.flatMap((b) => b.events);
  expect(allSent.length).toBe(2);
  expect(journal.pendingCount()).toBe(0);
});

test("loop survives ingest outage: queues events, flushes on recovery", async () => {
  const journal = new Journal(db);
  const egressLog = new EgressLog(dir);
  const adapter = mkScriptedAdapter("test-b", [
    [mkEvent("b", 1), mkEvent("b", 2), mkEvent("b", 3)],
    [],
  ]);

  let ingestUp = false;
  const fetchMock = async (_url: string, init?: RequestInit) => {
    if (!ingestUp) return new Response(null, { status: 503 });
    const body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ accepted: body.events?.length ?? 0 }), { status: 202 });
  };

  const handle = startLoop({
    db,
    journal,
    egressLog,
    config: loadConfig({
      endpoint: "http://ingest.test",
      token: "bm_test",
      dataDir: dir,
      dryRun: false,
      batchSize: 10,
      pollIntervalMs: 50,
      flushIntervalMs: 50,
      // Keep retries cheap so the test wraps up promptly.
    }),
    fetchImpl: fetchMock as unknown as typeof fetch,
    registry: [adapter],
  });

  // Let it poll & fail a few times.
  await new Promise((r) => setTimeout(r, 250));
  expect(journal.pendingCount()).toBe(3);

  // Bring ingest back up.
  ingestUp = true;
  await new Promise((r) => setTimeout(r, 600));
  await handle.stop();

  expect(journal.pendingCount()).toBe(0);
});

test("restart resumes from cursor (no duplicate emissions)", async () => {
  const journal = new Journal(db);
  const egressLog = new EgressLog(dir);

  const fetchMock = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ accepted: body.events?.length ?? 0 }), { status: 202 });
  };

  // First run: emit events 1, 2. Second run (simulated restart): adapter
  // reads its cursor and refuses to re-emit already-emitted events.
  let maxSeqSeenOnDisk = 0;
  const makeAdapter = (): Adapter => {
    let _maxSeqEmitted = 0;
    return {
      id: "cursor-test",
      label: "cursor-test",
      version: "0.0.0",
      supportedSourceVersions: "*",
      async init(ctx: AdapterContext) {
        const s = await ctx.cursor.get("max_seq");
        _maxSeqEmitted = s ? Number.parseInt(s, 10) : 0;
      },
      async poll(ctx: AdapterContext, _sig: AbortSignal) {
        const candidates = [mkEvent("c", 1), mkEvent("c", 2), mkEvent("c", 3)];
        const fresh = candidates.filter((e) => e.event_seq > _maxSeqEmitted);
        if (fresh.length > 0) {
          _maxSeqEmitted = fresh[fresh.length - 1]?.event_seq ?? _maxSeqEmitted;
          await ctx.cursor.set("max_seq", String(_maxSeqEmitted));
          maxSeqSeenOnDisk = _maxSeqEmitted;
        }
        return fresh;
      },
      async health() {
        return { status: "ok" as const, fidelity: "full" as const };
      },
    };
  };

  // First run
  const first = startLoop({
    db,
    journal,
    egressLog,
    config: loadConfig({
      endpoint: "http://ingest.test",
      token: "bm_test",
      dataDir: dir,
      dryRun: false,
      batchSize: 10,
      pollIntervalMs: 30,
      flushIntervalMs: 30,
    }),
    fetchImpl: fetchMock as unknown as typeof fetch,
    registry: [makeAdapter()],
  });
  await new Promise((r) => setTimeout(r, 200));
  await first.stop();

  expect(maxSeqSeenOnDisk).toBe(3);
  expect(journal.pendingCount()).toBe(0);

  // Second run — simulate restart using the same SQLite DB (cursors persist).
  const emitted: number[] = [];
  const wrappingAdapter = makeAdapter();
  const originalPoll = wrappingAdapter.poll.bind(wrappingAdapter);
  wrappingAdapter.poll = async (ctx, sig) => {
    const result = await originalPoll(ctx, sig);
    for (const e of result) emitted.push(e.event_seq);
    return result;
  };

  const second = startLoop({
    db,
    journal,
    egressLog,
    config: loadConfig({
      endpoint: "http://ingest.test",
      token: "bm_test",
      dataDir: dir,
      dryRun: false,
      batchSize: 10,
      pollIntervalMs: 30,
      flushIntervalMs: 30,
    }),
    fetchImpl: fetchMock as unknown as typeof fetch,
    registry: [wrappingAdapter],
  });
  await new Promise((r) => setTimeout(r, 200));
  await second.stop();

  // Second run MUST NOT re-emit events 1..3.
  expect(emitted.length).toBe(0);
});

test("graceful stop drains in-flight flush", async () => {
  const journal = new Journal(db);
  const egressLog = new EgressLog(dir);
  const adapter = mkScriptedAdapter("drain", [[mkEvent("d", 1), mkEvent("d", 2)]]);

  const fetchMock = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ accepted: body.events?.length ?? 0 }), { status: 202 });
  };

  const handle = startLoop({
    db,
    journal,
    egressLog,
    config: loadConfig({
      endpoint: "http://ingest.test",
      token: "bm_test",
      dataDir: dir,
      dryRun: false,
      batchSize: 10,
      pollIntervalMs: 30,
      flushIntervalMs: 30,
    }),
    fetchImpl: fetchMock as unknown as typeof fetch,
    registry: [adapter],
  });

  // Just enough time to poll & enqueue once.
  await new Promise((r) => setTimeout(r, 100));
  await handle.stop();
  // After stop, the shutdown flush should have drained the journal.
  expect(journal.pendingCount()).toBe(0);
});
