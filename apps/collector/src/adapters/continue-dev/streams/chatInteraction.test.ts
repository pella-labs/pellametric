import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import { normalizeChatInteraction } from "../normalize";
import type { ContinueChatInteractionLine } from "../types";

const FIX = join(import.meta.dir, "..", "fixtures");
const id = {
  tenantId: "org_acme",
  engineerId: "eng_2b5c91f0d4c1",
  deviceId: "dev_mbp_01",
  tier: "B" as const,
};

function load(): ContinueChatInteractionLine[] {
  const raw = readFileSync(join(FIX, "chatInteraction.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ContinueChatInteractionLine);
}

test("user role → llm_request, assistant role → llm_response", () => {
  const events = normalizeChatInteraction(load(), id, "0.2.0");
  const kinds = events.map((e) => e.dev_metrics.event_kind);
  expect(kinds.filter((k) => k === "llm_request").length).toBe(3);
  expect(kinds.filter((k) => k === "llm_response").length).toBe(3);
});

test("every emitted event passes EventSchema.safeParse", () => {
  const events = normalizeChatInteraction(load(), id, "0.2.0");
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) {
    const r = EventSchema.safeParse(e);
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  }
});

test("source is 'continue', fidelity is 'full', tier honors identity (D7)", () => {
  const events = normalizeChatInteraction(load(), id, "0.2.0");
  for (const e of events) {
    expect(e.source).toBe("continue");
    expect(e.fidelity).toBe("full");
    expect(e.tier).toBe("B");
    expect(e.cost_estimated).toBe(false);
  }
});

test("client_event_id is deterministic — same inputs yield same uuids", () => {
  const a = normalizeChatInteraction(load(), id, "0.2.0");
  const b = normalizeChatInteraction(load(), id, "0.2.0");
  expect(a.map((e) => e.client_event_id)).toEqual(b.map((e) => e.client_event_id));
});

test("event_seq is monotonic and starts at 0", () => {
  const events = normalizeChatInteraction(load(), id, "0.2.0");
  expect(events[0]?.event_seq).toBe(0);
  for (let i = 1; i < events.length; i++) {
    expect(events[i]?.event_seq ?? 0).toBeGreaterThan(events[i - 1]?.event_seq ?? -1);
  }
});

test("llm_response stamps pricing_version + cost_usd > 0 for known model", () => {
  const events = normalizeChatInteraction(load(), id, "0.2.0");
  const resp = events.find(
    (e) => e.dev_metrics.event_kind === "llm_response" && e.gen_ai?.response?.model,
  );
  expect(resp?.dev_metrics.pricing_version).toMatch(/^litellm@/);
  expect(resp?.dev_metrics.cost_usd ?? 0).toBeGreaterThan(0);
});

test("unknown model omits cost_usd + pricing_version (no silent recomputation)", () => {
  const lines: ContinueChatInteractionLine[] = [
    {
      sessionId: "s_unknown",
      interactionId: "i1",
      role: "assistant",
      modelTitle: "totally-fake-model-xyz",
      modelProvider: "weird",
      promptTokens: 100,
      generatedTokens: 10,
      timestamp: "2026-04-16T10:00:00.000Z",
    },
  ];
  const events = normalizeChatInteraction(lines, id, "0.2.0");
  expect(events[0]?.dev_metrics.cost_usd).toBeUndefined();
  expect(events[0]?.dev_metrics.pricing_version).toBeUndefined();
});

test("missing sessionId falls back to 'unknown' instead of throwing", () => {
  const lines: ContinueChatInteractionLine[] = [
    { interactionId: "i1", role: "user", modelTitle: "claude-sonnet-4-5" },
  ];
  const events = normalizeChatInteraction(lines, id, "0.2.0");
  expect(events[0]?.session_id).toBe("unknown");
});

test("forbidden Tier-A/B fields never appear on emitted events", () => {
  const events = normalizeChatInteraction(load(), id, "0.2.0");
  const forbidden = ["prompt_text", "tool_input", "tool_output", "raw_attrs"];
  for (const e of events) {
    for (const k of forbidden) {
      expect((e as Record<string, unknown>)[k]).toBeUndefined();
    }
  }
});

test("system defaults to modelProvider when present, falls back to 'continue'", () => {
  const lines: ContinueChatInteractionLine[] = [
    { sessionId: "s1", role: "user", modelTitle: "x" },
    { sessionId: "s1", role: "assistant", modelTitle: "x", modelProvider: "anthropic" },
  ];
  const events = normalizeChatInteraction(lines, id, "0.2.0");
  expect(events[0]?.gen_ai?.system).toBe("continue");
  expect(events[1]?.gen_ai?.system).toBe("anthropic");
});

test("empty input → empty output", () => {
  expect(normalizeChatInteraction([], id, "0.2.0")).toEqual([]);
});
