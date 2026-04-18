import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import { normalizeToolUsage } from "../normalize";
import type { ContinueToolUsageLine } from "../types";

const FIX = join(import.meta.dir, "..", "fixtures");
const id = {
  tenantId: "org_acme",
  engineerId: "eng_2b5c91f0d4c1",
  deviceId: "dev_mbp_01",
  tier: "B" as const,
};

function load(): ContinueToolUsageLine[] {
  const raw = readFileSync(join(FIX, "toolUsage.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ContinueToolUsageLine);
}

test("each toolUsage row emits one tool_call + one tool_result", () => {
  const lines = load();
  const events = normalizeToolUsage(lines, id, "0.2.0");
  expect(events.length).toBe(lines.length * 2);
  const calls = events.filter((e) => e.dev_metrics.event_kind === "tool_call");
  const results = events.filter((e) => e.dev_metrics.event_kind === "tool_result");
  expect(calls.length).toBe(lines.length);
  expect(results.length).toBe(lines.length);
});

test("status='ok' becomes tool_status='ok'", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  const ok = events.find(
    (e) => e.dev_metrics.event_kind === "tool_result" && e.dev_metrics.tool_status === "ok",
  );
  expect(ok).toBeDefined();
});

test("status='error' becomes tool_status='error' AND first_try_failure=true", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  const err = events.find(
    (e) => e.dev_metrics.event_kind === "tool_result" && e.dev_metrics.tool_status === "error",
  );
  expect(err).toBeDefined();
  expect(err?.dev_metrics.first_try_failure).toBe(true);
});

test("status='denied' becomes tool_status='denied' (and first_try_failure stays unset)", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  const denied = events.find(
    (e) => e.dev_metrics.event_kind === "tool_result" && e.dev_metrics.tool_status === "denied",
  );
  expect(denied).toBeDefined();
  expect(denied?.dev_metrics.first_try_failure).toBeUndefined();
});

test("durationMs flows through to tool_result.duration_ms", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  const withDuration = events.find(
    (e) => e.dev_metrics.event_kind === "tool_result" && e.dev_metrics.duration_ms != null,
  );
  expect(withDuration?.dev_metrics.duration_ms).toBeGreaterThan(0);
});

test("toolName flows through to dev_metrics.tool_name on both call and result", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  for (const e of events) {
    expect(e.dev_metrics.tool_name).toBeDefined();
  }
});

test("missing status defaults to 'ok' (defensive)", () => {
  const lines: ContinueToolUsageLine[] = [{ sessionId: "s1", toolName: "noop" }];
  const events = normalizeToolUsage(lines, id, "0.2.0");
  const result = events.find((e) => e.dev_metrics.event_kind === "tool_result");
  expect(result?.dev_metrics.tool_status).toBe("ok");
});

test("every event passes EventSchema.safeParse", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  for (const e of events) expect(EventSchema.safeParse(e).success).toBe(true);
});

test("client_event_id determinism — call and result get distinct ids per row", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  const ids = new Set(events.map((e) => e.client_event_id));
  expect(ids.size).toBe(events.length);
});

test("source='continue', fidelity='full', tier honors identity", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  for (const e of events) {
    expect(e.source).toBe("continue");
    expect(e.fidelity).toBe("full");
    expect(e.tier).toBe("B");
  }
});

test("forbidden fields never appear on emitted events", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  const forbidden = ["prompt_text", "tool_input", "tool_output"];
  for (const e of events)
    for (const k of forbidden) expect((e as Record<string, unknown>)[k]).toBeUndefined();
});

test("event_seq numbering inside the stream is monotonic", () => {
  const events = normalizeToolUsage(load(), id, "0.2.0");
  for (let i = 1; i < events.length; i++) {
    expect(events[i]?.event_seq ?? 0).toBeGreaterThan(events[i - 1]?.event_seq ?? -1);
  }
});
