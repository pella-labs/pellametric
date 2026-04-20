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
import { collectPoll } from "../../test-helpers";
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
    async parse(
      ctx: VSCodeExtensionContext,
      _path: string,
      _signal: AbortSignal,
      emit: (e: import("@bematist/schema").Event) => void,
    ) {
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
      emit({
        ...env,
        client_event_id: deterministicEventId(
          "example-corp.dummy-ai",
          sessionId,
          0,
          "session_start",
          null,
        ),
        dev_metrics: { event_kind: "session_start", duration_ms: 0 },
      });
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
    const events = await collectPoll(a, ctx);
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
            // No events to emit; the streaming contract returns void.
          },
        },
      ]);
      const ctx = mkCtx();
      await a.init(ctx);
      const events = await collectPoll(a, ctx);
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
          // No events to emit; the streaming contract returns void.
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
      const events = await collectPoll(a, ctx);
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
      const events = await collectPoll(a, ctx, ctrl.signal);
      expect(events).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Bug #11 — runtime rediscovery
// ────────────────────────────────────────────────────────────────────────────

test("rediscovery picks up a newly-added profile dir after TTL expires", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-rediscover-"));
  try {
    // Start with Code already installed.
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      let clock = 1_000;
      const a = new VSCodeGenericAdapter(identity, [], {
        rediscoveryIntervalMs: 100,
        now: () => clock,
      });
      const ctx = mkCtx();
      await a.init(ctx);
      expect(a.listProfiles().map((p) => p.distro)).toEqual(["code"]);

      // User installs Code Insiders after the daemon is already running.
      mkdirSync(join(root, "Code - Insiders", "User"), { recursive: true });

      // Within the TTL — cache honored, no rediscovery yet.
      clock += 50;
      await collectPoll(a, ctx);
      expect(a.listProfiles().map((p) => p.distro)).toEqual(["code"]);

      // Past the TTL — rediscovery runs and picks up Code - Insiders.
      clock += 200;
      await collectPoll(a, ctx);
      const distros = a
        .listProfiles()
        .map((p) => p.distro)
        .sort();
      expect(distros).toContain("code");
      expect(distros).toContain("code-insiders");
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty-cache poll still rediscovers immediately (first-VS-Code-install fast-path)", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-empty-fast-"));
  try {
    // No profiles at startup.
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      let clock = 1_000;
      const a = new VSCodeGenericAdapter(identity, [], {
        rediscoveryIntervalMs: 10_000, // long TTL
        now: () => clock,
      });
      const ctx = mkCtx();
      await a.init(ctx);
      expect(a.listProfiles().length).toBe(0);

      // User installs Code right after init, well inside the TTL.
      mkdirSync(join(root, "Code", "User"), { recursive: true });
      clock += 100;
      await collectPoll(a, ctx);
      // Empty cache triggers a fresh scan regardless of TTL — the user
      // shouldn't have to wait a whole TTL after a brand-new install.
      expect(a.listProfiles().map((p) => p.distro)).toContain("code");
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rediscovery logs WARN when a previously-seen profile vanishes but preserves cursors", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-vanish-"));
  try {
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;

      // Spy logger — capture warn calls.
      const warnCalls: Array<{ msg: string; args: unknown[] }> = [];
      const infoCalls: Array<{ msg: string; args: unknown[] }> = [];
      const spyLog: import("@bematist/sdk").Logger = {
        trace: () => {},
        debug: () => {},
        info: (msg: string, ...args: unknown[]) => {
          infoCalls.push({ msg, args });
        },
        warn: (msg: string, ...args: unknown[]) => {
          warnCalls.push({ msg, args });
        },
        error: () => {},
        fatal: () => {},
        child: () => spyLog,
      };

      // Shared cursor store so we can assert preservation.
      const cursorStore = new Map<string, string>();
      const ctx: AdapterContext = {
        dataDir: "/tmp/bematist-test",
        policy: { enabled: true, tier: "B", pollIntervalMs: 5000 },
        log: spyLog,
        tier: "B",
        cursor: {
          get: async (k: string) => cursorStore.get(k) ?? null,
          set: async (k: string, v: string) => {
            cursorStore.set(k, v);
          },
        },
      };

      let clock = 1_000;
      const a = new VSCodeGenericAdapter(identity, [], {
        rediscoveryIntervalMs: 100,
        now: () => clock,
      });
      await a.init(ctx);
      expect(a.listProfiles().map((p) => p.distro)).toEqual(["code"]);

      // Simulate a handler having written a cursor for this profile.
      cursorStore.set("vscode:code:fake.ext:lastOffset", "42");

      // User removes VS Code (or closes its window and the dir is
      // temporarily gone — we must NOT wipe cursors).
      rmSync(join(root, "Code"), { recursive: true, force: true });
      clock += 500;

      await collectPoll(a, ctx);
      expect(a.listProfiles().length).toBe(0);

      // Warn was logged about the vanished profile.
      expect(warnCalls.some((c) => c.msg.includes("vanished"))).toBe(true);

      // Cursor value is still present — the adapter didn't erase it.
      expect(cursorStore.get("vscode:code:fake.ext:lastOffset")).toBe("42");
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rediscovery does not re-run within the TTL window (cache is honored)", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-vsc-ttl-"));
  try {
    mkdirSync(join(root, "Code", "User"), { recursive: true });
    const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
    try {
      process.env.BEMATIST_VSCODE_USER_ROOT = root;
      let clock = 1_000;
      const a = new VSCodeGenericAdapter(identity, [], {
        rediscoveryIntervalMs: 10_000,
        now: () => clock,
      });
      const ctx = mkCtx();
      await a.init(ctx);
      expect(a.listProfiles().length).toBe(1);

      // Add a new distro but keep clock well inside the TTL window.
      mkdirSync(join(root, "Code - Insiders", "User"), { recursive: true });
      clock += 1_000; // much less than 10s TTL
      await collectPoll(a, ctx);
      // Still only the profile from init — no rescan yet.
      expect(a.listProfiles().length).toBe(1);

      // Once we cross the TTL, rescan runs.
      clock += 20_000;
      await collectPoll(a, ctx);
      expect(a.listProfiles().length).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
      else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("BEMATIST_VSCODE_REDISCOVERY_MS env var overrides the default TTL", async () => {
  const prevEnv = process.env.BEMATIST_VSCODE_REDISCOVERY_MS;
  try {
    process.env.BEMATIST_VSCODE_REDISCOVERY_MS = "12345";
    // Dummy identity + no profile dir — we just want to verify the env is
    // read at construction. The TTL is internal so we confirm via behavior:
    // with a 12345ms TTL, a 10s clock jump does NOT rediscover.
    const root = mkdtempSync(join(tmpdir(), "bematist-vsc-env-"));
    try {
      mkdirSync(join(root, "Code", "User"), { recursive: true });
      const prev = process.env.BEMATIST_VSCODE_USER_ROOT;
      try {
        process.env.BEMATIST_VSCODE_USER_ROOT = root;
        let clock = 1_000;
        const a = new VSCodeGenericAdapter(identity, [], {
          now: () => clock,
        });
        const ctx = mkCtx();
        await a.init(ctx);
        mkdirSync(join(root, "VSCodium", "User"), { recursive: true });
        clock += 10_000; // < 12345ms TTL
        await collectPoll(a, ctx);
        const distros = a.listProfiles().map((p) => p.distro);
        expect(distros).not.toContain("vscodium");
      } finally {
        if (prev === undefined) delete process.env.BEMATIST_VSCODE_USER_ROOT;
        else process.env.BEMATIST_VSCODE_USER_ROOT = prev;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    if (prevEnv === undefined) delete process.env.BEMATIST_VSCODE_REDISCOVERY_MS;
    else process.env.BEMATIST_VSCODE_REDISCOVERY_MS = prevEnv;
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
