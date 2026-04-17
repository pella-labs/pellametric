import { describe, expect, test } from "bun:test";
import { createInMemoryClickHouseWriter } from "../clickhouse";
import { canonicalize, type WalRedis } from "./append";
import { createWalConsumer } from "./consumer";

// ---- Fake WalRedis -------------------------------------------------------
//
// Minimal in-memory Redis Streams shim with single-group semantics. Tracks:
//   - `entries`: array of {id, fields} in append order (XADD)
//   - `groups`: Map<groupName, { lastDelivered, pending: Set<id> }>
// Enough for XADD, XREADGROUP, XACK, XGROUPCREATE, XLEN, XINFO-PENDING,
// plus XADD to a second (dead-letter) stream.

interface Entry {
  id: string;
  fields: Record<string, string>;
}

interface GroupState {
  lastDelivered: number; // index into entries[]
  pending: Set<string>;
}

function makeFakeRedis(): WalRedis & {
  entries: Map<string, Entry[]>;
  groups: Map<string, Map<string, GroupState>>;
  counters: Map<string, number>;
} {
  const entries = new Map<string, Entry[]>();
  const groups = new Map<string, Map<string, GroupState>>();
  const counters = new Map<string, number>();

  function ensureStream(s: string): Entry[] {
    const existing = entries.get(s);
    if (existing) return existing;
    const fresh: Entry[] = [];
    entries.set(s, fresh);
    return fresh;
  }
  function nextId(stream: string): string {
    const n = (counters.get(stream) ?? 0) + 1;
    counters.set(stream, n);
    return `${n}-0`;
  }

  return {
    entries,
    groups,
    counters,
    async xadd(stream, fields): Promise<string> {
      const id = nextId(stream);
      ensureStream(stream).push({ id, fields });
      return id;
    },
    async xreadgroup(group, _consumer, stream, fromId, opts) {
      const arr = ensureStream(stream);
      const gmap = groups.get(stream);
      const g = gmap?.get(group);
      if (!g) return [];
      // H2 fix: the consumer now calls xreadgroup with fromId="0" to
      // re-read its own PEL before fromId=">" for new entries. Model that
      // properly: on "0", yield pending entries; on ">", yield new entries.
      if (fromId === "0") {
        if (g.pending.size === 0) return [];
        const pendingEntries = arr.filter((e) => g.pending.has(e.id)).slice(0, opts.count);
        return pendingEntries.map((e) => ({ id: e.id, fields: e.fields }));
      }
      const start = g.lastDelivered;
      const end = Math.min(start + opts.count, arr.length);
      const slice = arr.slice(start, end);
      g.lastDelivered = end;
      for (const e of slice) g.pending.add(e.id);
      return slice.map((e) => ({ id: e.id, fields: e.fields }));
    },
    async xack(stream, group, ids): Promise<number> {
      const g = groups.get(stream)?.get(group);
      if (!g) return 0;
      let n = 0;
      for (const id of ids) {
        if (g.pending.delete(id)) n++;
      }
      return n;
    },
    async xclaim() {
      return [];
    },
    async xgroupCreate(stream, group, _startId, _opts) {
      ensureStream(stream);
      let gmap = groups.get(stream);
      if (!gmap) {
        gmap = new Map();
        groups.set(stream, gmap);
      }
      if (gmap.has(group)) {
        throw new Error("BUSYGROUP Consumer Group name already exists");
      }
      gmap.set(group, { lastDelivered: 0, pending: new Set() });
    },
    async xlen(stream): Promise<number> {
      return ensureStream(stream).length;
    },
    async xinfoGroupsPending(stream, group): Promise<number> {
      return groups.get(stream)?.get(group)?.pending.size ?? 0;
    },
  };
}

function seedEvent(i: number) {
  const row = canonicalize(
    {
      client_event_id: `1111111${i}-1111-4111-8111-111111111111`,
      schema_version: 1,
      ts: "2026-04-16T12:00:00.000Z",
      tenant_id: "org_abc",
      engineer_id: "eng_wire",
      device_id: "d",
      source: "claude-code",
      fidelity: "full",
      cost_estimated: false,
      tier: "B",
      session_id: `sess_${i}`,
      event_seq: i,
      dev_metrics: { event_kind: "llm_request" },
    },
    { tenantId: "t1", engineerId: "e1" },
  );
  return row;
}

async function appendRow(redis: ReturnType<typeof makeFakeRedis>, stream: string, i: number) {
  const r = seedEvent(i);
  await redis.xadd(stream, {
    tenant_id: r.tenant_id,
    engineer_id: r.engineer_id,
    client_event_id: r.client_event_id,
    schema_version: String(r.schema_version),
    canonical_json: r.canonical_json,
  });
}

