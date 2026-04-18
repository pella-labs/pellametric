import { expect, test } from "bun:test";
import { EventSchema } from "@bematist/schema";
import { normalizeGenerations } from "./normalize";
import type { CursorGenerationRow } from "./parse";

const ID = { tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t", tier: "B" as const };

function row(
  p: Partial<CursorGenerationRow> & Pick<CursorGenerationRow, "generationUUID" | "unixMs">,
): CursorGenerationRow {
  return {
    conversationId: "conv_X",
    model: "claude-sonnet-4-5",
    mode: "pro",
    tokenCount: { inputTokens: 100, outputTokens: 50 },
    ...p,
  };
}

test("normalizeGenerations returns [] on empty input", () => {
  expect(normalizeGenerations([], ID, "0.x")).toEqual([]);
});

test("auto-mode rows emit fidelity='estimated' + cost_estimated=true", () => {
  const events = normalizeGenerations(
    [row({ unixMs: 1, generationUUID: "g1", mode: "auto" })],
    ID,
    "0.x",
  );
  const llm = events.find((e) => e.dev_metrics.event_kind === "llm_response");
  expect(llm?.fidelity).toBe("estimated");
  expect(llm?.cost_estimated).toBe(true);
});

test("pro-mode rows emit fidelity='full' + cost_estimated=false", () => {
  const events = normalizeGenerations(
    [row({ unixMs: 1, generationUUID: "g1", mode: "pro" })],
    ID,
    "0.x",
  );
  const llm = events.find((e) => e.dev_metrics.event_kind === "llm_response");
  expect(llm?.fidelity).toBe("full");
  expect(llm?.cost_estimated).toBe(false);
});

test("missing mode treated as Auto (honest fidelity)", () => {
  const events = normalizeGenerations(
    [row({ unixMs: 1, generationUUID: "g1", mode: undefined as unknown as "auto" })],
    ID,
    "0.x",
  );
  const llm = events.find((e) => e.dev_metrics.event_kind === "llm_response");
  expect(llm?.cost_estimated).toBe(true);
});

test("emits session_start + session_end framing per conversation", () => {
  const events = normalizeGenerations(
    [
      row({ unixMs: 1000, generationUUID: "g1", conversationId: "A" }),
      row({ unixMs: 2000, generationUUID: "g2", conversationId: "A" }),
      row({ unixMs: 3000, generationUUID: "g3", conversationId: "B" }),
    ],
    ID,
    "0.x",
  );
  const starts = events.filter((e) => e.dev_metrics.event_kind === "session_start");
  const ends = events.filter((e) => e.dev_metrics.event_kind === "session_end");
  expect(starts.length).toBe(2);
  expect(ends.length).toBe(2);
});

test("session_end duration_ms = lastUnix - firstUnix", () => {
  const events = normalizeGenerations(
    [
      row({ unixMs: 1000, generationUUID: "g1", conversationId: "A" }),
      row({ unixMs: 4500, generationUUID: "g2", conversationId: "A" }),
    ],
    ID,
    "0.x",
  );
  const end = events.find((e) => e.dev_metrics.event_kind === "session_end");
  expect(end?.dev_metrics.duration_ms).toBe(3500);
});

test("client_event_id is deterministic across runs", () => {
  const a = normalizeGenerations([row({ unixMs: 1, generationUUID: "g1" })], ID, "0.x");
  const b = normalizeGenerations([row({ unixMs: 1, generationUUID: "g1" })], ID, "0.x");
  expect(a[0]?.client_event_id).toBe(b[0]?.client_event_id);
  expect(a[1]?.client_event_id).toBe(b[1]?.client_event_id);
});

test("toolFormerData status='error' surfaces first_try_failure=true", () => {
  const events = normalizeGenerations(
    [
      row({
        unixMs: 1,
        generationUUID: "g1",
        toolFormerData: { tool: "edit_file", additionalData: { status: "error" } },
      }),
    ],
    ID,
    "0.x",
  );
  const tool = events.find((e) => e.dev_metrics.event_kind === "tool_result");
  expect(tool?.dev_metrics.first_try_failure).toBe(true);
  expect(tool?.dev_metrics.tool_status).toBe("error");
});

test("event_seq is monotonic across the emitted stream", () => {
  const events = normalizeGenerations(
    [
      row({ unixMs: 1000, generationUUID: "g1", conversationId: "A" }),
      row({ unixMs: 2000, generationUUID: "g2", conversationId: "B" }),
    ],
    ID,
    "0.x",
  );
  for (let i = 0; i < events.length; i++) {
    expect(events[i]?.event_seq).toBe(i);
  }
});

test("every event passes the canonical EventSchema", () => {
  const events = normalizeGenerations(
    [
      row({ unixMs: 1, generationUUID: "g1", mode: "auto" }),
      row({
        unixMs: 2,
        generationUUID: "g2",
        mode: "pro",
        toolFormerData: { tool: "run_command", additionalData: { status: "ok" } },
      }),
    ],
    ID,
    "0.x",
  );
  for (const e of events) {
    const parsed = EventSchema.safeParse(e);
    if (!parsed.success) throw new Error(parsed.error.message);
  }
});
