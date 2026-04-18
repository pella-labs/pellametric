import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext, Logger } from "@bematist/sdk";
import { buildOpenCodeDb } from "./fixtures/build-sqlite";
import { OpenCodeAdapter } from "./index";

interface CapturedLog {
  level: "warn" | "info" | "error";
  msg: string;
  bindings?: Record<string, unknown>;
}

function mkLog(captured: CapturedLog[]): Logger {
  const log: Logger = {
    trace: () => {},
    debug: () => {},
    info: (msg, bindings) => captured.push({ level: "info", msg, bindings: bindings as never }),
    warn: (msg, bindings) => captured.push({ level: "warn", msg, bindings: bindings as never }),
    error: (msg, bindings) => captured.push({ level: "error", msg, bindings: bindings as never }),
    fatal: () => {},
    child: () => log,
  };
  return log;
}

function mkCtx(captured: CapturedLog[] = []): AdapterContext {
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log: mkLog(captured),
    tier: "B",
    cursor: {
      get: async () => null,
      set: async () => {},
    },
  };
}

function withDataDir<T>(setup: (dir: string) => void, fn: () => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "bematist-oc-it-"));
  const prev = process.env.OPENCODE_DATA_DIR;
  process.env.OPENCODE_DATA_DIR = dir;
  setup(dir);
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });
}

test("OpenCodeAdapter type-checks against the Adapter interface", () => {
  const a: Adapter = new OpenCodeAdapter({
    tenantId: "o",
    engineerId: "e",
    deviceId: "d",
  });
  expect(a.id).toBe("opencode");
  expect(a.label).toBe("OpenCode");
  expect(a.supportedSourceVersions).toBe(">=1.2.0");
});

test("poll() returns [] when neither SQLite nor legacy dir exists", async () => {
  const prev = process.env.OPENCODE_DATA_DIR;
  try {
    process.env.OPENCODE_DATA_DIR = "/nonexistent/opencode/path/test";
    const a = new OpenCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
    const ctx = mkCtx();
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    expect(events).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prev;
  }
});

test("health() reports fidelity='post-migration' per CLAUDE.md §Adapter Matrix", async () => {
  const prev = process.env.OPENCODE_DATA_DIR;
  try {
    process.env.OPENCODE_DATA_DIR = "/nonexistent/opencode/health/path";
    const a = new OpenCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
    const ctx = mkCtx();
    await a.init(ctx);
    const h = await a.health(ctx);
    expect(h.fidelity).toBe("post-migration");
    expect(h.status).toBe("disabled");
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_DATA_DIR;
    else process.env.OPENCODE_DATA_DIR = prev;
  }
});

test("poll() reads post-v1.2 SQLite fixture and emits canonical Events", async () => {
  await withDataDir(
    (dir) => buildOpenCodeDb(join(dir, "storage.sqlite")),
    async () => {
      const a = new OpenCodeAdapter({
        tenantId: "org_t",
        engineerId: "eng_t",
        deviceId: "dev_t",
      });
      const ctx = mkCtx();
      await a.init(ctx);
      const events = await a.poll(ctx, new AbortController().signal);
      expect(events.length).toBeGreaterThan(0);
      const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
      expect(kinds.has("session_start")).toBe(true);
      expect(kinds.has("llm_response")).toBe(true);
      expect(kinds.has("tool_call")).toBe(true);
      expect(kinds.has("tool_result")).toBe(true);
      expect(kinds.has("session_end")).toBe(true);
      expect(events.every((e) => e.source === "opencode")).toBe(true);
      expect(events.every((e) => e.fidelity === "post-migration")).toBe(true);
    },
  );
});

test("pre-v1.2 sharded JSON sessions are skipped with the exact warn line", async () => {
  const captured: CapturedLog[] = [];
  await withDataDir(
    (dir) => {
      // Two pre-v1.2 sessions, no SQLite (orphaned by issue 13654).
      mkdirSync(join(dir, "storage", "session", "sess_legacy_1"), { recursive: true });
      mkdirSync(join(dir, "storage", "session", "sess_legacy_2"), { recursive: true });
    },
    async () => {
      const a = new OpenCodeAdapter({
        tenantId: "org_t",
        engineerId: "eng_t",
        deviceId: "dev_t",
      });
      const ctx = mkCtx(captured);
      await a.init(ctx);
      const events = await a.poll(ctx, new AbortController().signal);
      expect(events).toEqual([]);
      const skipWarnings = captured.filter(
        (l) => l.level === "warn" && l.msg === "opencode: pre-v1.2 session skipped",
      );
      expect(skipWarnings.length).toBe(2);
      expect(a.getSkippedCount()).toBe(2);
      const ids = skipWarnings
        .map((w) => (w.bindings as { sessionId?: string } | undefined)?.sessionId)
        .filter(Boolean)
        .sort();
      expect(ids).toEqual(["sess_legacy_1", "sess_legacy_2"]);
    },
  );
});

test("re-poll does not double-count skipped sessions (idempotent counter)", async () => {
  const captured: CapturedLog[] = [];
  await withDataDir(
    (dir) => {
      mkdirSync(join(dir, "storage", "session", "sess_legacy_dup"), { recursive: true });
    },
    async () => {
      const a = new OpenCodeAdapter({
        tenantId: "org_t",
        engineerId: "eng_t",
        deviceId: "dev_t",
      });
      const ctx = mkCtx(captured);
      await a.init(ctx);
      await a.poll(ctx, new AbortController().signal);
      await a.poll(ctx, new AbortController().signal);
      await a.poll(ctx, new AbortController().signal);
      expect(a.getSkippedCount()).toBe(1);
      const skipWarnings = captured.filter(
        (l) => l.level === "warn" && l.msg === "opencode: pre-v1.2 session skipped",
      );
      expect(skipWarnings.length).toBe(1);
    },
  );
});

test("mixed install (issue 13654): SQLite events ship + legacy sessions skipped", async () => {
  const captured: CapturedLog[] = [];
  await withDataDir(
    (dir) => {
      buildOpenCodeDb(join(dir, "storage.sqlite"));
      mkdirSync(join(dir, "storage", "session", "sess_orphaned"), { recursive: true });
    },
    async () => {
      const a = new OpenCodeAdapter({
        tenantId: "org_t",
        engineerId: "eng_t",
        deviceId: "dev_t",
      });
      const ctx = mkCtx(captured);
      await a.init(ctx);
      const events = await a.poll(ctx, new AbortController().signal);
      expect(events.length).toBeGreaterThan(0);
      expect(a.getSkippedCount()).toBe(1);
      const health = await a.health(ctx);
      expect(health.status).toBe("ok");
      expect(health.caveats?.some((c) => c.includes("1 pre-v1.2 session"))).toBe(true);
    },
  );
});

test("golden opencode fixture loads and every line is a valid Event", () => {
  const events = loadFixture("opencode");
  expect(events.length).toBeGreaterThanOrEqual(10);
  expect(events[0]?.dev_metrics.event_kind).toBe("session_start");
  expect(events.at(-1)?.dev_metrics.event_kind).toBe("session_end");
  expect(events.every((e) => e.source === "opencode")).toBe(true);
  expect(events.every((e) => e.fidelity === "post-migration")).toBe(true);
  expect(events.every((e) => e.tier === "B")).toBe(true);
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
