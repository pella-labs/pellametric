import { expect, test } from "bun:test";
import type { Event } from "@bematist/schema";
import type { Adapter, AdapterContext } from "@bematist/sdk";
import { runOnce } from "./index";

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

function mkAdapter(id: string, pollImpl: () => Promise<Event[]>): Adapter {
  return {
    id,
    label: id,
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    poll: async () => pollImpl(),
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
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

test("runOnce invokes every enabled adapter and returns combined events", async () => {
  const a = mkAdapter("a", async () => [ev("a")]);
  const b = mkAdapter("b", async () => [ev("b"), ev("c")]);
  const events = await runOnce([a, b], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 1000,
  });
  expect(events.length).toBe(3);
});

test("adapter throwing in poll does not crash the orchestrator", async () => {
  const good = mkAdapter("good", async () => [ev("g")]);
  const bad = mkAdapter("bad", async () => {
    throw new Error("kaboom");
  });
  const events = await runOnce([good, bad], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 1000,
  });
  expect(events.length).toBe(1);
  expect(events[0]?.client_event_id).toContain("g");
});

test("adapter exceeding perPollTimeoutMs is aborted, orchestrator continues", async () => {
  const slow = mkAdapter(
    "slow",
    () =>
      new Promise<Event[]>((resolve) => {
        setTimeout(() => resolve([ev("late")]), 500);
      }),
  );
  const fast = mkAdapter("fast", async () => [ev("ok")]);
  const events = await runOnce([slow, fast], () => mkCtx(), {
    concurrency: 2,
    perPollTimeoutMs: 50,
  });
  expect(events.map((e) => e.client_event_id).some((id) => id.includes("ok"))).toBe(true);
  expect(events.map((e) => e.client_event_id).some((id) => id.includes("late"))).toBe(false);
});
