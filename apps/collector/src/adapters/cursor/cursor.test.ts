import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { CursorAdapter } from "./index";

function mkCtx(initialCursor?: Record<string, string>): AdapterContext {
  const noop = () => {};
  const log = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => log,
  };
  const store = new Map<string, string>(Object.entries(initialCursor ?? {}));
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log,
    tier: "B",
    cursor: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
}

function fixtureDb(): string {
  return resolve(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "fixtures",
    "cursor",
    "state.vscdb",
  );
}

test("CursorAdapter implements the Adapter interface and identifies itself", () => {
  const a: Adapter = new CursorAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
  expect(a.id).toBe("cursor");
  expect(a.label).toBe("Cursor");
});

test("poll() returns [] when state.vscdb does not exist", async () => {
  const prev = process.env.CURSOR_STATE_DB;
  try {
    process.env.CURSOR_STATE_DB = "/nonexistent/state.vscdb";
    const a = new CursorAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
    const ctx = mkCtx();
    await a.init(ctx);
    expect(await a.poll(ctx, new AbortController().signal)).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_STATE_DB;
    else process.env.CURSOR_STATE_DB = prev;
  }
});

test("poll() returns [] without crashing on a corrupt state.vscdb", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-corrupt-"));
  try {
    const bad = join(dir, "state.vscdb");
    writeFileSync(bad, "this is not sqlite");
    const prev = process.env.CURSOR_STATE_DB;
    try {
      process.env.CURSOR_STATE_DB = bad;
      const a = new CursorAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
      const ctx = mkCtx();
      await a.init(ctx);
      const events = await a.poll(ctx, new AbortController().signal);
      expect(events).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.CURSOR_STATE_DB;
      else process.env.CURSOR_STATE_DB = prev;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("poll() against the golden state.vscdb emits canonical events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-poll-"));
  try {
    const dest = join(dir, "state.vscdb");
    copyFileSync(fixtureDb(), dest);
    const prev = process.env.CURSOR_STATE_DB;
    try {
      process.env.CURSOR_STATE_DB = dest;
      const a = new CursorAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
      const ctx = mkCtx();
      await a.init(ctx);
      const events = await a.poll(ctx, new AbortController().signal);
      expect(events.length).toBeGreaterThan(0);
      const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
      expect(kinds.has("session_start")).toBe(true);
      expect(kinds.has("llm_request")).toBe(true);
      expect(kinds.has("llm_response")).toBe(true);
      expect(kinds.has("session_end")).toBe(true);
      expect(events.every((e) => e.source === "cursor")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CURSOR_STATE_DB;
      else process.env.CURSOR_STATE_DB = prev;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("poll() advances the unix-ms cursor and returns nothing on a second pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-poll-cursor-"));
  try {
    const dest = join(dir, "state.vscdb");
    copyFileSync(fixtureDb(), dest);
    const prev = process.env.CURSOR_STATE_DB;
    try {
      process.env.CURSOR_STATE_DB = dest;
      const a = new CursorAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
      const ctx = mkCtx();
      await a.init(ctx);
      const first = await a.poll(ctx, new AbortController().signal);
      expect(first.length).toBeGreaterThan(0);
      const second = await a.poll(ctx, new AbortController().signal);
      expect(second).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.CURSOR_STATE_DB;
      else process.env.CURSOR_STATE_DB = prev;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("health() reports disabled when no state.vscdb is present", async () => {
  const prev = process.env.CURSOR_STATE_DB;
  try {
    process.env.CURSOR_STATE_DB = "/nonexistent/path/state.vscdb";
    const a = new CursorAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx();
    await a.init(ctx);
    const h = await a.health(ctx);
    expect(h.status).toBe("disabled");
    expect(h.fidelity).toBe("estimated");
  } finally {
    if (prev === undefined) delete process.env.CURSOR_STATE_DB;
    else process.env.CURSOR_STATE_DB = prev;
  }
});

test("health() flips to fidelity='estimated' after seeing Auto-mode rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cursor-health-"));
  try {
    const dest = join(dir, "state.vscdb");
    copyFileSync(fixtureDb(), dest);
    const prev = process.env.CURSOR_STATE_DB;
    try {
      process.env.CURSOR_STATE_DB = dest;
      const a = new CursorAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
      const ctx = mkCtx();
      await a.init(ctx);
      await a.poll(ctx, new AbortController().signal);
      const h = await a.health(ctx);
      expect(h.status).toBe("ok");
      expect(h.fidelity).toBe("estimated");
      expect(h.caveats?.some((c) => c.includes("cost_estimated"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CURSOR_STATE_DB;
      else process.env.CURSOR_STATE_DB = prev;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("golden cursor fixture matches the EventSchema and includes both fidelity tiers", () => {
  const events = loadFixture("cursor");
  expect(events.length).toBeGreaterThanOrEqual(10);
  const fidelities = new Set(events.map((e) => e.fidelity));
  expect(fidelities.has("full")).toBe(true);
  expect(fidelities.has("estimated")).toBe(true);
  expect(events.some((e) => e.cost_estimated === true)).toBe(true);
  expect(events.every((e) => e.source === "cursor")).toBe(true);
});

test("golden cursor fixture covers required event kinds", () => {
  const events = loadFixture("cursor");
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of ["session_start", "llm_request", "llm_response", "tool_result", "session_end"]) {
    expect(kinds.has(k as never)).toBe(true);
  }
});

test("Auto-mode tool_result with status=error sets first_try_failure=true in golden fixture", () => {
  const events = loadFixture("cursor");
  const errs = events.filter(
    (e) => e.dev_metrics.event_kind === "tool_result" && e.dev_metrics.first_try_failure === true,
  );
  expect(errs.length).toBeGreaterThanOrEqual(1);
});
