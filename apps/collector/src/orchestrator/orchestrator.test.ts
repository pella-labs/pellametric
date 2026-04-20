import { beforeEach, expect, test } from "bun:test";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext, EventEmitter } from "@bematist/sdk";
import { _resetAdapterHealth, runOnce } from "./index";

beforeEach(() => {
  // Module-scoped quarantine state carries across tests — reset it so
  // each test starts from a clean slate. Same behavior as daemon restart.
  _resetAdapterHealth();
});

function mkLogger() {
  const noop = () => {};
  const l = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => l,
  };
  return l;
}

function mkCtx(): AdapterContext {
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log: mkLogger(),
    tier: "B",
    cursor: { get: async () => null, set: async () => {} },
  };
}

/**
 * Build a streaming adapter from a "produce these events" function.
 * Mirrors how real adapters will emit-then-return under the new contract.
 */
function mkAdapter(id: string, produce: () => Promise<Event[]>): Adapter {
  return {
    id,
    label: id,
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    async poll(_ctx, _signal, emit) {
      const events = await produce();
      for (const e of events) emit(e);
    },
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
}

/**
 * Orchestrator-scoped collectPoll: runs `runOnce` with a capturing emit
 * callback and returns the collected events. Kept inline here rather than
 * in test-helpers because test-helpers' collectPoll wraps a single
 * Adapter, not the multi-adapter runOnce.
 */
async function collectRun(
  adapters: Adapter[],
  ctxFactory: (a: Adapter) => AdapterContext,
  opts: Parameters<typeof runOnce>[2],
): Promise<Event[]> {
  const events: Event[] = [];
  const emit: EventEmitter = (e) => {
    events.push(e);
  };
  await runOnce(adapters, ctxFactory, opts, emit);
  return events;
}

const ev = (id: string): Event =>
  ({
    client_event_id: `00000000-0000-0000-0000-${id.padStart(12, "0")}`,
    schema_version: 1,
    ts: "2026-04-16T14:00:00.000Z",
    tenant_id: "t",
    engineer_id: "e",
    device_id: "d",
    source: "claude-code",
    fidelity: "full",
    tier: "B",
    session_id: "s",
    event_seq: 0,
    dev_metrics: { event_kind: "session_start" },
    cost_estimated: false,
  }) as Event;

test("runOnce invokes every enabled adapter and streams combined events", async () => {
  const a = mkAdapter("a", async () => [ev("a")]);
  const b = mkAdapter("b", async () => [ev("b"), ev("c")]);
  const events = await collectRun([a, b], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 1000,
  });
  expect(events.length).toBe(3);
});

test("adapter throwing in poll does not crash the orchestrator", async () => {
  const good = mkAdapter("good", async () => [ev("g")]);
  const bad: Adapter = {
    id: "bad",
    label: "bad",
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    async poll() {
      throw new Error("kaboom");
    },
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
  const events = await collectRun([good, bad], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 1000,
  });
  expect(events.length).toBe(1);
  expect(events[0]?.client_event_id).toContain("g");
});

