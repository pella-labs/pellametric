import { expect, test } from "bun:test";
import type { Adapter, AdapterContext, AdapterHealth, AdapterStatus } from "./index";

test("Adapter interface accepts a minimal conforming implementation", () => {
  const stub: Adapter = {
    id: "test",
    label: "Test",
    version: "0.0.0",
    supportedSourceVersions: "*",
    async init() {},
    async poll() {
      // Streaming emit contract — poll no longer returns Event[].
    },
    async health() {
      return { status: "ok", fidelity: "full" };
    },
  };
  expect(stub.id).toBe("test");
});

test("AdapterStatus is interchangeable with AdapterHealth (type alias)", () => {
  const h: AdapterHealth = { status: "ok", fidelity: "full" };
  const s: AdapterStatus = h;
  expect(s.status).toBe("ok");
});

test("AdapterContext shape accepts the documented fields", () => {
  // Compile-time check only — if this type-checks the shape is still correct.
  const _ctx: AdapterContext = {
    dataDir: "/tmp/bematist",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log: {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => _ctx.log,
    },
    tier: "B",
    cursor: {
      get: async () => null,
      set: async () => {},
    },
  };
  expect(_ctx.tier).toBe("B");
});
