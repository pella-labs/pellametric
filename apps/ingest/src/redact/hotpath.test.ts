import { describe, expect, test } from "bun:test";
import type { Event } from "@bematist/schema";
import { containsRedactionMarker, createInMemoryAuditSink, redactEventInPlace } from "./hotpath";

function baseEvent(overrides: Partial<Event> = {}): Event {
  return {
    client_event_id: "00000000-0000-4000-8000-000000000001",
    schema_version: 1,
    ts: "2026-04-17T12:00:00.000Z",
    tenant_id: "org_abc",
    engineer_id: "eng_hash_xyz",
    device_id: "device_1",
    source: "claude-code",
    fidelity: "full",
    cost_estimated: false,
    tier: "C",
    session_id: "sess_1",
    event_seq: 0,
    dev_metrics: { event_kind: "llm_request" },
    ...overrides,
  };
}

describe("redactEventInPlace — output shape", () => {
  test("does not mutate the caller's event object", async () => {
    const ev = baseEvent({ prompt_text: "AKIAIOSFODNN7EXAMPLE" });
    const snapshot = structuredClone(ev);
    await redactEventInPlace(ev);
    expect(ev).toEqual(snapshot);
  });

  test("replaces prompt_text with <REDACTED:…> markers and bumps redaction_count", async () => {
    const ev = baseEvent({
      prompt_text: "token AKIAIOSFODNN7EXAMPLE expires Friday",
    });
    const r = await redactEventInPlace(ev);
    expect(r.event.prompt_text).toMatch(/<REDACTED:secret:[0-9a-f]{16}>/);
    expect(r.event.redaction_count).toBe(1);
  });

  test("preserves an existing redaction_count from the collector (server-side is additive)", async () => {
    const ev = baseEvent({
      prompt_text: "email me jane@example.com",
      redaction_count: 7,
    });
    const r = await redactEventInPlace(ev);
    expect(r.event.redaction_count).toBe(7 + r.markers.length);
  });

  test("clean event passes through untouched", async () => {
    const ev = baseEvent({
      prompt_text: "refactor the cache layer",
      tool_input: { cmd: "bun test" },
    });
    const r = await redactEventInPlace(ev);
    expect(r.event.prompt_text).toBe("refactor the cache layer");
    expect(r.event.tool_input).toEqual({ cmd: "bun test" });
    expect(r.event.redaction_count).toBe(0);
    expect(r.markers).toHaveLength(0);
    expect(r.audit).toHaveLength(0);
  });

  test("redaction is deterministic across calls", async () => {
    const ev = baseEvent({ prompt_text: "sk-ant-api03-XYZxyz1234567890abcdefABCDEFghijKLMN_-" });
    const a = await redactEventInPlace(ev, { now: () => 1 });
    const b = await redactEventInPlace(ev, { now: () => 1 });
    expect(a.event).toEqual(b.event);
    expect(a.audit).toEqual(b.audit);
  });
});

describe("redactEventInPlace — Tier-A allowlist", () => {
  test("Tier-A drops non-allowlisted raw_attrs keys even when no secret present", async () => {
    const ev = baseEvent({
      tier: "A",
      raw_attrs: {
        schema_version: 1,
        source: "claude-code",
        random_internal_field: "should-drop",
      },
    });
    const r = await redactEventInPlace(ev);
    const attrs = r.event.raw_attrs as Record<string, unknown>;
    expect(attrs).toEqual({ schema_version: 1, source: "claude-code" });
    expect(r.raw_attrs_filtered).toBe(true);
  });

  test("Tier-A also redacts allowlisted string values containing secrets", async () => {
    const ev = baseEvent({
      tier: "A",
      raw_attrs: {
        source: "AKIAIOSFODNN7EXAMPLE",
      },
    });
    const r = await redactEventInPlace(ev);
    const attrs = r.event.raw_attrs as Record<string, unknown>;
    expect(attrs.source).toMatch(/<REDACTED:secret:[0-9a-f]{16}>/);
  });

  test("Tier-B does NOT apply the allowlist", async () => {
    const ev = baseEvent({
      tier: "B",
      raw_attrs: { non_allowlisted: "kept" },
    });
    const r = await redactEventInPlace(ev);
    expect((r.event.raw_attrs as Record<string, unknown>).non_allowlisted).toBe("kept");
    expect(r.raw_attrs_filtered).toBe(false);
  });

  test("per-org raw_attrs_allowlist_extra lets additional paths through", async () => {
    const ev = baseEvent({
      tier: "A",
      raw_attrs: {
        schema_version: 1,
        my: { custom: { key: 42 } },
      },
    });
    const r = await redactEventInPlace(ev, {
      raw_attrs_allowlist_extra: ["my.custom.key"],
    });
    const attrs = r.event.raw_attrs as { schema_version: number; my: { custom: { key: number } } };
    expect(attrs.my.custom.key).toBe(42);
  });
});