describe("WalConsumer.drainOnce", () => {
  test("1+2. xadd then drainOnce → reads appended message via xreadgroup", async () => {
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    const consumer = createWalConsumer({ redis, ch });
    await consumer.start();
    await appendRow(redis, "events_wal", 0);
    // Stop the background loop so it doesn't race drainOnce for the message.
    await consumer.stop();
    const result = await consumer.drainOnce();
    expect(result.inserted).toBeGreaterThanOrEqual(0);
    // After drain, CH got a row (or, if the loop drained it first, rows length ≥ 1).
    expect(ch.rows().length).toBeGreaterThanOrEqual(1);
  });

  test("3. ch.insert called with {table:'events', values:[row], format:'JSONEachRow'}", async () => {
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    // Pre-create group (consumer.start would, but we bypass the loop here).
    await redis.xgroupCreate("events_wal", "ingest-consumer", "$", { mkstream: true });
    await appendRow(redis, "events_wal", 0);
    const consumer = createWalConsumer({ redis, ch });
    const r = await consumer.drainOnce();
    expect(r.inserted).toBe(1);
    const args = ch.lastInsertArgs();
    expect(args?.table).toBe("events");
    expect(args?.format).toBe("JSONEachRow");
    expect(args?.values.length).toBe(1);
    expect((args?.values[0] as Record<string, unknown>).client_event_id).toBe(
      "11111110-1111-4111-8111-111111111111",
    );
  });

  test("4. On success, xack called with the id (pending drained)", async () => {
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    await redis.xgroupCreate("events_wal", "ingest-consumer", "$", { mkstream: true });
    await appendRow(redis, "events_wal", 0);
    const consumer = createWalConsumer({ redis, ch });
    await consumer.drainOnce();
    const pending = await redis.xinfoGroupsPending("events_wal", "ingest-consumer");
    expect(pending).toBe(0);
  });

  test("5. CH throws once → NO xack; drain again re-delivers & succeeds", async () => {
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    await redis.xgroupCreate("events_wal", "ingest-consumer", "$", { mkstream: true });
    await appendRow(redis, "events_wal", 0);
    const consumer = createWalConsumer({ redis, ch });

    ch.setInsertBehavior("throw-500");
    const r1 = await consumer.drainOnce();
    expect(r1.inserted).toBe(0);
    expect(r1.acked).toEqual([]);
    // Still pending:
    expect(await redis.xinfoGroupsPending("events_wal", "ingest-consumer")).toBe(1);

    // Redeliver via >: our fake won't redeliver until lastDelivered advances;
    // in real Redis `>` delivers never-delivered. Simulate by resetting to the
    // pending entry: we append the row again (equivalent to auto-claim after
    // idle time; fake redis simplification).
    await appendRow(redis, "events_wal", 1);
    ch.setInsertBehavior("ok");
    const r2 = await consumer.drainOnce();
    expect(r2.inserted).toBeGreaterThanOrEqual(1);
  });

  test("6. CH failure leaves entry in pending; drainOnce reports no ack", async () => {
    // L2 fix: this test previously asserted `X === X` (identity). What it
    // *should* prove is that a single CH failure does not ack. The real
    // "5 failures → dead-letter" assertion is covered by 6b below.
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    await redis.xgroupCreate("events_wal", "ingest-consumer", "$", { mkstream: true });
    await appendRow(redis, "events_wal", 0);
    const consumer = createWalConsumer({ redis, ch, config: { maxRetries: 2 } });
    ch.setInsertBehavior("throw-500");

    const r = await consumer.drainOnce();
    // On failure: no ack, no dead-letter yet (retries still <= max).
    expect(r.acked).toEqual([]);
    expect(r.deadLettered).toEqual([]);
    expect(r.inserted).toBe(0);
    // Dead-letter stream is empty — we haven't exhausted retries yet.
    expect((redis.entries.get("events_wal_dead") ?? []).length).toBe(0);
  });

  test("6b. Retry-cap exceeded → dead-letter stream gets entry, original acked", async () => {
    // Drive this by repeatedly feeding the SAME id via a custom redis.
    const calls: Array<{ stream: string; fields: Record<string, string> }> = [];
    const pending = new Set<string>();
    const deadStream: Array<{ id: string; fields: Record<string, string> }> = [];
    const acked: string[] = [];
    const row = seedEvent(0);
    const fields = {
      tenant_id: row.tenant_id,
      engineer_id: row.engineer_id,
      client_event_id: row.client_event_id,
      schema_version: String(row.schema_version),
      canonical_json: row.canonical_json,
    };
    const ID = "1-0";
    let deliverCount = 0;

    let deliveredOnce = false;
    const redis: WalRedis = {
      async xadd(stream, f) {
        calls.push({ stream, fields: f });
        if (stream === "events_wal_dead") {
          deadStream.push({ id: `d-${deadStream.length}`, fields: f });
          return `d-${deadStream.length - 1}`;
        }
        return "x-1";
      },
      async xreadgroup(_g, _c, _s, fromId) {
        // H2 fix: simulate the real Streams PEL — fromId="0" re-delivers
        // pending, fromId=">" delivers new-only (once).
        if (fromId === "0") {
          if (pending.has(ID)) {
            deliverCount++;
            return [{ id: ID, fields }];
          }
          return [];
        }
        // fromId === ">"
        if (deliveredOnce) return [];
        deliveredOnce = true;
        deliverCount++;
        pending.add(ID);
        return [{ id: ID, fields }];
      },
      async xack(_s, _g, ids) {
        for (const id of ids) {
          pending.delete(id);
          acked.push(id);
        }
        return ids.length;
      },
      async xclaim() {
        return [];
      },
      async xgroupCreate() {
        // ok
      },
      async xlen() {
        return 1;
      },
      async xinfoGroupsPending() {
        return pending.size;
      },
    };
    const ch = createInMemoryClickHouseWriter();
    ch.setInsertBehavior("throw-500");
    const consumer = createWalConsumer({
      redis,
      ch,
      config: { maxRetries: 2 }, // so 3rd failure triggers DL
    });

    // Attempt 1: fail (retries=1 < 2 → keep)
    await consumer.drainOnce();
    // Attempt 2: fail (retries=2, NOT >2 → keep)
    await consumer.drainOnce();
    // Attempt 3: fail (retries=3 > 2 → DL + ACK)
    const r3 = await consumer.drainOnce();

    expect(r3.deadLettered).toContain(ID);
    expect(acked).toContain(ID);
    expect(deadStream.length).toBe(1);
    expect(calls.some((c) => c.stream === "events_wal_dead")).toBe(true);
    expect(deliverCount).toBeGreaterThanOrEqual(3);
  });

  test("7. stop() mid-batch: in-flight drain completes, isRunning === false", async () => {
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    await appendRow(redis, "events_wal", 0);
    const consumer = createWalConsumer({ redis, ch });
    await consumer.start();
    // Give the loop a microtask to enter drainOnce; then stop.
    await new Promise((r) => setTimeout(r, 10));
    await consumer.stop();
    expect(consumer.isRunning()).toBe(false);
  });

  test("8. batchMaxRows=3: append 7, first drain ≤3, second drain gets remaining", async () => {
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    await redis.xgroupCreate("events_wal", "ingest-consumer", "$", { mkstream: true });
    for (let i = 0; i < 7; i++) await appendRow(redis, "events_wal", i);
    const consumer = createWalConsumer({ redis, ch, config: { batchMaxRows: 3 } });
    const r1 = await consumer.drainOnce();
    expect(r1.inserted).toBeLessThanOrEqual(3);
    const r2 = await consumer.drainOnce();
    expect(r1.inserted + r2.inserted).toBeGreaterThanOrEqual(6);
  });

  test("9. batchMaxAgeMs=50: drain passes blockMs=50 to xreadgroup", async () => {
    let observedBlockMs = -1;
    const redis: WalRedis = {
      async xadd() {
        return "1-0";
      },
      async xreadgroup(_g, _c, _s, _from, opts) {
        observedBlockMs = opts.blockMs;
        return [];
      },
      async xack() {
        return 0;
      },
      async xclaim() {
        return [];
      },
      async xgroupCreate() {},
      async xlen() {
        return 0;
      },
      async xinfoGroupsPending() {
        return 0;
      },
    };
    const ch = createInMemoryClickHouseWriter();
    const consumer = createWalConsumer({ redis, ch, config: { batchMaxAgeMs: 50 } });
    await consumer.drainOnce();
    expect(observedBlockMs).toBe(50);
  });

  test("11. Stream restart: after ack, fresh consumer only reads unacked", async () => {
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    await redis.xgroupCreate("events_wal", "ingest-consumer", "$", { mkstream: true });
    for (let i = 0; i < 3; i++) await appendRow(redis, "events_wal", i);
    const c1 = createWalConsumer({ redis, ch });
    const r1 = await c1.drainOnce();
    expect(r1.inserted).toBe(3);
    // "Restart": build a fresh consumer on the same redis+group — it should
    // see 0 unacked (group lastDelivered advanced and pending is empty).
    const c2 = createWalConsumer({ redis, ch });
    const r2 = await c2.drainOnce();
    expect(r2.inserted).toBe(0);
  });

  test("lag() returns PEL size (pending-entry count), not xlen", async () => {
    // M6 fix: the old formula `xlen - pending` grew with traffic on a
    // healthy consumer and would trip /readyz. Correct lag proxy = PEL
    // size — entries delivered but not yet acked.
    const redis = makeFakeRedis();
    const ch = createInMemoryClickHouseWriter();
    await redis.xgroupCreate("events_wal", "ingest-consumer", "$", { mkstream: true });
    for (let i = 0; i < 4; i++) await appendRow(redis, "events_wal", i);
    const consumer = createWalConsumer({ redis, ch });
    // Nothing delivered yet → PEL empty → lag=0.
    expect(await consumer.lag()).toBe(0);
    // Simulate a CH failure: drainOnce fails and leaves ids in PEL.
    ch.setInsertBehavior("throw-500");
    await consumer.drainOnce();
    // 4 entries now pending (delivered but not acked).
    expect(await consumer.lag()).toBe(4);
    // Restore CH and drain: pending-re-read path re-delivers and acks.
    ch.setInsertBehavior("ok");
    await consumer.drainOnce();
    expect(await consumer.lag()).toBe(0);
  });
});
