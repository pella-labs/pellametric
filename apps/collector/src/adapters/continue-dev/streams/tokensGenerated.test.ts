import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import { computeCostUsd, normalizeTokensGenerated } from "../normalize";
import type { ContinueTokensGeneratedLine } from "../types";

const FIX = join(import.meta.dir, "..", "fixtures");
const id = {
  tenantId: "org_acme",
  engineerId: "eng_2b5c91f0d4c1",
  deviceId: "dev_mbp_01",
  tier: "B" as const,
};

function load(): ContinueTokensGeneratedLine[] {
  const raw = readFileSync(join(FIX, "tokensGenerated.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ContinueTokensGeneratedLine);
}

test("every tokensGenerated line emits exactly one llm_response event", () => {
  const lines = load();
  const events = normalizeTokensGenerated(lines, id, "0.2.0");
  expect(events.length).toBe(lines.length);
  for (const e of events) expect(e.dev_metrics.event_kind).toBe("llm_response");
});

test("every event passes EventSchema.safeParse", () => {
  const events = normalizeTokensGenerated(load(), id, "0.2.0");
  for (const e of events) expect(EventSchema.safeParse(e).success).toBe(true);
});

test("usage block carries cache_read + cache_creation when Continue reports them", () => {
  const events = normalizeTokensGenerated(load(), id, "0.2.0");
  const withCache = events.find((e) => (e.gen_ai?.usage?.cache_read_input_tokens ?? 0) > 0);
  expect(withCache).toBeDefined();
  expect(withCache?.gen_ai?.usage?.cache_read_input_tokens).toBe(2400);
  expect(withCache?.gen_ai?.usage?.cache_creation_input_tokens).toBe(800);
});

test("computeCostUsd anchors to the LiteLLM pin for known Anthropic + OpenAI models", () => {
  expect(computeCostUsd("claude-sonnet-4-5", { input: 1_000_000, output: 1_000_000 })).toBe(18);
  expect(computeCostUsd("gpt-4o", { input: 1_000_000, output: 1_000_000 })).toBe(12.5);
});

test("computeCostUsd returns undefined for unknown model + missing model", () => {
  expect(computeCostUsd("not-a-model", { input: 100, output: 10 })).toBeUndefined();
  expect(computeCostUsd(undefined, { input: 100, output: 10 })).toBeUndefined();
});

test("client_event_id is deterministic for tokensGenerated stream", () => {
  const a = normalizeTokensGenerated(load(), id, "0.2.0");
  const b = normalizeTokensGenerated(load(), id, "0.2.0");
  expect(a.map((e) => e.client_event_id)).toEqual(b.map((e) => e.client_event_id));
});

test("event_seq numbers are 0..N-1 inside the stream", () => {
  const events = normalizeTokensGenerated(load(), id, "0.2.0");
  expect(events.map((e) => e.event_seq)).toEqual(events.map((_, i) => i));
});

test("known model stamps pricing_version, unknown model omits it", () => {
  const lines: ContinueTokensGeneratedLine[] = [
    {
      sessionId: "s1",
      modelTitle: "claude-sonnet-4-5",
      modelProvider: "anthropic",
      promptTokens: 100,
      generatedTokens: 10,
      timestamp: "2026-04-16T10:00:00.000Z",
    },
    {
      sessionId: "s1",
      modelTitle: "fake-model",
      modelProvider: "weird",
      promptTokens: 100,
      generatedTokens: 10,
      timestamp: "2026-04-16T10:00:01.000Z",
    },
  ];
  const events = normalizeTokensGenerated(lines, id, "0.2.0");
  expect(events[0]?.dev_metrics.pricing_version).toMatch(/^litellm@/);
  expect(events[1]?.dev_metrics.pricing_version).toBeUndefined();
});

test("forbidden fields never appear on emitted events", () => {
  const events = normalizeTokensGenerated(load(), id, "0.2.0");
  const forbidden = ["prompt_text", "tool_input", "tool_output"];
  for (const e of events)
    for (const k of forbidden) expect((e as Record<string, unknown>)[k]).toBeUndefined();
});

test("source / fidelity / tier invariants hold on every event", () => {
  const events = normalizeTokensGenerated(load(), id, "0.2.0");
  for (const e of events) {
    expect(e.source).toBe("continue");
    expect(e.fidelity).toBe("full");
    expect(e.tier).toBe("B");
  }
});

test("cost is rounded to 6 decimals (matches claude-code pricing precision)", () => {
  const events = normalizeTokensGenerated(load(), id, "0.2.0");
  for (const e of events) {
    if (e.dev_metrics.cost_usd === undefined) continue;
    const x = e.dev_metrics.cost_usd * 1e6;
    expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-9);
  }
});
