// Tests for the real ClickHouse writer.
// - Offline unit tests (default) verify the client is configured so
//   canonicalize()'s ISO8601 `ts` round-trips without CH parse failures.
// - Live tests (gated by TEST_LIVE_CLICKHOUSE=1) hit a running CH and
//   round-trip a row through insert + SELECT count().

import { describe, expect, test } from "bun:test";
import type { Event } from "@bematist/schema";
import { createClient } from "@clickhouse/client";
import { canonicalize } from "../wal/append";
import { buildClientOptions, type CHClientLike, createRealClickHouseWriter } from "./realWriter";

const live = process.env.TEST_LIVE_CLICKHOUSE === "1";
const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";

// biome-ignore lint/suspicious/noExplicitAny: test.skipIf is available on bun:test
const runIfLive = (test as any).skipIf ? (test as any).skipIf(!live) : live ? test : test.skip;

describe("realClickHouseWriter (offline)", () => {
  test("client is configured with date_time_input_format=best_effort", () => {
    const opts = buildClientOptions({
      url: "http://localhost:8123",
      database: "bematist",
      keep_alive_idle_socket_ttl_ms: 2000,
      request_timeout_ms: 30000,
      compression_request: true,
      compression_response: true,
      max_open_connections: 10,
      table: "events",
    });
    const settings = opts.clickhouse_settings as { date_time_input_format?: string };
    expect(settings.date_time_input_format).toBe("best_effort");
  });

  test("insert hands a canonicalize() row with ISO8601 ts through unchanged", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const fake: CHClientLike = {
      async insert({ values }) {
        for (const v of values) captured.push(v);
        return {};
      },
    };
    const writer = createRealClickHouseWriter({ url }, () => fake);

    const iso = "2026-04-18T01:23:45.678Z";
    const event: Event = {
      client_event_id: "11111111-1111-4111-8111-111111111111",
      schema_version: 1,
      ts: iso,
      tenant_id: "wire-tenant-ignored",
      engineer_id: "wire-engineer-ignored",
      device_id: "dev-unit",
      source: "claude-code",
      fidelity: "full",
      cost_estimated: false,
      tier: "B",
      session_id: "s-iso",
      event_seq: 1,
      dev_metrics: { event_kind: "session_start" },
    };
    const canonical = canonicalize(event, { tenantId: "org-unit", engineerId: "eng-unit" });

    await writer.insert([canonical.row]);

    expect(captured).toHaveLength(1);
    const row = captured[0] as { ts: string };
    expect(row.ts).toBe(iso);
  });
});

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
