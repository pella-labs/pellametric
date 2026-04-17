import { describe, expect, test } from "bun:test";
import {
  createInMemoryClickHouseWriter,
  createLazyClickHouseWriter,
  defaultClickHouseConfig,
} from "./clickhouse";

async function captureReject(p: Promise<unknown>): Promise<Error | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as Error;
  }
}

describe("defaultClickHouseConfig", () => {
  test("keep_alive_idle_socket_ttl_ms === 2000 (F15/INT0 mitigation)", () => {
    expect(defaultClickHouseConfig.keep_alive_idle_socket_ttl_ms).toBe(2000);
  });

  test("table defaults to 'events' and database to 'bematist'", () => {
    expect(defaultClickHouseConfig.table).toBe("events");
    expect(defaultClickHouseConfig.database).toBe("bematist");
  });
});

describe("createLazyClickHouseWriter", () => {
  test("insert throws clickhouse:client-not-installed when importer rejects with MODULE_NOT_FOUND", async () => {
    const absentImporter = async () => {
      const err = new Error("Cannot find module '@clickhouse/client'");
      (err as unknown as { code: string }).code = "MODULE_NOT_FOUND";
      throw err;
    };
    const w = createLazyClickHouseWriter(defaultClickHouseConfig, absentImporter);
    const err = await captureReject(w.insert([{ any: 1 }]));
    expect(err?.message).toBe("clickhouse:client-not-installed");
  });

  test("insert throws clickhouse:client-not-installed when module has no createClient", async () => {
    const badImporter = async () => ({ notCreateClient: () => ({}) });
    const w = createLazyClickHouseWriter(defaultClickHouseConfig, badImporter);
    const err = await captureReject(w.insert([{ any: 1 }]));
    expect(err?.message).toBe("clickhouse:client-not-installed");
  });

  test("insert forwards through to the lazily-built client on success", async () => {
    const inserts: unknown[] = [];
    const fakeClient = {
      insert(args: unknown) {
        inserts.push(args);
        return Promise.resolve({ executed: true });
      },
    };
    const goodImporter = async () => ({ createClient: () => fakeClient });
    const w = createLazyClickHouseWriter(defaultClickHouseConfig, goodImporter);
    const r = await w.insert([{ a: 1 }]);
    expect(r).toEqual({ ok: true });
    expect(inserts.length).toBe(1);
    expect((inserts[0] as { format: string }).format).toBe("JSONEachRow");
    expect((inserts[0] as { table: string }).table).toBe("events");
  });
});

describe("createInMemoryClickHouseWriter", () => {
  test("stores rows on insert", async () => {
    const w = createInMemoryClickHouseWriter();
    await w.insert([{ a: 1 }, { a: 2 }]);
    expect(w.rows()).toEqual([{ a: 1 }, { a: 2 }]);
    expect(w.insertCallCount()).toBe(1);
  });

  test("setPingResult toggles ping()", async () => {
    const w = createInMemoryClickHouseWriter();
    expect(await w.ping()).toBe(true);
    w.setPingResult(false);
    expect(await w.ping()).toBe(false);
  });

  test("setInsertBehavior=throw-500 → insert throws", async () => {
    const w = createInMemoryClickHouseWriter();
    w.setInsertBehavior("throw-500");
    const err = await captureReject(w.insert([{ a: 1 }]));
    expect(err?.message).toBe("clickhouse:500");
  });

  test("lastInsertArgs exposes the JSONEachRow table/values/format", async () => {
    const w = createInMemoryClickHouseWriter();
    await w.insert([{ a: 1 }]);
    const args = w.lastInsertArgs();
    expect(args?.table).toBe("events");
    expect(args?.format).toBe("JSONEachRow");
    expect(args?.values).toEqual([{ a: 1 }]);
  });
});
