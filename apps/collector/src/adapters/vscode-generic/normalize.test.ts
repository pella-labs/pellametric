import { expect, test } from "bun:test";
import { EventSchema } from "@bematist/schema";
import { baseEvent, deterministicEventId } from "./normalize";

const id = {
  tenantId: "org_acme",
  engineerId: "eng_t",
  deviceId: "dev_t",
  tier: "B" as const,
};

test("deterministicEventId is stable across calls with the same inputs", () => {
  const a = deterministicEventId("rjmacarthy.twinny", "twn_01", 0, "session_start", { x: 1 });
  const b = deterministicEventId("rjmacarthy.twinny", "twn_01", 0, "session_start", { x: 1 });
  expect(a).toBe(b);
});

test("deterministicEventId varies with seq", () => {
  const a = deterministicEventId("rjmacarthy.twinny", "twn_01", 0, "session_start", null);
  const b = deterministicEventId("rjmacarthy.twinny", "twn_01", 1, "session_start", null);
  expect(a).not.toBe(b);
});

test("deterministicEventId returns a valid UUID v4", () => {
  const u = deterministicEventId("rjmacarthy.twinny", "s", 0, "k", null);
  expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("baseEvent fills the canonical envelope and stamps source='vscode-generic'", () => {
  const env = baseEvent({
    id,
    sessionId: "twn_01",
    seq: 0,
    ts: "2026-04-17T09:00:00.000Z",
    fidelity: "estimated",
    costEstimated: true,
    sourceVersion: "twinny@v1",
  });
  expect(env.source).toBe("vscode-generic");
  expect(env.fidelity).toBe("estimated");
  expect(env.cost_estimated).toBe(true);
  expect(env.tier).toBe("B");
  expect(env.source_version).toBe("twinny@v1");
});

test("baseEvent + dev_metrics produces an EventSchema-valid event", () => {
  const env = baseEvent({
    id,
    sessionId: "twn_01",
    seq: 0,
    ts: "2026-04-17T09:00:00.000Z",
    fidelity: "estimated",
    costEstimated: true,
  });
  const evt = {
    ...env,
    client_event_id: deterministicEventId("rjmacarthy.twinny", "twn_01", 0, "session_start", null),
    dev_metrics: { event_kind: "session_start", duration_ms: 0 },
  };
  const result = EventSchema.safeParse(evt);
  expect(result.success).toBe(true);
});
