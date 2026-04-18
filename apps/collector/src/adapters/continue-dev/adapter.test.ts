import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { ContinueDevAdapter, cursorKey } from "./index";
import { CONTINUE_STREAM_NAMES } from "./paths";

function mkCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
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
  const cursorMap = new Map<string, string>();
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log,
    tier: "B",
    cursor: {
      get: async (k: string) => cursorMap.get(k) ?? null,
      set: async (k: string, v: string) => {
        cursorMap.set(k, v);
      },
    },
    ...overrides,
  };
}

function withFixturesDir<T>(fn: (devData: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "bematist-cont-poll-"));
  const devData = join(dir, "dev_data", "0.2.0");
  mkdirSync(devData, { recursive: true });
  const src = join(import.meta.dir, "fixtures");
  for (const stream of CONTINUE_STREAM_NAMES) {
    copyFileSync(join(src, `${stream}.jsonl`), join(devData, `${stream}.jsonl`));
  }
  const prev = process.env.BEMATIST_CONTINUE_DIR;
  process.env.BEMATIST_CONTINUE_DIR = dir;
  return fn(devData).finally(() => {
    if (prev === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });
}

test("ContinueDevAdapter type-checks against the Adapter interface", () => {
  const a: Adapter = new ContinueDevAdapter({
    tenantId: "o",
    engineerId: "e",
    deviceId: "d",
  });
  expect(a.id).toBe("continue");
  expect(a.label).toBe("Continue.dev");
  expect(a.supportedSourceVersions).toBeTruthy();
});

test("poll() returns [] when dev_data dir is missing", async () => {
  const prev = process.env.BEMATIST_CONTINUE_DIR;
  try {
    process.env.BEMATIST_CONTINUE_DIR = "/nonexistent/continue/path";
    const a = new ContinueDevAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx();
    await a.init(ctx);
    expect(await a.poll(ctx, new AbortController().signal)).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prev;
  }
});

test("poll() reads all 4 streams and emits the expected canonical Event[]", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    const ctx = mkCtx();
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
    for (const k of [
      "llm_request",
      "llm_response",
      "code_edit_proposed",
      "code_edit_decision",
      "tool_call",
      "tool_result",
    ]) {
      expect(kinds.has(k as never)).toBe(true);
    }
    expect(events.every((e) => e.source === "continue")).toBe(true);
    expect(events.every((e) => e.fidelity === "full")).toBe(true);
  });
});

test("poll() advances per-stream cursors and a second poll returns []", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    const ctx = mkCtx();
    await a.init(ctx);
    const first = await a.poll(ctx, new AbortController().signal);
    expect(first.length).toBeGreaterThan(0);
    for (const stream of CONTINUE_STREAM_NAMES) {
      const v = await ctx.cursor.get(cursorKey(stream));
      expect(v).toBeDefined();
      expect(Number.parseInt(v ?? "0", 10)).toBeGreaterThan(0);
    }
    const second = await a.poll(ctx, new AbortController().signal);
    expect(second.length).toBe(0);
  });
});

test("each stream owns a distinct cursor key", () => {
  const keys = new Set(CONTINUE_STREAM_NAMES.map(cursorKey));
  expect(keys.size).toBe(4);
  for (const k of keys) expect(k.startsWith("offset:continue:")).toBe(true);
});

test("health() reports fidelity='full' and 'ok' when streams are present", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx();
    await a.init(ctx);
    const h = await a.health(ctx);
    expect(h.fidelity).toBe("full");
    expect(h.status).toBe("ok");
  });
});

test("health() reports 'disabled' when dev_data dir does not exist", async () => {
  const prev = process.env.BEMATIST_CONTINUE_DIR;
  try {
    process.env.BEMATIST_CONTINUE_DIR = "/no/where/at/all";
    const a = new ContinueDevAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx();
    await a.init(ctx);
    const h = await a.health(ctx);
    expect(h.status).toBe("disabled");
    expect(h.caveats?.length ?? 0).toBeGreaterThan(0);
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_CONTINUE_DIR;
    else process.env.BEMATIST_CONTINUE_DIR = prev;
  }
});

test("poll honors ctx.tier — Tier-A identity flows to every emitted event", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({
      tenantId: "org_a",
      engineerId: "eng_a",
      deviceId: "dev_a",
    });
    const ctx = mkCtx({ tier: "A" });
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.tier).toBe("A");
  });
});

test("golden continue-dev fixture loads, has all 6 event kinds, and matches D7 default tier", () => {
  const events = loadFixture("continue-dev");
  expect(events.length).toBeGreaterThanOrEqual(20);
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of [
    "llm_request",
    "llm_response",
    "code_edit_proposed",
    "code_edit_decision",
    "tool_call",
    "tool_result",
  ]) {
    expect(kinds.has(k as never)).toBe(true);
  }
  // D23 native accept signal is captured.
  expect(
    events.some(
      (e) =>
        e.dev_metrics.event_kind === "code_edit_decision" &&
        e.dev_metrics.edit_decision === "accept",
    ),
  ).toBe(true);
  // D7 default tier honored in the canonical fixture.
  expect(events.every((e) => e.tier === "B")).toBe(true);
  expect(events.every((e) => e.source === "continue")).toBe(true);
});

test("incremental poll surfaces only newly appended lines, not previously consumed ones", async () => {
  await withFixturesDir(async (devData) => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    const ctx = mkCtx();
    await a.init(ctx);
    await a.poll(ctx, new AbortController().signal);
    // Append a new chatInteraction row and poll again.
    const newRow = `${JSON.stringify({
      eventName: "chat",
      sessionId: "sess_cont_03",
      interactionId: "int_99",
      role: "user",
      modelTitle: "claude-sonnet-4-5",
      timestamp: "2026-04-16T12:00:00.000Z",
    })}\n`;
    require("node:fs").appendFileSync(join(devData, "chatInteraction.jsonl"), newRow);
    const next = await a.poll(ctx, new AbortController().signal);
    expect(next.length).toBe(1);
    expect(next[0]?.session_id).toBe("sess_cont_03");
    expect(next[0]?.dev_metrics.event_kind).toBe("llm_request");
  });
});
