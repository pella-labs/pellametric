import { expect, test } from "bun:test";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { ContinueDevAdapter, cursorKey, inodeKey } from "./index";
import { CONTINUE_STREAM_NAMES } from "./paths";

interface MkCtxOpts {
  /** If provided, `setMany` throws with this message. Simulates disk-full / fsync error. */
  failSetMany?: string;
  /** Omit `setMany` from the cursor to exercise the sequential fallback path. */
  omitSetMany?: boolean;
}

function mkCtx(overrides: Partial<AdapterContext> = {}, opts: MkCtxOpts = {}): AdapterContext {
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
  const baseCursor = {
    get: async (k: string) => cursorMap.get(k) ?? null,
    set: async (k: string, v: string) => {
      cursorMap.set(k, v);
    },
  };
  const cursor = opts.omitSetMany
    ? baseCursor
    : {
        ...baseCursor,
        setMany: async (entries: ReadonlyArray<{ key: string; value: string }>) => {
          if (opts.failSetMany) throw new Error(opts.failSetMany);
          for (const e of entries) cursorMap.set(e.key, e.value);
        },
      };
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log,
    tier: "B",
    cursor,
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
    appendFileSync(join(devData, "chatInteraction.jsonl"), newRow);
    const next = await a.poll(ctx, new AbortController().signal);
    expect(next.length).toBe(1);
    expect(next[0]?.session_id).toBe("sess_cont_03");
    expect(next[0]?.dev_metrics.event_kind).toBe("llm_request");
  });
});

test("poll uses setMany so all four cursor writes commit atomically in one batch", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    // Count how many times setMany fires per poll — it must be exactly 1.
    let setManyCalls = 0;
    let setCalls = 0;
    const cursorMap = new Map<string, string>();
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
    const ctx: AdapterContext = {
      dataDir: "/tmp/bematist-test",
      policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
      log,
      tier: "B",
      cursor: {
        get: async (k: string) => cursorMap.get(k) ?? null,
        set: async (k: string, v: string) => {
          setCalls++;
          cursorMap.set(k, v);
        },
        setMany: async (entries: ReadonlyArray<{ key: string; value: string }>) => {
          setManyCalls++;
          for (const e of entries) cursorMap.set(e.key, e.value);
        },
      },
    };
    await a.init(ctx);
    await a.poll(ctx, new AbortController().signal);
    expect(setManyCalls).toBe(1);
    // No sequential set() writes — the atomic path is exclusive.
    expect(setCalls).toBe(0);
  });
});

test("disk error inside setMany leaves ALL four cursors at their prior values (atomicity)", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    // Seed prior cursor values so we can verify nothing moves after the failure.
    const priors: Record<string, string> = {};
    for (const stream of CONTINUE_STREAM_NAMES) {
      priors[cursorKey(stream)] = "0";
    }

    const cursorMap = new Map<string, string>(Object.entries(priors));
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
    const ctx: AdapterContext = {
      dataDir: "/tmp/bematist-test",
      policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
      log,
      tier: "B",
      cursor: {
        get: async (k: string) => cursorMap.get(k) ?? null,
        set: async () => {
          throw new Error("sequential set() must not be called on the atomic path");
        },
        setMany: async () => {
          // Simulate disk-full / fsync failure — whole batch rejects.
          throw new Error("ENOSPC: no space left on device");
        },
      },
    };
    await a.init(ctx);

    let threw = false;
    try {
      await a.poll(ctx, new AbortController().signal);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Every stream cursor is untouched from its prior value.
    for (const stream of CONTINUE_STREAM_NAMES) {
      expect(cursorMap.get(cursorKey(stream))).toBe("0");
      // Inode keys never written on the failed batch either.
      expect(cursorMap.has(inodeKey(stream))).toBe(false);
    }
  });
});

test("poll persists an inode cursor alongside each offset", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    const ctx = mkCtx();
    await a.init(ctx);
    await a.poll(ctx, new AbortController().signal);
    for (const stream of CONTINUE_STREAM_NAMES) {
      const inode = await ctx.cursor.get(inodeKey(stream));
      expect(inode).not.toBeNull();
      // Inode ids are integers — allow "0" on odd filesystems but not empty string.
      expect((inode ?? "").length).toBeGreaterThan(0);
    }
  });
});

