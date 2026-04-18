import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import { buildOpenCodeDb } from "./fixtures/build-sqlite";
import { normalizeSession } from "./normalize";
import { readAllSessions } from "./sqlite";

const baseIdentity = {
  tenantId: "org_acme",
  engineerId: "eng_test",
  deviceId: "dev_test",
  tier: "B" as const,
};

function loadFixturePayloads() {
  const dir = mkdtempSync(join(tmpdir(), "bematist-oc-norm-"));
  const dbPath = join(dir, "storage.sqlite");
  buildOpenCodeDb(dbPath);
  try {
    return {
      payloads: readAllSessions(dbPath),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

test("every produced event passes EventSchema validation", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    const events = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
    for (const e of events) {
      const r = EventSchema.safeParse(e);
      expect(r.success).toBe(true);
    }
  } finally {
    cleanup();
  }
});

test("event_kind coverage includes session_start, llm_request, llm_response, tool_call, tool_result, session_end", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    const events = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
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
  } finally {
    cleanup();
  }
});

test("llm_response stamps pricing_version when cost_usd is present", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    const events = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
    const responses = events.filter((e) => e.dev_metrics.event_kind === "llm_response");
    expect(responses.length).toBeGreaterThan(0);
    for (const r of responses) {
      expect(r.dev_metrics.cost_usd ?? 0).toBeGreaterThan(0);
      expect(r.dev_metrics.pricing_version).toMatch(/^litellm@/);
    }
  } finally {
    cleanup();
  }
});

test("client_event_id is deterministic — same input yields same ids", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    const a = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
    const b = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
    expect(a.map((e) => e.client_event_id)).toEqual(b.map((e) => e.client_event_id));
  } finally {
    cleanup();
  }
});

test("event_seq is monotonic within a session", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    for (const p of payloads) {
      const events = normalizeSession(p, baseIdentity, "1.2.3");
      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1]?.event_seq ?? -1;
        const cur = events[i]?.event_seq ?? -1;
        expect(cur).toBeGreaterThan(prev);
      }
    }
  } finally {
    cleanup();
  }
});

test("fidelity is always 'post-migration' for opencode (per CLAUDE.md §Adapter Matrix)", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    const events = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
    for (const e of events) expect(e.fidelity).toBe("post-migration");
  } finally {
    cleanup();
  }
});

test("forbidden fields never appear on emitted events (Tier B)", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    const events = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
    const forbidden = ["prompt_text", "tool_input", "tool_output"];
    for (const e of events) {
      for (const k of forbidden) {
        expect((e as Record<string, unknown>)[k]).toBeUndefined();
      }
    }
  } finally {
    cleanup();
  }
});

test("tool_result with status='error' sets first_try_failure=true (D17 cross-agent label)", () => {
  const { payloads, cleanup } = loadFixturePayloads();
  try {
    const events = payloads.flatMap((p) => normalizeSession(p, baseIdentity, "1.2.3"));
    const errored = events.filter(
      (e) => e.dev_metrics.event_kind === "tool_result" && e.dev_metrics.tool_status === "error",
    );
    expect(errored.length).toBeGreaterThan(0);
    for (const e of errored) {
      expect(e.dev_metrics.first_try_failure).toBe(true);
    }
  } finally {
    cleanup();
  }
});
