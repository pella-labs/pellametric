import { expect, test } from "bun:test";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { ClaudeCodeAdapter } from "./index";

function mkCtx(): AdapterContext {
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
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log,
    tier: "B",
    cursor: {
      get: async () => null,
      set: async () => {},
    },
  };
}

test("ClaudeCodeAdapter type-checks against the Adapter interface", () => {
  const a: Adapter = new ClaudeCodeAdapter({
    tenantId: "o",
    engineerId: "e",
    deviceId: "d",
  });
  expect(a.id).toBe("claude-code");
  expect(a.label).toBe("Claude Code");
});

test("poll() returns [] when no JSONL dir exists", async () => {
  const originalDir = process.env.CLAUDE_CONFIG_DIR;
  try {
    // Point to a non-existent path to avoid reading real session files
    process.env.CLAUDE_CONFIG_DIR = "/nonexistent/path/for/test";
    const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
    const ctx = mkCtx();
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    expect(events).toEqual([]);
  } finally {
    if (originalDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  }
});

test("health() reports fidelity='full' per CLAUDE.md §Adapter Matrix", async () => {
  const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
  const ctx = mkCtx();
  await a.init(ctx);
  const h = await a.health(ctx);
  expect(h.fidelity).toBe("full");
  expect(["ok", "disabled"]).toContain(h.status);
});

test("golden claude-code fixture loads and every line is a valid Event", () => {
  const events = loadFixture("claude-code");
  expect(events.length).toBeGreaterThanOrEqual(10);
  expect(events.length).toBeLessThanOrEqual(20);
  expect(events[0]?.dev_metrics.event_kind).toBe("session_start");
  expect(events.at(-1)?.dev_metrics.event_kind).toBe("session_end");
  // Required coverage per B-seed spec.
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of [
    "session_start",
    "llm_request",
    "llm_response",
    "tool_call",
    "tool_result",
    "code_edit_proposed",
    "code_edit_decision",
    "session_end",
  ]) {
    expect(kinds.has(k as never)).toBe(true);
  }
  const accepts = events.filter(
    (e) =>
      e.dev_metrics.event_kind === "code_edit_decision" && e.dev_metrics.edit_decision === "accept",
  );
  expect(accepts.length).toBeGreaterThanOrEqual(1);
  // Tier B invariant for seed fixture.
  expect(events.every((e) => e.tier === "B")).toBe(true);
});

test("poll() skips files whose (size, mtime) signature is unchanged since last emit", async () => {
  // Regression test for the M4 rehearsal drift bug: previously every poll
  // re-parsed and re-emitted every JSONL file, causing duplicate INSERTs
  // that inflated `dev_daily_rollup` MV state even though ReplacingMergeTree
  // deduped the raw events. Adapter now records `signature:<path>` and
  // returns [] for unchanged files.
  const dir = require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "bematist-cc-skip-"),
  );
  const sub = require("node:path").join(dir, "projects", "proj-a", "sessions");
  require("node:fs").mkdirSync(sub, { recursive: true });
  const srcFix = require("node:path").join(__dirname, "fixtures", "real-session.jsonl");
  require("node:fs").copyFileSync(srcFix, require("node:path").join(sub, "s1.jsonl"));

  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = dir;
    const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
    // In-memory cursor store so poll N+1 sees poll N's writes.
    const store = new Map<string, string>();
    const ctx: AdapterContext = {
      ...mkCtx(),
      cursor: {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => {
          store.set(k, v);
        },
      },
    };
    await a.init(ctx);

    const first = await a.poll(ctx, new AbortController().signal);
    expect(first.length).toBeGreaterThan(0);

    // Second poll, file unchanged — must emit zero events.
    const second = await a.poll(ctx, new AbortController().signal);
    expect(second).toEqual([]);

    // Third poll after mutating mtime forward — must re-emit.
    const filePath = require("node:path").join(sub, "s1.jsonl");
    const future = new Date(Date.now() + 60_000);
    require("node:fs").utimesSync(filePath, future, future);
    const third = await a.poll(ctx, new AbortController().signal);
    expect(third.length).toBeGreaterThan(0);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  }
});

test("poll() reads real-session fixture and emits canonical Events", async () => {
  const dir = require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "bematist-cc-poll-"),
  );
  // Mirror the fixture shape under dir/projects/<proj>/sessions/<file>.jsonl.
  const sub = require("node:path").join(dir, "projects", "proj-a", "sessions");
  require("node:fs").mkdirSync(sub, { recursive: true });
  const srcFix = require("node:path").join(__dirname, "fixtures", "real-session.jsonl");
  require("node:fs").copyFileSync(srcFix, require("node:path").join(sub, "s1.jsonl"));

  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = dir;
    const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
    const ctx = mkCtx();
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);

    expect(events.length).toBeGreaterThan(0);
    const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
    expect(kinds.has("session_start")).toBe(true);
    expect(kinds.has("llm_response")).toBe(true);
    expect(kinds.has("session_end")).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  }
});
