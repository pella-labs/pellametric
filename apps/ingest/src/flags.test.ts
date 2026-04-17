import { describe, expect, test } from "bun:test";
import { assertFlagCoherence, FlagIncoherentError, parseFlags } from "./flags";

describe("parseFlags", () => {
  test("defaults with empty env", () => {
    const f = parseFlags({});
    expect(f).toEqual({
      ENFORCE_TIER_A_ALLOWLIST: false,
      WAL_APPEND_ENABLED: true,
      WAL_CONSUMER_ENABLED: true,
      OTLP_RECEIVER_ENABLED: false,
      WEBHOOKS_ENABLED: false,
      CLICKHOUSE_WRITER: "client",
    });
  });

  test("boolean parsing: 1/true → true, 0/false/undefined → false", () => {
    expect(parseFlags({ OTLP_RECEIVER_ENABLED: "1" }).OTLP_RECEIVER_ENABLED).toBe(true);
    expect(parseFlags({ OTLP_RECEIVER_ENABLED: "true" }).OTLP_RECEIVER_ENABLED).toBe(true);
    expect(parseFlags({ OTLP_RECEIVER_ENABLED: "0" }).OTLP_RECEIVER_ENABLED).toBe(false);
    expect(parseFlags({ OTLP_RECEIVER_ENABLED: "false" }).OTLP_RECEIVER_ENABLED).toBe(false);
    expect(parseFlags({}).OTLP_RECEIVER_ENABLED).toBe(false);
  });

  test("CLICKHOUSE_WRITER=sidecar parsed; anything else → 'client'", () => {
    expect(parseFlags({ CLICKHOUSE_WRITER: "sidecar" }).CLICKHOUSE_WRITER).toBe("sidecar");
    expect(parseFlags({ CLICKHOUSE_WRITER: "client" }).CLICKHOUSE_WRITER).toBe("client");
    expect(parseFlags({ CLICKHOUSE_WRITER: "lolwat" }).CLICKHOUSE_WRITER).toBe("client");
  });
});

describe("assertFlagCoherence", () => {
  test("incoherent: OTLP_RECEIVER_ENABLED=1 WAL_CONSUMER_ENABLED=0 → throws FLAG_INCOHERENT", () => {
    const flags = parseFlags({
      OTLP_RECEIVER_ENABLED: "1",
      WAL_CONSUMER_ENABLED: "0",
    });
    expect(() => assertFlagCoherence(flags)).toThrow(FlagIncoherentError);
    try {
      assertFlagCoherence(flags);
    } catch (e) {
      expect((e as FlagIncoherentError).code).toBe("FLAG_INCOHERENT");
      expect((e as FlagIncoherentError).details).toContain("OTLP_RECEIVER_ENABLED=1");
    }
  });

  test("coherent defaults pass", () => {
    expect(() => assertFlagCoherence(parseFlags({}))).not.toThrow();
  });

  test("WAL_APPEND_ENABLED=1 WAL_CONSUMER_ENABLED=0 → throws (unbounded WAL)", () => {
    const flags = parseFlags({ WAL_CONSUMER_ENABLED: "0" });
    expect(() => assertFlagCoherence(flags)).toThrow(FlagIncoherentError);
  });
});
