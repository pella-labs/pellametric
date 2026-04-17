import { describe, expect, test } from "bun:test";
import type { Event } from "@bematist/schema";
import {
  type CanonicalRow,
  canonicalize,
  createInMemoryWalAppender,
  createRedisStreamsWalAppender,
  type WalRedis,
} from "./append";

const CH_COLUMNS = [
  "client_event_id",
  "schema_version",
  "ts",
  "org_id",
  "engineer_id",
  "device_id",
  "source",
  "source_version",
  "fidelity",
  "cost_estimated",
  "tier",
  "session_id",
  "event_seq",
  "parent_session_id",
  "gen_ai_system",
  "gen_ai_request_model",
  "gen_ai_response_model",
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
  "event_kind",
  "cost_usd",
  "pricing_version",
  "duration_ms",
  "tool_name",
  "tool_status",
  "hunk_sha256",
  "file_path_hash",
  "edit_decision",
  "revert_within_24h",
  "first_try_failure",
  "prompt_text",
  "tool_input",
  "tool_output",
  "prompt_abstract",
  "prompt_embedding",
  "prompt_index",
  "redaction_count",
  "pr_number",
  "commit_sha",
  "branch",
  "raw_attrs",
];

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    client_event_id: "11111111-1111-4111-8111-111111111111",
    schema_version: 1,
    ts: "2026-04-16T12:00:00.000Z",
    tenant_id: "org_abc",
    engineer_id: "eng_wire",
    device_id: "device_1",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier: "B",
    session_id: "sess_xyz",
    event_seq: 0,
    dev_metrics: { event_kind: "llm_request" },
    ...overrides,
  };
}

describe("canonicalize", () => {
  test("produces a row with every CH column key; unset optionals default cleanly", () => {
    const ev = makeEvent();
    const r = canonicalize(ev, { tenantId: "t1", engineerId: "e1" });
    for (const col of CH_COLUMNS) {
      expect(Object.hasOwn(r.row, col)).toBe(true);
    }
    // Server-derived identity overrides wire values.
    expect(r.row.org_id).toBe("t1");
    expect(r.row.engineer_id).toBe("e1");
    // Safe defaults:
    expect(r.row.source_version).toBe("");
    expect(r.row.parent_session_id).toBe(null);
    expect(r.row.input_tokens).toBe(0);
    expect(r.row.cost_usd).toBe(0);
    expect(r.row.prompt_text).toBe(null);
    expect(r.row.prompt_embedding).toEqual([]);
    expect(r.row.raw_attrs).toBe("");
    // Boolean → 0/1 encoding for ClickHouse UInt8.
    expect(r.row.cost_estimated).toBe(0);
  });

  test("deterministic: same Event twice → same canonical_json byte-for-byte", () => {
    const ev = makeEvent({
      gen_ai: { system: "anthropic", usage: { input_tokens: 12 } },
      raw_attrs: { z: 1, a: 2 }, // keys must serialize in sorted order
    });
    const r1 = canonicalize(ev, { tenantId: "t1", engineerId: "e1" });
    const r2 = canonicalize(ev, { tenantId: "t1", engineerId: "e1" });
    expect(r1.canonical_json).toBe(r2.canonical_json);
    // Keys are sorted: "client_event_id" before "org_id" alphabetically.
    expect(r1.canonical_json.indexOf('"client_event_id"')).toBeLessThan(
      r1.canonical_json.indexOf('"org_id"'),
    );
  });
});

describe("createInMemoryWalAppender", () => {
  test("append([row]) returns 1 id 'w-0'; drain() returns the stored row; second append yields 'w-1'", async () => {
    const wal = createInMemoryWalAppender();
    const r1 = canonicalize(
      makeEvent({ client_event_id: "11111111-1111-4111-8111-111111111111" }),
      {
        tenantId: "t1",
        engineerId: "e1",
      },
    );
    const ids1 = await wal.append([r1]);
    expect(ids1).toEqual(["w-0"]);
    const drained1 = wal.drain();
    expect(drained1.length).toBe(1);
    expect(drained1[0]?.client_event_id).toBe("11111111-1111-4111-8111-111111111111");
    const r2 = canonicalize(
      makeEvent({ client_event_id: "22222222-2222-4222-8222-222222222222" }),
      {
        tenantId: "t1",
        engineerId: "e1",
      },
    );
    const ids2 = await wal.append([r2]);
    expect(ids2).toEqual(["w-1"]);
  });

  test("empty batch throws wal:empty-batch", async () => {
    const wal = createInMemoryWalAppender();
    let err: Error | null = null;
    try {
      await wal.append([]);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err?.message).toBe("wal:empty-batch");
  });

  test("row-too-large throws wal:row-too-large", async () => {
    const wal = createInMemoryWalAppender();
    const huge = "x".repeat(300 * 1024); // 300 KiB > 256 KiB
    const bad: CanonicalRow = {
      tenant_id: "t",
      engineer_id: "e",
      device_id: "d",
      client_event_id: "11111111-1111-4111-8111-111111111111",
      schema_version: 1,
      canonical_json: huge,
      row: {},
    };
    let err: Error | null = null;
    try {
      await wal.append([bad]);
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err?.message).toBe("wal:row-too-large");
  });
});

describe("createRedisStreamsWalAppender", () => {
  test("one append of 3 rows → 3 XADD calls with expected fields; ids returned", async () => {
    const calls: Array<{ stream: string; fields: Record<string, string> }> = [];
    const fakeRedis: WalRedis = {
      async xadd(stream, fields) {
        calls.push({ stream, fields });
        return `${calls.length - 1}-0`;
      },
      async xreadgroup() {
        return [];
      },
      async xack() {
        return 0;
      },
      async xclaim() {
        return [];
      },
      async xgroupCreate() {
        // no-op
      },
      async xlen() {
        return 0;
      },
      async xinfoGroupsPending() {
        return 0;
      },
    };
    const wal = createRedisStreamsWalAppender(fakeRedis);
    const rows = [0, 1, 2].map((i) =>
      canonicalize(
        makeEvent({
          client_event_id: `1111111${i}-1111-4111-8111-111111111111`,
          event_seq: i,
        }),
        { tenantId: "t1", engineerId: "e1" },
      ),
    );
    const ids = await wal.append(rows);
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.stream === "events_wal")).toBe(true);
    for (const c of calls) {
      expect(Object.keys(c.fields).sort()).toEqual(
        ["canonical_json", "client_event_id", "engineer_id", "schema_version", "tenant_id"].sort(),
      );
    }
    expect(ids).toEqual(["0-0", "1-0", "2-0"]);
  });
});
