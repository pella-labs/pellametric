import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext, CursorStore, Logger } from "@bematist/sdk";
import { collectPoll } from "../../test-helpers";
import { buildOpenCodeDb } from "./fixtures/build-sqlite";
import { OpenCodeAdapter } from "./index";

function mkMemoryCursor(): CursorStore & { state: Map<string, string> } {
  const state = new Map<string, string>();
  return {
    state,
    get: async (k) => state.get(k) ?? null,
    set: async (k, v) => {
      state.set(k, v);
    },
  };
}

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
    const events = await collectPoll(a, ctx);
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
      const events = await collectPoll(a, ctx);
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
      const events = await collectPoll(a, ctx);
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
      await collectPoll(a, ctx);
      await collectPoll(a, ctx);
      await collectPoll(a, ctx);
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
      const events = await collectPoll(a, ctx);
      expect(events.length).toBeGreaterThan(0);
      expect(a.getSkippedCount()).toBe(1);
      const health = await a.health(ctx);
      expect(health.status).toBe("ok");
      expect(health.caveats?.some((c) => c.includes("1 pre-v1.2 session"))).toBe(true);
    },
  );
});

test("first poll returns events + sets watermark; second poll returns [] without re-normalizing", async () => {
  await withDataDir(
    (dir) => buildOpenCodeDb(join(dir, "storage.sqlite")),
    async () => {
      const cursor = mkMemoryCursor();
      const a = new OpenCodeAdapter({
        tenantId: "org_t",
        engineerId: "eng_t",
        deviceId: "dev_t",
      });
      const ctx: AdapterContext = {
        dataDir: "/tmp/bematist-test",
        policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
        log: mkLog([]),
        tier: "B",
        cursor,
      };
      await a.init(ctx);

      const first = await collectPoll(a, ctx);
      expect(first.length).toBeGreaterThan(0);
      const watermarkAfterFirst = cursor.state.get("watermark:opencode");
      expect(watermarkAfterFirst).toBeDefined();
      expect(cursor.state.get("inode:opencode")).toBeDefined();

      const second = await collectPoll(a, ctx);
      expect(second).toEqual([]);
      // Watermark must not regress.
      expect(cursor.state.get("watermark:opencode")).toBe(watermarkAfterFirst);
    },
  );
});

test("third poll returns only newly-added sessions past the watermark", async () => {
  await withDataDir(
    (dir) => buildOpenCodeDb(join(dir, "storage.sqlite")),
    async () => {
      const cursor = mkMemoryCursor();
      const a = new OpenCodeAdapter({
        tenantId: "org_t",
        engineerId: "eng_t",
        deviceId: "dev_t",
      });
      const ctx: AdapterContext = {
        dataDir: "/tmp/bematist-test",
        policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
        log: mkLog([]),
        tier: "B",
        cursor,
      };
      await a.init(ctx);

      const first = await collectPoll(a, ctx);
      expect(first.length).toBeGreaterThan(0);
      const second = await collectPoll(a, ctx);
      expect(second).toEqual([]);

      // Inject a new session with time_updated far in the future relative to
      // the fixture so the watermark comparison guarantees it shows up.
      const dbPath = join(process.env.OPENCODE_DATA_DIR as string, "storage.sqlite");
      const db = new Database(dbPath);
      try {
        const futureTs = Date.parse("2030-01-01T00:00:00.000Z");
        db.run("INSERT INTO sessions (id, title, time_created, time_updated) VALUES (?, ?, ?, ?)", [
          "sess_new_after_poll",
          "new one",
          futureTs,
          futureTs,
        ]);
        db.run(
          `INSERT INTO messages (id, session_id, role, provider_id, model_id, time_created,
              input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
              cost_usd, finish_reason)
           VALUES (?, ?, 'user', 'anthropic', 'claude-sonnet-4-5', ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
          ["msg_new_1", "sess_new_after_poll", futureTs + 100],
        );
      } finally {
        db.close();
      }

      const third = await collectPoll(a, ctx);
      const sessionIds = new Set(third.map((e) => e.session_id));
      expect(sessionIds.size).toBe(1);
      expect(sessionIds.has("sess_new_after_poll")).toBe(true);
    },
  );
});

test("watermark resets when the SQLite inode changes (file replaced)", async () => {
  await withDataDir(
    (dir) => buildOpenCodeDb(join(dir, "storage.sqlite")),
    async () => {
      const captured: CapturedLog[] = [];
      const cursor = mkMemoryCursor();
      const a = new OpenCodeAdapter({
        tenantId: "org_t",
        engineerId: "eng_t",
        deviceId: "dev_t",
      });
      const ctx: AdapterContext = {
        dataDir: "/tmp/bematist-test",
        policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
        log: mkLog(captured),
        tier: "B",
        cursor,
      };
      await a.init(ctx);

      const first = await collectPoll(a, ctx);
      expect(first.length).toBeGreaterThan(0);
      const inodeBefore = cursor.state.get("inode:opencode");
      expect(inodeBefore).toBeDefined();

      // Simulate rotation: rebuild the DB at the same path with a fresh inode.
      const dbPath = join(process.env.OPENCODE_DATA_DIR as string, "storage.sqlite");
      unlinkSync(dbPath);
      buildOpenCodeDb(dbPath);

      const second = await collectPoll(a, ctx);
      // After rotation we re-scan everything in the new DB.
      expect(second.length).toBeGreaterThan(0);
      const rotationWarn = captured.find(
        (l) => l.level === "warn" && l.msg === "opencode: sqlite rotated, resetting watermark",
      );
      expect(rotationWarn).toBeDefined();
      const inodeAfter = cursor.state.get("inode:opencode");
      expect(inodeAfter).toBeDefined();
      expect(inodeAfter).not.toBe(inodeBefore);
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