describe("redactEventInPlace — audit sink + row shape", () => {
  test("emits one audit row per marker with full required shape", async () => {
    const ev = baseEvent({
      prompt_text: "AKIAIOSFODNN7EXAMPLE and sk-ant-api03-XYZxyz1234567890abcdefABCDEFghijKL",
    });
    const r = await redactEventInPlace(ev, { now: () => 1_700_000_000_000 });
    expect(r.audit).toHaveLength(r.markers.length);
    for (let i = 0; i < r.audit.length; i++) {
      const row = r.audit[i];
      if (row === undefined) throw new Error(`audit row ${i} missing`);
      expect(row.tenant_id).toBe(ev.tenant_id);
      expect(row.client_event_id).toBe(ev.client_event_id);
      expect(row.session_id).toBe(ev.session_id);
      expect(row.marker_seq).toBe(i);
      expect(row.field).toBe("prompt_text");
      expect(row.type).toBe("secret");
      expect(["trufflehog", "gitleaks"]).toContain(row.detector);
      expect(row.rule.length).toBeGreaterThan(0);
      expect(row.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(row.tier).toBe("C");
      expect(row.redacted_at_ms).toBe(1_700_000_000_000);
    }
  });

  test("attributeField points to tool_input / tool_output / raw_attrs correctly", async () => {
    const ev = baseEvent({
      prompt_text: "clean",
      tool_input: { cmd: "psql postgres://u:p@h:5432/db" },
      tool_output: "jane@example.com",
      raw_attrs: {
        // String concat so the source file never holds a complete Slack
        // webhook URL literal; the runtime value still matches the rule.
        note: `SlackWebhook https://hooks.${"sl" + "ack"}.com/services/TAAAAAAAA/BAAAAAAAA/abcdefghijklmnop12345678`,
      },
    });
    const r = await redactEventInPlace(ev);
    const fields = new Set(r.audit.map((a) => a.field));
    expect(fields.has("tool_input")).toBe(true);
    expect(fields.has("tool_output")).toBe(true);
    expect(fields.has("raw_attrs")).toBe(true);
    expect(fields.has("prompt_text")).toBe(false);
  });

  test("auditSink receives all rows in order", async () => {
    const sink = createInMemoryAuditSink();
    const ev = baseEvent({
      prompt_text: "AKIAIOSFODNN7EXAMPLE / jane@example.com",
    });
    const r = await redactEventInPlace(ev, { auditSink: sink });
    expect(sink.rows).toHaveLength(r.audit.length);
    expect(sink.rows.map((x) => x.marker_seq)).toEqual(r.audit.map((x) => x.marker_seq));
  });

  test("audit rows NEVER carry the raw secret value", async () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const ev = baseEvent({ prompt_text: `token ${secret}` });
    const r = await redactEventInPlace(ev);
    const serialized = JSON.stringify(r.audit);
    expect(serialized).not.toContain(secret);
  });
});

describe("containsRedactionMarker", () => {
  test("detects markers in any of the four fields", async () => {
    const ev = baseEvent({ prompt_text: "AKIAIOSFODNN7EXAMPLE" });
    const r = await redactEventInPlace(ev);
    expect(containsRedactionMarker(r.event)).toBe(true);
  });

  test("returns false for clean events", async () => {
    const ev = baseEvent({ prompt_text: "nothing to redact" });
    const r = await redactEventInPlace(ev);
    expect(containsRedactionMarker(r.event)).toBe(false);
  });
});
