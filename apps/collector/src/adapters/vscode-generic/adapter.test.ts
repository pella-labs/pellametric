import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture } from "@bematist/fixtures";
import type {
  Adapter,
  AdapterContext,
  Logger,
  VSCodeExtensionContext,
  VSCodeExtensionHandler,
} from "@bematist/sdk";
import { VSCodeGenericAdapter } from "./index";
import { baseEvent, deterministicEventId } from "./normalize";

const noopLog: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLog,
};

function mkCtx(): AdapterContext {
  return {
    dataDir: "/tmp/bematist-test",
    policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
    log: noopLog,
    tier: "B",
    cursor: {
      get: async () => null,
      set: async () => {},
    },
  };
}

const identity = { tenantId: "org_acme", engineerId: "eng_t", deviceId: "dev_t" };

// ────────────────────────────────────────────────────────────────────────────
// EXTENSION-PATTERN DOC TEST.
//
// This test is the load-bearing example for community VS Code extension
// authors. It shows the complete shape a handler implements:
//
//   - declare extensionId (publisher.name), label, fidelity, caveats, version
//   - implement discover(ctx) → string[] of candidate paths under ctx.userDir
//   - implement parse(ctx, path, signal) → Event[]
//   - register the handler via `adapter.register(handler)`
//
// `ctx.cursor` is automatically scoped to `(distro, extensionId)` by the
// generic adapter, so handlers can use plain keys without namespacing.
// ────────────────────────────────────────────────────────────────────────────

function makeExampleHandler(): VSCodeExtensionHandler {
  return {
    extensionId: "example-corp.dummy-ai",
    label: "Example AI (community)",
    fidelity: "estimated",
    version: "0.0.1",
    caveats: ["Demonstrates the handler pattern; not a real extension."],
    async discover(_ctx: VSCodeExtensionContext) {
      return ["/virtual/example-output.jsonl"];
    },
    async parse(ctx: VSCodeExtensionContext, _path: string, _signal: AbortSignal) {
      const sessionId = "ex_01";
      const ts = "2026-04-17T15:00:00.000Z";
      const env = baseEvent({
        id: { ...identity, tier: ctx.tier },
        sessionId,
        seq: 0,
        ts,
        fidelity: "estimated",
        costEstimated: true,
      });
      return [
        {
          ...env,
          client_event_id: deterministicEventId(
            "example-corp.dummy-ai",
            sessionId,
            0,
            "session_start",
            null,
          ),
          dev_metrics: { event_kind: "session_start", duration_ms: 0 },
        },
      ];
    },
  };
}

test("VSCodeGenericAdapter implements the Adapter interface", () => {
  const a: Adapter = new VSCodeGenericAdapter(identity);
  expect(a.id).toBe("vscode-generic");
  expect(a.label).toBe("VS Code extensions (generic)");
});

test("default registry includes the Twinny example handler", () => {
  const a = new VSCodeGenericAdapter(identity);
  const ids = a.listHandlers().map((h) => h.extensionId);
  expect(ids).toContain("rjmacarthy.twinny");
});

test("register() appends a new handler", () => {
  const a = new VSCodeGenericAdapter(identity);
  const before = a.listHandlers().length;
  a.register(makeExampleHandler());
  expect(a.listHandlers().length).toBe(before + 1);
  expect(a.listHandlers().some((h) => h.extensionId === "example-corp.dummy-ai")).toBe(true);
});

test("register() with same extensionId replaces in place (override semantics)", () => {
  const a = new VSCodeGenericAdapter(identity);
  a.register(makeExampleHandler());
  const replacement: VSCodeExtensionHandler = {
    ...makeExampleHandler(),
    label: "Example AI (overridden)",
  };
  a.register(replacement);
  const matches = a.listHandlers().filter((h) => h.extensionId === "example-corp.dummy-ai");
  expect(matches.length).toBe(1);
  expect(matches[0]?.label).toBe("Example AI (overridden)");
});

