import { expect, test } from "bun:test";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { collectPoll } from "../../test-helpers";
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
    const events = await collectPoll(a, ctx);
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

    const first = await collectPoll(a, ctx);
    expect(first.length).toBeGreaterThan(0);

    // Second poll, file unchanged — must emit zero events.
    const second = await collectPoll(a, ctx);
    expect(second).toEqual([]);

    // Third poll after bumping mtime (file same size/content, just touched) —
    // re-parses but max_seq filter should still emit zero.
    const filePath = require("node:path").join(sub, "s1.jsonl");
    const future = new Date(Date.now() + 60_000);
    require("node:fs").utimesSync(filePath, future, future);
    const third = await collectPoll(a, ctx);
    expect(third).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  }
});

test("poll() walks into subagents/ subdirectories so their token cost is attributed", async () => {
  // Claude Code Task-tool spawns write subagent JSONL files under
  // <project>/<sessionId>/subagents/agent-*.jsonl. The `sessionId` field
  // inside every subagent line is the PARENT conversation's sessionId — so
  // the events produced share the parent's session_id and add tokens + cost
  // to that session rather than creating fresh ones.
  //
  // This test guards against accidentally re-introducing the skip that
  // landed in 57e8c02 (and got reverted when we realized the cost data was
  // being lost). It asserts both that subagent files are visited AND that
  // the emitted events carry the parent's session_id.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const os = require("node:os") as typeof import("node:os");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bematist-cc-subagent-"));
  const proj = path.join(dir, "projects", "proj-sa");
  const subagents = path.join(proj, "subagents");
  fs.mkdirSync(subagents, { recursive: true });

  // Parent file + subagent file — both use the same real-session fixture,
  // which has sessionId "55e2a90f-3c02-4ede-a2ad-95ad7c8cb01d" baked in.
  // That mirrors the on-disk reality: every subagent JSONL's sessionId ==
  // its parent's sessionId.
  fs.copyFileSync(
    path.join(__dirname, "fixtures", "real-session.jsonl"),
    path.join(proj, "parent.jsonl"),
  );
  fs.copyFileSync(
    path.join(__dirname, "fixtures", "real-session.jsonl"),
    path.join(subagents, "agent-abc123.jsonl"),
  );

  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = dir;
    const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
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
    const events = await collectPoll(a, ctx);

    // Both files should have produced events (the adapter walked into
    // subagents/). Each file emits >0 events from the real-session fixture.
    expect(events.length).toBeGreaterThan(0);

    // The cursor should have signatures for BOTH files — proves the walk
    // descended into the subagents/ subdirectory.
    const signatureKeys = Array.from(store.keys()).filter((k) => k.startsWith("signature:"));
    expect(signatureKeys.length).toBe(2);
    expect(signatureKeys.some((k) => k.includes("parent.jsonl"))).toBe(true);
    expect(signatureKeys.some((k) => k.includes("subagents"))).toBe(true);

    // All emitted events share the same session_id (the parent's), since
    // both files' JSONL content contains the same sessionId field.
    const uniqueSessionIds = new Set(events.map((e) => e.session_id));
    expect(uniqueSessionIds.size).toBe(1);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("poll() emits ONLY new events when a session file grows (active-session case)", async () => {
  // Regression test for M4 rehearsal drift: Sandesh's MV grew 3× faster
  // than raw events because an actively-coding session file kept passing
  // the (size, mtime) gate but normalizeSession re-emitted every event in
  // it, leaking duplicates through Redis SETNX into `dev_daily_rollup`.
  // Adapter now also tracks per-file `max_seq:<path>` and filters events
  // with seq ≤ prevMax.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const os = require("node:os") as typeof import("node:os");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bematist-cc-grow-"));
  const sub = path.join(dir, "projects", "proj-grow", "sessions");
  fs.mkdirSync(sub, { recursive: true });
  const sessionFile = path.join(sub, "s1.jsonl");

  // First write: two user turns + two assistant turns.
  const baseLines = [
    JSON.stringify({
      type: "user",
      sessionId: "s1",
      timestamp: "2026-04-18T10:00:00.000Z",
      message: { role: "user", content: "hello" },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-04-18T10:00:01.000Z",
      requestId: "r1",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }),
  ];
  fs.writeFileSync(sessionFile, `${baseLines.join("\n")}\n`);

  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = dir;
    const a = new ClaudeCodeAdapter({ tenantId: "org_t", engineerId: "eng_t", deviceId: "dev_t" });
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

    const first = await collectPoll(a, ctx);
    const firstSeqs = first.map((e) => e.event_seq).sort((a, b) => a - b);
    expect(firstSeqs.length).toBeGreaterThan(0);
    const maxSeqAfterFirst = Math.max(...firstSeqs);

    // Append another turn — file grows, mtime changes.
    fs.appendFileSync(
      sessionFile,
      `${JSON.stringify({
        type: "user",
        sessionId: "s1",
        timestamp: "2026-04-18T10:00:02.000Z",
        message: { role: "user", content: "again" },
      })}\n`,
    );
    fs.appendFileSync(
      sessionFile,
      `${JSON.stringify({
        type: "assistant",
        sessionId: "s1",
        timestamp: "2026-04-18T10:00:03.000Z",
        requestId: "r2",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "hey" }],
          usage: { input_tokens: 7, output_tokens: 3 },
        },
      })}\n`,
    );
    const future = new Date(Date.now() + 120_000);
    fs.utimesSync(sessionFile, future, future);

    const second = await collectPoll(a, ctx);

    // Every event emitted in the second poll must have a seq strictly
    // greater than the high-water mark from the first poll. This is the
    // invariant that stops MV double-counting.
    expect(second.length).toBeGreaterThan(0);
    for (const e of second) {
      expect(e.event_seq).toBeGreaterThan(maxSeqAfterFirst);
    }
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
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
    const events = await collectPoll(a, ctx);

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
