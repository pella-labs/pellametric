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

// ---- Real `~/.claude/projects/**.jsonl` format coverage ----------------------
// These tests exercise the "real" on-disk format (top-level `type: user | assistant`,
// nested content blocks, `file-history-snapshot` noise) that PR #71 didn't handle.

test("real-projects fixture: produces events that all pass EventSchema", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-projects-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) {
    expect(EventSchema.safeParse(e).success).toBe(true);
  }
});

test("real-projects fixture: synthesizes session_start from first timestamp", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-projects-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  expect(events[0]?.dev_metrics.event_kind).toBe("session_start");
});

test("real-projects fixture: assistant messages emit llm_response with usage + cost", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-projects-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const responses = events.filter((e) => e.dev_metrics.event_kind === "llm_response");
  expect(responses.length).toBe(3);
  for (const r of responses) {
    expect(r.gen_ai?.usage?.input_tokens).toBeGreaterThan(0);
    expect(r.dev_metrics.cost_usd ?? 0).toBeGreaterThan(0);
    expect(r.dev_metrics.pricing_version).toMatch(/^litellm@/);
  }
});

test("real-projects fixture: tool_use blocks inside content[] emit tool_call events", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-projects-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const calls = events.filter((e) => e.dev_metrics.event_kind === "tool_call");
  expect(calls.length).toBe(1);
  expect(calls[0]?.dev_metrics.tool_name).toBe("Read");
});

test("real-projects fixture: tool_result blocks in user content[] emit tool_result events", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-projects-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  const results = events.filter((e) => e.dev_metrics.event_kind === "tool_result");
  expect(results.length).toBe(2);
  const errored = results.find((e) => e.dev_metrics.tool_status === "error");
  expect(errored).toBeDefined();
  expect(errored?.dev_metrics.first_try_failure).toBe(true);
});

test("real-projects fixture: file-history-snapshot is skipped, not mapped", async () => {
  const parsed = await parseSessionFile(join(FIX, "real-projects-session.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "1.0.35");
  // Fixture has 1 snapshot + 3 assistant + 2 user (w/ tool_result) + 1 user (plain prompt).
  // Snapshot produces nothing, so events = 1 synth session_start + 3 llm_response + 1 tool_call
  // (from asst-2's tool_use) + 1 llm_request (from plain user prompt "refactor...") + 2 tool_result.
  expect(events.length).toBe(8);
});