test("init() is idempotent and discovers profiles via env override", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-adapter-"));
  try {
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      const a = new VSCodeGenericAdapter(identity);
      const ctx = mkCtx();
      await a.init(ctx);
      await a.init(ctx);
      const h = await a.health(ctx);
      expect(h.status).toBe("ok");
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("poll() returns [] when no VS Code profile is on disk", async () => {
  const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
  try {
    process.env.BEMATIST_VSCODE_USER_ROOT = "/nonexistent/path/for/test";
    const a = new VSCodeGenericAdapter(identity);
    const ctx = mkCtx();
    await a.init(ctx);
    const events = await a.poll(ctx, new AbortController().signal);
    expect(events).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
    else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
  }
});

test("poll() does not propagate handler.discover() errors — logs and continues", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-adapter-"));
  try {
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      const a = new VSCodeGenericAdapter(identity, [
        {
          extensionId: "broken.handler",
          label: "Broken",
          fidelity: "estimated",
          version: "0.0.0",
          async discover() {
            throw new Error("broken on purpose");
          },
          async parse() {
            return [];
          },
        },
      ]);
      const ctx = mkCtx();
      await a.init(ctx);
      const events = await a.poll(ctx, new AbortController().signal);
      // Twinny default handler is also registered and finds nothing in this
      // empty profile; broken handler should not crash the poll.
      expect(events).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("health() reports 'disabled' when no VS Code profile is found", async () => {
  const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
  try {
    process.env.BEMATIST_VSCODE_USER_ROOT = "/nonexistent/path/for/test";
    const a = new VSCodeGenericAdapter(identity);
    const ctx = mkCtx();
    await a.init(ctx);
    const h = await a.health(ctx);
    expect(h.status).toBe("disabled");
  } finally {
    if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
    else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
  }
});

test("health() collapses to the worst registered handler fidelity", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-adapter-"));
  try {
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      // Twinny default handler is `estimated`. Adding an `aggregate-only` handler
      // must drag the reported fidelity down to `aggregate-only`.
      const aggHandler: VSCodeExtensionHandler = {
        extensionId: "agg.handler",
        label: "Aggregate",
        fidelity: "aggregate-only",
        version: "0.0.0",
        async discover() {
          return [];
        },
        async parse() {
          return [];
        },
      };
      const a = new VSCodeGenericAdapter(identity, [aggHandler]);
      const ctx = mkCtx();
      await a.init(ctx);
      const h = await a.health(ctx);
      expect(h.fidelity).toBe("aggregate-only");
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("poll() routes to a registered community handler and emits its events", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-adapter-"));
  try {
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      const a = new VSCodeGenericAdapter(identity);
      a.register(makeExampleHandler());
      const ctx = mkCtx();
      await a.init(ctx);
      const events = await a.poll(ctx, new AbortController().signal);
      // Example handler emits 1 synthetic session_start; twinny finds nothing
      // in this empty profile.
      expect(events.length).toBe(1);
      expect(events[0]?.source).toBe("vscode-generic");
      expect(events[0]?.dev_metrics.event_kind).toBe("session_start");
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("poll() honors aborted signal", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-adapter-"));
  try {
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      const a = new VSCodeGenericAdapter(identity);
      a.register(makeExampleHandler());
      const ctx = mkCtx();
      await a.init(ctx);
      const ctrl = new AbortController();
      ctrl.abort();
      const events = await a.poll(ctx, ctrl.signal);
      expect(events).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("golden vscode-generic fixture loads via @bematist/fixtures and validates", () => {
  const events = loadFixture("vscode-generic");
  expect(events.length).toBeGreaterThanOrEqual(10);
  const sources = new Set(events.map((e) => e.source));
  expect(sources.size).toBe(1);
  expect(sources.has("vscode-generic")).toBe(true);
  for (const e of events) {
    expect(e.tier).toBe("B");
    expect(e.fidelity).toBe("estimated");
    expect(e.cost_estimated).toBe(true);
    // Local-LLM-only fixture: never has cost_usd.
    expect(e.dev_metrics.cost_usd).toBeUndefined();
  }
  const kinds = new Set(events.map((e) => e.dev_metrics.event_kind));
  for (const k of ["session_start", "llm_response", "session_end"]) {
    expect(kinds.has(k as never)).toBe(true);
  }
});
