// Live-only tests for the real ClickHouse writer.
// Gated by TEST_LIVE_CLICKHOUSE=1.

import { describe, expect, test } from "bun:test";
import { createClient } from "@clickhouse/client";
import { createRealClickHouseWriter } from "./realWriter";

const live = process.env.TEST_LIVE_CLICKHOUSE === "1";
const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";

// biome-ignore lint/suspicious/noExplicitAny: test.skipIf is available on bun:test
const runIfLive = (test as any).skipIf ? (test as any).skipIf(!live) : live ? test : test.skip;

describe("realClickHouseWriter (live)", () => {
  runIfLive("ping returns true for up server", async () => {
    const writer = createRealClickHouseWriter({ url });
    expect(await writer.ping()).toBe(true);
  });

  runIfLive("insert round-trips a row", async () => {
    const writer = createRealClickHouseWriter({ url });
    const clientEventId = `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // NOTE: this row includes only columns known to exist in the events DDL;
    // the canonical_json contract in wal/append.ts defines the full set. For
    // the live smoke we only care that insert + SELECT count() round-trip.
    const now = Math.floor(Date.now() / 1000);
    await writer.insert([
      {
        client_event_id: clientEventId,
        schema_version: 1,
        ts: now,
        org_id: "test-org",
        engineer_id: "eng-live",
        device_id: "dev-live",
        source: "test",
        source_version: "0",
        fidelity: "full",
        cost_estimated: 0,
        tier: "B",
        session_id: "s-live",
        event_seq: 1,
        gen_ai_system: "",
        gen_ai_request_model: "",
        gen_ai_response_model: "",
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        event_kind: "session_start",
        cost_usd: 0,
        pricing_version: "",
        duration_ms: 0,
        tool_name: "",
        tool_status: "",
        edit_decision: "",
        redaction_count: 0,
        raw_attrs: "",
      },
    ]);

    const verify = createClient({ url });
    const rs = await verify.query({
      query: "SELECT count() AS c FROM events WHERE client_event_id = {id:String}",
      query_params: { id: clientEventId },
      format: "JSON",
    });
    const json = (await rs.json()) as { data: Array<{ c: string | number }> };
    const c = Number(json.data[0]?.c ?? 0);
    expect(c).toBe(1);
  });
});
