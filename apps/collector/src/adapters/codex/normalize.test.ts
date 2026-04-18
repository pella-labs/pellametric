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
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  for (const e of events) {
    const r = EventSchema.safeParse(e);
    expect(r.success).toBe(true);
  }
});

test("event_kind coverage includes session lifecycle, LLM turns, exec, and patch kinds", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of [
    "session_start",
    "session_end",
    "llm_request",
    "llm_response",
    "exec_command_start",
    "exec_command_end",
    "patch_apply_start",
    "patch_apply_end",
  ]) {
    expect(kinds.has(k as never)).toBe(true);
  }
});

test("exec_command_end with exit_code != 0 labels first_try_failure=true (D17 firstTryRate)", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  const failed = events.find(
    (e) => e.dev_metrics.event_kind === "exec_command_end" && e.dev_metrics.tool_status === "error",
  );
  expect(failed).toBeDefined();
  expect(failed?.dev_metrics.first_try_failure).toBe(true);
});

test("patch_apply_end with success=false labels first_try_failure=true (D17 firstTryRate)", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  const failed = events.find(
    (e) => e.dev_metrics.event_kind === "patch_apply_end" && e.dev_metrics.tool_status === "error",
  );
  expect(failed).toBeDefined();
  expect(failed?.dev_metrics.first_try_failure).toBe(true);
});

test("llm_response stamps pricing_version and cost_usd derived from diffed per-turn tokens", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  const resp = events.find((e) => e.dev_metrics.event_kind === "llm_response");
  expect(resp?.dev_metrics.pricing_version).toMatch(/^litellm@/);
  expect(resp?.dev_metrics.cost_usd ?? 0).toBeGreaterThan(0);
});

test("client_event_id is deterministic — same input yields identical ids", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const a = normalizeSession(parsed, baseIdentity, "0.1.0");
  const b = normalizeSession(parsed, baseIdentity, "0.1.0");
  expect(a.map((e) => e.client_event_id)).toEqual(b.map((e) => e.client_event_id));
});

test("tier defaults to 'B' per CLAUDE.md D7 default", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  for (const e of events) expect(e.tier).toBe("B");
});

test("fidelity is always 'full' for codex per CLAUDE.md Adapter Matrix", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  for (const e of events) expect(e.fidelity).toBe("full");
});

test("forbidden fields never appear on emitted Tier B events", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  const forbidden = ["prompt_text", "tool_input", "tool_output"];
  for (const e of events) {
    for (const k of forbidden) {
      expect((e as Record<string, unknown>)[k]).toBeUndefined();
    }
  }
});

test("event_seq is strictly monotonic across the rollout", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  for (let i = 1; i < events.length; i++) {
    expect(events[i]?.event_seq ?? 0).toBeGreaterThan(events[i - 1]?.event_seq ?? 0);
  }
});

test("successful exec_command_end (exit_code=0) is NOT labelled a first-try failure", async () => {
  const parsed = await parseSessionFile(join(FIX, "rollout-real.jsonl"));
  const events = normalizeSession(parsed, baseIdentity, "0.1.0");
  const ok = events.find(
    (e) => e.dev_metrics.event_kind === "exec_command_end" && e.dev_metrics.tool_status === "ok",
  );
  expect(ok).toBeDefined();
  expect(ok?.dev_metrics.first_try_failure).toBeUndefined();
});
