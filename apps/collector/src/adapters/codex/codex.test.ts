import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext, CursorStore } from "@bematist/sdk";
import { CodexAdapter } from "./index";

function mkCtx(cursor?: CursorStore): AdapterContext {
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
    dataDir: "/tmp/bematist-test-codex",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log,
    tier: "B",
    cursor: cursor ?? {
      get: async () => null,
      set: async () => {},
    },
  };
}

function inMemoryCursor(): CursorStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
  };
}

test("CodexAdapter type-checks against the Adapter interface", () => {
  const a: Adapter = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
  expect(a.id).toBe("codex");
  expect(a.label).toBe("Codex CLI");
});

test("poll() returns [] when ~/.codex/sessions does not exist", async () => {
  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = "/nonexistent/codex/path/for/test";
    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx();
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    expect(events).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});

test("health() reports fidelity='full' and a stateful-tail caveat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-health-"));
  mkdirSync(join(dir, "sessions", "2026", "04", "16"), { recursive: true });
  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx();
    await a.init(ctx);
    const h = await a.health(ctx);
    expect(h.fidelity).toBe("full");
    expect(h.status).toBe("ok");
    expect((h.caveats ?? []).some((c) => c.includes("token_count"))).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("golden codex fixture loads via @bematist/fixtures and round-trips EventSchema", () => {
  const events = loadFixture("codex");
  expect(events.length).toBeGreaterThanOrEqual(10);
  expect(events.length).toBeLessThanOrEqual(20);
  expect(events[0]?.dev_metrics.event_kind).toBe("session_start");
  expect(events.at(-1)?.dev_metrics.event_kind).toBe("session_end");

  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of [
    "session_start",
    "llm_request",
    "llm_response",
    "exec_command_end",
    "patch_apply_end",
    "session_end",
  ]) {
    expect(kinds.has(k as never)).toBe(true);
  }

  // CLAUDE.md D17: firstTryRate cross-agent labels MUST cover both Codex sources.
  const execFail = events.find(
    (e) => e.dev_metrics.event_kind === "exec_command_end" && e.dev_metrics.first_try_failure,
  );
  const patchFail = events.find(
    (e) => e.dev_metrics.event_kind === "patch_apply_end" && e.dev_metrics.first_try_failure,
  );
  expect(execFail).toBeDefined();
  expect(patchFail).toBeDefined();

  for (const e of events) expect(e.tier).toBe("B");
});

test("poll() reads a real rollout end-to-end and emits canonical Events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-poll-"));
  const sub = join(dir, "sessions", "2026", "04", "16");
  mkdirSync(sub, { recursive: true });
  copyFileSync(
    join(import.meta.dir, "fixtures", "rollout-real.jsonl"),
    join(sub, "rollout-abc123.jsonl"),
  );

  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx(inMemoryCursor());
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    expect(events.length).toBeGreaterThan(0);
    const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
    expect(kinds.has("session_start")).toBe(true);
    expect(kinds.has("llm_response")).toBe(true);
    expect(kinds.has("exec_command_end")).toBe(true);
    expect(kinds.has("patch_apply_end")).toBe(true);
    expect(kinds.has("session_end")).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("second poll on an unchanged file returns no new events (offset cursor)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-poll-"));
  const sub = join(dir, "sessions", "2026", "04", "16");
  mkdirSync(sub, { recursive: true });
  copyFileSync(
    join(import.meta.dir, "fixtures", "rollout-real.jsonl"),
    join(sub, "rollout-abc123.jsonl"),
  );

  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const cursor = inMemoryCursor();
    const ctx = mkCtx(cursor);
    await a.init(ctx);
    const first = await a.poll(ctx, new AbortController().signal);
    const second = await a.poll(ctx, new AbortController().signal);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appended cumulative token_count after first poll diffs against persisted running total", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-append-"));
  const sub = join(dir, "sessions", "2026", "04", "16");
  mkdirSync(sub, { recursive: true });
  const path = join(sub, "rollout-stateful.jsonl");

  const initial = [
    JSON.stringify({
      type: "session_start",
      session_id: "sess_stateful_01",
      timestamp: "2026-04-16T14:00:00.000Z",
    }),
    JSON.stringify({
      session_id: "sess_stateful_01",
      turn_id: "t1",
      timestamp: "2026-04-16T14:00:01.000Z",
      event_msg: {
        type: "token_count",
        payload: {
          model: "gpt-5",
          input_tokens: 1000,
          output_tokens: 200,
          cached_input_tokens: 0,
          total_tokens: 1200,
        },
      },
    }),
    "",
  ].join("\n");
  writeFileSync(path, initial);

  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const cursor = inMemoryCursor();
    const ctx = mkCtx(cursor);
    await a.init(ctx);
    const first = await a.poll(ctx, new AbortController().signal);
    const firstResp = first.find((e) => e.dev_metrics.event_kind === "llm_response");
    expect(firstResp?.gen_ai?.usage?.input_tokens).toBe(1000);

    // Append a second cumulative snapshot — must diff against persisted (1000,200).
    const tail = `${JSON.stringify({
      session_id: "sess_stateful_01",
      turn_id: "t2",
      timestamp: "2026-04-16T14:00:02.000Z",
      event_msg: {
        type: "token_count",
        payload: {
          model: "gpt-5",
          input_tokens: 2500,
          output_tokens: 500,
          cached_input_tokens: 0,
          total_tokens: 3000,
        },
      },
    })}\n`;
    writeFileSync(path, initial + tail);

    const second = await a.poll(ctx, new AbortController().signal);
    const secondResp = second.find((e) => e.dev_metrics.event_kind === "llm_response");
    expect(secondResp?.gen_ai?.usage?.input_tokens).toBe(1500);
    expect(secondResp?.gen_ai?.usage?.output_tokens).toBe(300);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
