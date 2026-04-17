import { describe, expect, test } from "bun:test";
import { filterRawAttrs, TIER_A_RAW_ATTRS_ALLOWLIST } from "./tier_a_allowlist";

describe("TIER_A_RAW_ATTRS_ALLOWLIST", () => {
  test("matches contract 08 §Tier A allowlist (13 entries)", () => {
    expect(TIER_A_RAW_ATTRS_ALLOWLIST.size).toBe(13);
    for (const key of [
      "schema_version",
      "source",
      "source_version",
      "device.id",
      "service.version",
      "gen_ai.system",
      "gen_ai.request.model",
      "gen_ai.response.model",
      "dev_metrics.event_kind",
      "dev_metrics.tool_name",
      "dev_metrics.tool_status",
      "dev_metrics.duration_ms",
      "dev_metrics.first_try_failure",
    ]) {
      expect(TIER_A_RAW_ATTRS_ALLOWLIST.has(key)).toBe(true);
    }
  });
});

describe("filterRawAttrs", () => {
  test("undefined → {filtered: undefined, dropped_keys: []}", () => {
    const r = filterRawAttrs(undefined);
    expect(r.filtered).toBeUndefined();
    expect(r.dropped_keys).toEqual([]);
  });

  test("allowed top-level keys pass through", () => {
    const r = filterRawAttrs({
      schema_version: 1,
      source: "claude-code",
      source_version: "0.1.0",
    });
    expect(r.filtered).toEqual({
      schema_version: 1,
      source: "claude-code",
      source_version: "0.1.0",
    });
    expect(r.dropped_keys).toEqual([]);
  });

  test("non-allowlisted top-level keys dropped with dropped_keys reflecting them", () => {
    const r = filterRawAttrs({
      schema_version: 1,
      foo: "bar",
      secret: "nope",
    });
    expect(r.filtered).toEqual({ schema_version: 1 });
    expect(r.dropped_keys.sort()).toEqual(["foo", "secret"].sort());
  });

  test("nested keys `gen_ai.system` flattened correctly", () => {
    const r = filterRawAttrs({
      gen_ai: {
        system: "anthropic",
        request: { model: "claude-4-opus" },
        response: { model: "claude-4-opus" },
      },
    });
    expect(r.filtered).toEqual({
      gen_ai: {
        system: "anthropic",
        request: { model: "claude-4-opus" },
        response: { model: "claude-4-opus" },
      },
    });
    expect(r.dropped_keys).toEqual([]);
  });

  test("nested non-allowlisted subkeys are dropped; allowlisted siblings kept", () => {
    const r = filterRawAttrs({
      gen_ai: {
        system: "anthropic",
        request: { model: "claude-4-opus", temperature: 0.7 },
        response: { model: "claude-4-opus", raw: "blob" },
      },
    });
    expect(r.filtered).toEqual({
      gen_ai: {
        system: "anthropic",
        request: { model: "claude-4-opus" },
        response: { model: "claude-4-opus" },
      },
    });
    expect(r.dropped_keys.sort()).toEqual(
      ["gen_ai.request.temperature", "gen_ai.response.raw"].sort(),
    );
  });

  test("dropped nested object when no sub-key is on the allowlist", () => {
    const r = filterRawAttrs({
      device: { id: "dev_1" },
      custom: { foo: "bar", nested: { x: 1 } },
    });
    expect(r.filtered).toEqual({ device: { id: "dev_1" } });
    expect(r.dropped_keys.sort()).toEqual(["custom.foo", "custom.nested.x"].sort());
  });

  test("extraAllowlist keys are merged and allowed through", () => {
    const r = filterRawAttrs({ custom_counter: 42, secret: "no" }, ["custom_counter"]);
    expect(r.filtered).toEqual({ custom_counter: 42 });
    expect(r.dropped_keys).toEqual(["secret"]);
  });

  test("extraAllowlist supports dotted paths for nested keys", () => {
    const r = filterRawAttrs({ custom: { counter: 42, secret: "no" } }, ["custom.counter"]);
    expect(r.filtered).toEqual({ custom: { counter: 42 } });
    expect(r.dropped_keys).toEqual(["custom.secret"]);
  });

  test("primitive values at allowlisted path pass through untouched", () => {
    const r = filterRawAttrs({
      "device.id": "dev_1", // treat literal dotted string key as-is
      schema_version: 1,
    });
    expect(r.filtered?.schema_version).toBe(1);
    // literal "device.id" top-level key should map onto the allowlist entry
    expect(r.filtered?.["device.id"]).toBe("dev_1");
  });
});
