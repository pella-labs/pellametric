import { expect, test } from "bun:test";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import { normalizeSession } from "./normalize";
import { parseSessionFile } from "./parsers/parseSessionFile";

const FIX = join(import.meta.dir, "fixtures");

const baseIdentity = {
  tenantId: "org_acme",
  engineerId: "eng_test",
  deviceId: "dev_test",
  tier: "B" as const,
};

test("every produced event passes EventSchema validation", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (const e of events) {
    const r = EventSchema.safeParse(e);
    expect(r.success).toBe(true);
  }
});

test("event_kind coverage includes session_start, llm_request, llm_response, tool_call, tool_result, session_end", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of [
    "session_start",
    "llm_request",
    "llm_response",
    "tool_call",
    "tool_result",
    "session_end",
  ]) {
    expect(kinds.has(k as never)).toBe(true);
  }
});

test("llm_response event stamps pricing_version and cost_usd is > 0", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const resp = events.find((e) => e.dev_metrics.event_kind === "llm_response");
  expect(resp?.dev_metrics.pricing_version).toMatch(/^litellm@/);
  expect(resp?.dev_metrics.cost_usd ?? 0).toBeGreaterThan(0);
});

test("client_event_id is deterministic — same input yields same ids", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const a = normalizeSession(parsed, baseIdentity, "1.0.35");
  const b = normalizeSession(parsed, baseIdentity, "1.0.35");
  expect(a.map((e) => e.client_event_id)).toEqual(b.map((e) => e.client_event_id));
});

test("event_seq is monotonic within session", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (let i = 1; i < events.length; i++) {
    expect(events[i]?.event_seq ?? 0).toBeGreaterThan(events[i - 1]?.event_seq ?? 0);
  }
});

test("tier defaults to 'B' per CLAUDE.md D7 default", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (const e of events) expect(e.tier).toBe("B");
});

test("fidelity is always 'full' for claude-code", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  for (const e of events) expect(e.fidelity).toBe("full");
});

test("forbidden fields never appear on emitted events (Tier B)", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const forbidden = ["prompt_text", "tool_input", "tool_output"];
  for (const e of events) {
    for (const k of forbidden) {
      expect((e as Record<string, unknown>)[k]).toBeUndefined();
    }
  }
});