test("rotation — truncated file + stale offset triggers reset and re-parse from 0", async () => {
  await withFixturesDir(async (devData) => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    const ctx = mkCtx();
    await a.init(ctx);
    // First poll consumes the whole fixture.
    const first = await a.poll(ctx, new AbortController().signal);
    expect(first.length).toBeGreaterThan(0);
    const prevOffset = await ctx.cursor.get(cursorKey("chatInteraction"));
    expect(Number.parseInt(prevOffset ?? "0", 10)).toBeGreaterThan(0);

    // Truncate + rewrite with a shorter body. `size < prevOffset` triggers
    // the rotation reset path.
    const shortened = `${JSON.stringify({
      eventName: "chat",
      sessionId: "sess_post_rotate",
      interactionId: "int_post",
      role: "user",
      modelTitle: "claude-sonnet-4-5",
      timestamp: "2026-04-16T13:00:00.000Z",
    })}\n`;
    writeFileSync(join(devData, "chatInteraction.jsonl"), shortened);

    // Second poll must detect rotation and re-parse the single new row.
    const next = await a.poll(ctx, new AbortController().signal);
    const chat = next.filter((e) => e.session_id === "sess_post_rotate");
    expect(chat.length).toBe(1);
    expect(chat[0]?.dev_metrics.event_kind).toBe("llm_request");
  });
});

test("rotation — inode change after same-or-larger file size is detected and resets offset", async () => {
  await withFixturesDir(async (devData) => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    const ctx = mkCtx();
    await a.init(ctx);
    await a.poll(ctx, new AbortController().signal);
    const prevInode = await ctx.cursor.get(inodeKey("chatInteraction"));
    expect(prevInode).not.toBeNull();

    // Replace the file via unlink + write — new inode, but larger size so
    // the size-based rotation check alone wouldn't catch it.
    const replacement = `${JSON.stringify({
      eventName: "chat",
      sessionId: "sess_after_unlink_1",
      interactionId: "int_u1",
      role: "user",
      modelTitle: "claude-sonnet-4-5",
      timestamp: "2026-04-16T14:00:00.000Z",
    })}\n${JSON.stringify({
      eventName: "chat",
      sessionId: "sess_after_unlink_2",
      interactionId: "int_u2",
      role: "user",
      modelTitle: "claude-sonnet-4-5",
      timestamp: "2026-04-16T14:00:05.000Z",
    })}\n`;
    // Make the replacement big enough that `size >= prevOffset` and only the
    // inode-change signal could catch the rotation.
    const padding = " ".repeat(4096);
    rmSync(join(devData, "chatInteraction.jsonl"));
    writeFileSync(join(devData, "chatInteraction.jsonl"), `${replacement}{"_pad":"${padding}"}\n`);

    const next = await a.poll(ctx, new AbortController().signal);
    const sids = new Set(next.map((e) => e.session_id));
    expect(sids.has("sess_after_unlink_1")).toBe(true);
    expect(sids.has("sess_after_unlink_2")).toBe(true);

    const newInode = await ctx.cursor.get(inodeKey("chatInteraction"));
    expect(newInode).not.toBe(prevInode);
  });
});

test("fallback — CursorStore without setMany still works via sequential set()", async () => {
  await withFixturesDir(async () => {
    const a = new ContinueDevAdapter({
      tenantId: "org_acme",
      engineerId: "eng_t",
      deviceId: "dev_t",
    });
    const ctx = mkCtx({}, { omitSetMany: true });
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    expect(events.length).toBeGreaterThan(0);
    // And cursors DID advance for each stream.
    for (const stream of CONTINUE_STREAM_NAMES) {
      const v = await ctx.cursor.get(cursorKey(stream));
      expect(Number.parseInt(v ?? "0", 10)).toBeGreaterThan(0);
    }
  });
});
