import { describe, expect, test } from "bun:test";
import type { Ctx } from "../auth";
import { getSession, listSessions } from "./session";

describe("listSessions", () => {
  test("returns deterministic rows with no prompt fields present", async () => {
    const out = await listSessions(makeCtx(), { window: "7d", limit: 500 });
    expect(out.window).toBe("7d");
    expect(out.sessions.length).toBeGreaterThan(0);
    expect(out.sessions.length).toBeLessThanOrEqual(500);

    for (const s of out.sessions) {
      expect(s.session_id).toMatch(/^sess_/);
      expect(s.cost_usd).toBeGreaterThanOrEqual(0);
      expect(s.duration_s).not.toBeNull();
      // prompt-adjacent fields are never present in list rows
      expect(Object.hasOwn(s, "prompt_text")).toBe(false);
      expect(Object.hasOwn(s, "tool_input")).toBe(false);
    }
  });

  test("rows are ordered newest-first", async () => {
    const out = await listSessions(makeCtx(), { window: "7d", limit: 50 });
    for (let i = 1; i < out.sessions.length; i++) {
      const prev = out.sessions[i - 1]!.started_at;
      const curr = out.sessions[i]!.started_at;
      expect(prev.localeCompare(curr)).toBeGreaterThanOrEqual(0);
    }
  });

  test("cursor sessions carry estimated-cost flag or fidelity", async () => {
    const out = await listSessions(makeCtx(), {
      window: "30d",
      source: "cursor",
      limit: 50,
    });
    for (const s of out.sessions) {
      expect(s.source).toBe("cursor");
      // Cursor auto-mode rows are always marked estimated via fidelity,
      // and optionally via the cost_estimated badge.
      expect(s.fidelity === "estimated" || s.cost_estimated === true).toBe(true);
    }
  });

  test("same inputs produce the same rows (deterministic fixture)", async () => {
    const a = await listSessions(makeCtx(), { window: "7d", limit: 30 });
    const b = await listSessions(makeCtx(), { window: "7d", limit: 30 });
    expect(a.sessions.map((s) => s.session_id)).toEqual(b.sessions.map((s) => s.session_id));
  });
});

describe("getSession", () => {
  test("redacts prompt_text when no reveal token is present", async () => {
    const out = await getSession(makeCtx(), { session_id: "sess_demo" });
    expect(out.prompt_text).toBeNull();
    expect(out.redacted_reason).toBe("consent_required");
  });

  test("returns prompt_text stub once reveal_token is on ctx", async () => {
    const out = await getSession(
      { ...makeCtx(), reveal_token: "tok_test" },
      { session_id: "sess_demo" },
    );
    expect(out.prompt_text).not.toBeNull();
    expect(out.redacted_reason).toBe("none");
  });
});

function makeCtx(): Ctx {
  return {
    tenant_id: "test-tenant",
    actor_id: "test-actor",
    role: "manager",
    db: {
      pg: { query: async () => [] },
      ch: { query: async () => [] },
      redis: {
        get: async () => null,
        set: async () => undefined,
        setNx: async () => true,
      },
    },
  };
}
