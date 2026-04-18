import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import { normalizeEditOutcome } from "../normalize";
import type { ContinueEditOutcomeLine } from "../types";

const FIX = join(import.meta.dir, "..", "fixtures");
const id = {
  tenantId: "org_acme",
  engineerId: "eng_2b5c91f0d4c1",
  deviceId: "dev_mbp_01",
  tier: "B" as const,
};

function load(): ContinueEditOutcomeLine[] {
  const raw = readFileSync(join(FIX, "editOutcome.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ContinueEditOutcomeLine);
}

test("each editOutcome row emits one code_edit_proposed + one code_edit_decision", () => {
  const lines = load();
  const events = normalizeEditOutcome(lines, id, "0.2.0");
  expect(events.length).toBe(lines.length * 2);
  const proposed = events.filter((e) => e.dev_metrics.event_kind === "code_edit_proposed");
  const decided = events.filter((e) => e.dev_metrics.event_kind === "code_edit_decision");
  expect(proposed.length).toBe(lines.length);
  expect(decided.length).toBe(lines.length);
});

test("D23 native accept signal lands as edit_decision='accept'", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  const accepts = events.filter((e) => e.dev_metrics.edit_decision === "accept");
  expect(accepts.length).toBeGreaterThanOrEqual(1);
  for (const e of accepts) {
    expect(e.dev_metrics.event_kind).toBe("code_edit_decision");
  }
});

test("D23 native reject signal lands as edit_decision='reject'", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  const rejects = events.filter((e) => e.dev_metrics.edit_decision === "reject");
  expect(rejects.length).toBeGreaterThanOrEqual(1);
});

test("hunk_sha256 + file_path_hash flow through (accepted-hunk attribution per §8.5)", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  const accepted = events.find((e) => e.dev_metrics.edit_decision === "accept");
  expect(accepted?.dev_metrics.hunk_sha256).toBeDefined();
  expect(accepted?.dev_metrics.file_path_hash).toBeDefined();
});

test("decisionLatencyMs becomes duration_ms on the decision event", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  const withLatency = events.find(
    (e) => e.dev_metrics.event_kind === "code_edit_decision" && e.dev_metrics.duration_ms != null,
  );
  expect(withLatency?.dev_metrics.duration_ms).toBe(820);
});

test("missing accepted defaults to reject (defensive — never accept silently)", () => {
  const lines: ContinueEditOutcomeLine[] = [
    { sessionId: "s1", editId: "e1", hunkSha256: "abc", filePathHash: "def" },
  ];
  const events = normalizeEditOutcome(lines, id, "0.2.0");
  const decision = events.find((e) => e.dev_metrics.event_kind === "code_edit_decision");
  expect(decision?.dev_metrics.edit_decision).toBe("reject");
});

test("every event passes EventSchema.safeParse", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  for (const e of events) expect(EventSchema.safeParse(e).success).toBe(true);
});

test("client_event_id determinism — proposed and decision get distinct ids per row", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  const ids = new Set(events.map((e) => e.client_event_id));
  expect(ids.size).toBe(events.length);
});

test("tier honors identity (D7 default Tier B)", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  for (const e of events) expect(e.tier).toBe("B");
});

test("source='continue' and fidelity='full' on every event", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  for (const e of events) {
    expect(e.source).toBe("continue");
    expect(e.fidelity).toBe("full");
  }
});

test("forbidden fields never appear on edit events", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  const forbidden = ["prompt_text", "tool_input", "tool_output"];
  for (const e of events)
    for (const k of forbidden) expect((e as Record<string, unknown>)[k]).toBeUndefined();
});

test("event_seq is sequential within the stream's emission order", () => {
  const events = normalizeEditOutcome(load(), id, "0.2.0");
  for (let i = 1; i < events.length; i++) {
    expect(events[i]?.event_seq ?? 0).toBeGreaterThan(events[i - 1]?.event_seq ?? -1);
  }
});