test("Promise.allSettled semantics: thrower doesn't drop other adapters' events", async () => {
  const good1 = mkAdapter("good1", async () => [ev("g1")]);
  const bad: Adapter = {
    id: "bad",
    label: "bad",
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    async poll() {
      throw new Error("kaboom");
    },
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
  const good2 = mkAdapter("good2", async () => [ev("g2")]);
  const events = await collectRun([good1, bad, good2], () => mkCtx(), {
    concurrency: 3,
    perPollTimeoutMs: 1000,
  });
  expect(events.length).toBe(2);
  const ids = events.map((e) => e.client_event_id);
  expect(ids.some((id) => id.includes("g1"))).toBe(true);
  expect(ids.some((id) => id.includes("g2"))).toBe(true);
});

test("adapter exceeding perPollTimeoutMs is signaled; honoring the signal returns partial", async () => {
  // Soft-abort contract: orchestrator fires ac.abort() at perPollTimeoutMs.
  // Respectful adapters emit what they have so far and return; the hard-kill
  // watchdog never fires because the adapter resolves before hardKillMs.
  const respectful: Adapter = {
    id: "respectful",
    label: "respectful",
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    async poll(_ctx, signal, emit) {
      emit(ev("early"));
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
  const fast = mkAdapter("fast", async () => [ev("ok")]);
  const events = await collectRun([respectful, fast], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 50,
  });
  expect(events.map((e) => e.client_event_id).some((id) => id.includes("ok"))).toBe(true);
  expect(events.map((e) => e.client_event_id).some((id) => id.includes("early"))).toBe(true);
});

// ---- Hard-kill watchdog (bug #6) ----

function mkHangingAdapter(id: string): Adapter {
  // Never resolves — simulates an adapter that ignores AbortSignal.
  return {
    id,
    label: id,
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    async poll(_ctx, _signal, _emit) {
      return new Promise<void>(() => {});
    },
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
}

test("hanging adapter is hard-killed; other adapters' events still streamed", async () => {
  const hanger = mkHangingAdapter("hanger");
  const fast = mkAdapter("fast", async () => [ev("ok")]);
  const startedAt = Date.now();
  const events = await collectRun([hanger, fast], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 50,
    hardKillMs: 150,
  });
  const elapsed = Date.now() - startedAt;
  // Completes within hardKillMs + small overhead (<< hardKillMs + 1s).
  expect(elapsed).toBeLessThan(150 + 1000);
  expect(events.length).toBe(1);
  expect(events[0]?.client_event_id).toContain("ok");
});

test("three consecutive hard-kills trigger quarantine; adapter skipped during quarantine", async () => {
  const hanger = mkHangingAdapter("q-hang");
  const fast = mkAdapter("fast", async () => [ev("ok")]);

  let hangerPolled = 0;
  const wrappedHanger: Adapter = {
    ...hanger,
    poll: async (ctx, sig, em) => {
      hangerPolled += 1;
      return hanger.poll(ctx, sig, em);
    },
  };

  // Run 3 times — each hard-killed. Fourth run should skip the hanger.
  for (let i = 0; i < 3; i++) {
    await collectRun([wrappedHanger, fast], () => mkCtx(), {
      concurrency: 2,
      perPollTimeoutMs: 20,
      hardKillMs: 60,
      adapterQuarantineMs: 10_000,
    });
  }
  expect(hangerPolled).toBe(3);

  // Fourth poll — quarantined, poll() should NOT be called.
  const hangerPolledBefore = hangerPolled;
  const startedAt = Date.now();
  const events = await collectRun([wrappedHanger, fast], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 20,
    hardKillMs: 60,
    adapterQuarantineMs: 10_000,
  });
  const elapsed = Date.now() - startedAt;
  // Quarantined adapter skipped entirely → the run is fast, bounded by
  // the fast adapter's ~0ms, well under hardKillMs.
  expect(elapsed).toBeLessThan(60);
  expect(hangerPolled).toBe(hangerPolledBefore);
  expect(events.length).toBe(1);
  expect(events[0]?.client_event_id).toContain("ok");
});

test("quarantine expires → adapter polled again", async () => {
  const hanger = mkHangingAdapter("q-expire");
  const fast = mkAdapter("fast", async () => [ev("ok")]);

  let hangerPolled = 0;
  const wrappedHanger: Adapter = {
    ...hanger,
    poll: async (ctx, sig, em) => {
      hangerPolled += 1;
      return hanger.poll(ctx, sig, em);
    },
  };

  // Quarantine after 3 strikes, with a very short (50ms) quarantine window.
  for (let i = 0; i < 3; i++) {
    await collectRun([wrappedHanger, fast], () => mkCtx(), {
      concurrency: 2,
      perPollTimeoutMs: 10,
      hardKillMs: 40,
      adapterQuarantineMs: 50,
    });
  }
  expect(hangerPolled).toBe(3);

  // Poll immediately — quarantined, should not re-poll.
  await collectRun([wrappedHanger, fast], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 10,
    hardKillMs: 40,
    adapterQuarantineMs: 50,
  });
  expect(hangerPolled).toBe(3);

  // Wait past quarantine expiry, then poll again.
  await new Promise((r) => setTimeout(r, 80));
  await collectRun([wrappedHanger, fast], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 10,
    hardKillMs: 40,
    adapterQuarantineMs: 50,
  });
  expect(hangerPolled).toBe(4);
});

test("successful poll resets hard-kill strikes", async () => {
  const hanger = mkHangingAdapter("flaky");
  let flaky = true;
  const flakyAdapter: Adapter = {
    ...hanger,
    poll: async (ctx, sig, emit) => {
      if (flaky) return hanger.poll(ctx, sig, emit);
      emit(ev("ok"));
    },
  };

  // Two consecutive hard-kills — one more would quarantine.
  for (let i = 0; i < 2; i++) {
    await collectRun([flakyAdapter], () => mkCtx(), {
      concurrency: 1,
      perPollTimeoutMs: 10,
      hardKillMs: 40,
      adapterQuarantineMs: 60_000,
    });
  }

  // Adapter recovers.
  flaky = false;
  await collectRun([flakyAdapter], () => mkCtx(), {
    concurrency: 1,
    perPollTimeoutMs: 10,
    hardKillMs: 40,
  });

  // Now make it hang twice more — if strikes reset, still not quarantined.
  flaky = true;
  let polled = 0;
  const countingAdapter: Adapter = {
    ...flakyAdapter,
    poll: async (ctx, sig, emit) => {
      polled += 1;
      return flakyAdapter.poll(ctx, sig, emit);
    },
  };
  for (let i = 0; i < 2; i++) {
    await collectRun([countingAdapter], () => mkCtx(), {
      concurrency: 1,
      perPollTimeoutMs: 10,
      hardKillMs: 40,
      adapterQuarantineMs: 60_000,
    });
  }
  // Both polls executed — not quarantined, because the good poll reset.
  expect(polled).toBe(2);
});

test("hardKillMs=0 computes default from perPollTimeoutMs", async () => {
  // When hardKillMs is not set (or 0), the orchestrator falls back to
  // max(perPollTimeoutMs * 2, perPollTimeoutMs + 30s). We can't wait
  // 100s in a test — instead verify that with hardKillMs=0 a fast
  // adapter still completes quickly (the default doesn't break the
  // normal path).
  const fast = mkAdapter("fast", async () => [ev("ok")]);
  const startedAt = Date.now();
  const events = await collectRun([fast], () => mkCtx(), {
    concurrency: 1,
    perPollTimeoutMs: 50,
    hardKillMs: 0,
  });
  expect(Date.now() - startedAt).toBeLessThan(500);
  expect(events.length).toBe(1);
});
