import { expect, test } from "bun:test";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext, CursorStore } from "@bematist/sdk";
import { collectPoll } from "../../test-helpers";
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
    const events = await collectPoll(a, ctx);
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
    const events = await collectPoll(a, ctx);
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
    const first = await collectPoll(a, ctx);
    const second = await collectPoll(a, ctx);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cursor-wipe recovery: missing cumulative is re-derived from rollout tail (bug #1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-wipe-"));
  const sub = join(dir, "sessions", "2026", "04", "16");
  mkdirSync(sub, { recursive: true });
  const path = join(sub, "rollout-wiped.jsonl");

  // Rollout with two turns — cumulative 1000/200 then 2500/500.
  const initial = [
    JSON.stringify({
      type: "session_start",
      session_id: "sess_wipe_01",
      timestamp: "2026-04-16T14:00:00.000Z",
    }),
    JSON.stringify({
      session_id: "sess_wipe_01",
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
    JSON.stringify({
      session_id: "sess_wipe_01",
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
    }),
    "",
  ].join("\n");
  writeFileSync(path, initial);

  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;

    // Simulate a cursor AFTER a wipe: offset AND inode persisted from the
    // previous run, but the cumulative row has been lost. A correct poll
    // must NOT re-emit the historical 2500/500 — it must recognize there
    // is nothing new past the offset and emit zero events.
    const fileSize = statSync(path).size;
    const fileInode = String(statSync(path).ino);
    const cursor = inMemoryCursor();
    await cursor.set(`offset:${path}`, String(fileSize));
    await cursor.set(`inode:${path}`, fileInode);
    // Note: no cumulative key set.

    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx(cursor);
    await a.init(ctx);
    const firstAfterWipe = await collectPoll(a, ctx);
    expect(firstAfterWipe.length).toBe(0);

    // Append a single new turn — delta must diff against the tail-recovered
    // cumulative (2500/500), NOT zero, otherwise the new llm_response would
    // claim input_tokens=4000 / output_tokens=800.
    const tail = `${JSON.stringify({
      session_id: "sess_wipe_01",
      turn_id: "t3",
      timestamp: "2026-04-16T14:00:03.000Z",
      event_msg: {
        type: "token_count",
        payload: {
          model: "gpt-5",
          input_tokens: 4000,
          output_tokens: 800,
          cached_input_tokens: 0,
          total_tokens: 4800,
        },
      },
    })}\n`;
    appendFileSync(path, tail);

    const second = await collectPoll(a, ctx);
    const resp = second.find((e) => e.dev_metrics.event_kind === "llm_response");
    expect(resp?.gen_ai?.usage?.input_tokens).toBe(1500);
    expect(resp?.gen_ai?.usage?.output_tokens).toBe(300);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rotation detection: offset > size triggers reset to first-run (bug #2)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-rotate-"));
  const sub = join(dir, "sessions", "2026", "04", "16");
  mkdirSync(sub, { recursive: true });
  const path = join(sub, "rollout-rotated.jsonl");

  // Fresh small rollout with a token_count — size ~300 bytes.
  const content = [
    JSON.stringify({
      type: "session_start",
      session_id: "sess_rot_01",
      timestamp: "2026-04-16T14:00:00.000Z",
    }),
    JSON.stringify({
      session_id: "sess_rot_01",
      turn_id: "t1",
      timestamp: "2026-04-16T14:00:01.000Z",
      event_msg: {
        type: "token_count",
        payload: {
          model: "gpt-5",
          input_tokens: 100,
          output_tokens: 50,
          cached_input_tokens: 0,
          total_tokens: 150,
        },
      },
    }),
    "",
  ].join("\n");
  writeFileSync(path, content);
  const fileSize = statSync(path).size;
  const fileInode = String(statSync(path).ino);

  // Stale cursor claims an offset LARGER than the current file (as if the
  // previous-larger file was truncated/rotated to a smaller one). Without
  // rotation detection the reader would return zero lines forever.
  const cursor = inMemoryCursor();
  await cursor.set(`offset:${path}`, String(fileSize + 500));
  await cursor.set(`inode:${path}`, fileInode);
  // Cumulative intentionally set to a "stale" high value to prove the
  // first-run path uses the freshly-parsed (null-priorCumulative) baseline.
  await cursor.set(
    `cumulative:${path}`,
    JSON.stringify({
      input_tokens: 999_999,
      output_tokens: 999_999,
      cached_input_tokens: 0,
      total_tokens: 1_999_998,
    }),
  );

  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx(cursor);
    await a.init(ctx);
    const events = await collectPoll(a, ctx);
    const resp = events.find((e) => e.dev_metrics.event_kind === "llm_response");
    // Fresh parse from offset 0 → priorCumulative ignored → delta is the
    // full 100/50, never the nonsensical (100 - 999999) clamp at 0.
    expect(resp?.gen_ai?.usage?.input_tokens).toBe(100);
    expect(resp?.gen_ai?.usage?.output_tokens).toBe(50);
    // Cursor was rewritten to the new (smaller) offset.
    const after = await cursor.get(`offset:${path}`);
    expect(Number.parseInt(after ?? "0", 10)).toBe(fileSize);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rotation detection: inode change triggers reset (bug #2)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-inode-"));
  const sub = join(dir, "sessions", "2026", "04", "16");
  mkdirSync(sub, { recursive: true });
  const path = join(sub, "rollout-inode.jsonl");

  const content = [
    JSON.stringify({
      type: "session_start",
      session_id: "sess_inode_01",
      timestamp: "2026-04-16T14:00:00.000Z",
    }),
    JSON.stringify({
      session_id: "sess_inode_01",
      turn_id: "t1",
      timestamp: "2026-04-16T14:00:01.000Z",
      event_msg: {
        type: "token_count",
        payload: {
          model: "gpt-5",
          input_tokens: 200,
          output_tokens: 80,
          cached_input_tokens: 0,
          total_tokens: 280,
        },
      },
    }),
    "",
  ].join("\n");
  writeFileSync(path, content);
  const fileSize = statSync(path).size;
  const realInode = String(statSync(path).ino);

  // Cursor pretends the last-seen inode was something else — size matches
  // perfectly so the size-check wouldn't fire, but inode drift must trigger
  // reset.
  const cursor = inMemoryCursor();
  await cursor.set(`offset:${path}`, String(fileSize));
  await cursor.set(`inode:${path}`, `${Number.parseInt(realInode, 10) + 42}`);
  await cursor.set(
    `cumulative:${path}`,
    JSON.stringify({
      input_tokens: 5000,
      output_tokens: 5000,
      cached_input_tokens: 0,
      total_tokens: 10_000,
    }),
  );

  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    const a = new CodexAdapter({ tenantId: "o", engineerId: "e", deviceId: "d" });
    const ctx = mkCtx(cursor);
    await a.init(ctx);
    const events = await collectPoll(a, ctx);
    // Inode mismatch → reset → fresh parse → full 200/80 delta.
    const resp = events.find((e) => e.dev_metrics.event_kind === "llm_response");
    expect(resp?.gen_ai?.usage?.input_tokens).toBe(200);
    expect(resp?.gen_ai?.usage?.output_tokens).toBe(80);
    // Cursor inode refreshed to the real one.
    expect(await cursor.get(`inode:${path}`)).toBe(realInode);
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
    const first = await collectPoll(a, ctx);
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

    const second = await collectPoll(a, ctx);
    const secondResp = second.find((e) => e.dev_metrics.event_kind === "llm_response");
    expect(secondResp?.gen_ai?.usage?.input_tokens).toBe(1500);
    expect(secondResp?.gen_ai?.usage?.output_tokens).toBe(300);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
