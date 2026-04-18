import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventSchema } from "@bematist/schema";
import type { CursorStore, Logger, VSCodeExtensionContext } from "@bematist/sdk";
import { makeTwinnyHandler } from "./twinny";

const FIX = join(import.meta.dir, "..", "fixtures", "twinny-telemetry.jsonl");

const noopLog: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLog,
};

function memoryCursor(): CursorStore {
  const m = new Map<string, string>();
  return {
    async get(k: string) {
      return m.get(k) ?? null;
    },
    async set(k: string, v: string) {
      m.set(k, v);
    },
  };
}

function setupProfile(): { userDir: string; telemetryPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "bematist-twinny-"));
  const userDir = join(root, "User");
  const extDir = join(userDir, "globalStorage", "rjmacarthy.twinny");
  mkdirSync(extDir, { recursive: true });
  const telemetryPath = join(extDir, "telemetry.jsonl");
  copyFileSync(FIX, telemetryPath);
  return { userDir, telemetryPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function ctx(userDir: string): VSCodeExtensionContext {
  return {
    userDir,
    distro: "code",
    cursor: memoryCursor(),
    log: noopLog,
    tier: "B",
  };
}

const identity = {
  tenantId: "org_acme",
  engineerId: "eng_t",
  deviceId: "dev_t",
  tier: "B" as const,
};

test("discover() returns the telemetry path when the extension dir exists", async () => {
  const env = setupProfile();
  try {
    const handler = makeTwinnyHandler(identity);
    const paths = await handler.discover(ctx(env.userDir));
    expect(paths).toEqual([env.telemetryPath]);
  } finally {
    env.cleanup();
  }
});

test("discover() returns [] when extension dir is absent", async () => {
  const root = mkdtempSync(join(tmpdir(), "bematist-twinny-"));
  try {
    const handler = makeTwinnyHandler(identity);
    const paths = await handler.discover(ctx(join(root, "User")));
    expect(paths).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parse() emits canonical events for the bundled fixture", async () => {
  const env = setupProfile();
  try {
    const handler = makeTwinnyHandler(identity);
    const events = await handler.parse(
      ctx(env.userDir),
      env.telemetryPath,
      new AbortController().signal,
    );
    // Fixture: 2 sessions × (start + ≥1 chat_response + end) = 7 lines, all parsed.
    expect(events.length).toBe(7);
    for (const e of events) {
      const r = EventSchema.safeParse(e);
      expect(r.success).toBe(true);
      expect(e.source).toBe("vscode-generic");
      expect(e.fidelity).toBe("estimated");
      expect(e.cost_estimated).toBe(true);
    }
  } finally {
    env.cleanup();
  }
});

test("parse() never emits cost_usd (local-LLM caveat)", async () => {
  const env = setupProfile();
  try {
    const handler = makeTwinnyHandler(identity);
    const events = await handler.parse(
      ctx(env.userDir),
      env.telemetryPath,
      new AbortController().signal,
    );
    for (const e of events) {
      expect(e.dev_metrics.cost_usd).toBeUndefined();
    }
  } finally {
    env.cleanup();
  }
});

test("parse() persists offset and second poll yields no duplicates", async () => {
  const env = setupProfile();
  try {
    const handler = makeTwinnyHandler(identity);
    const c = ctx(env.userDir);
    const first = await handler.parse(c, env.telemetryPath, new AbortController().signal);
    expect(first.length).toBeGreaterThan(0);
    const second = await handler.parse(c, env.telemetryPath, new AbortController().signal);
    expect(second.length).toBe(0);
  } finally {
    env.cleanup();
  }
});

test("parse() picks up newly appended lines on next poll", async () => {
  const env = setupProfile();
  try {
    const handler = makeTwinnyHandler(identity);
    const c = ctx(env.userDir);
    await handler.parse(c, env.telemetryPath, new AbortController().signal);
    // Append one new session.
    const append =
      `${JSON.stringify({ type: "session_start", sessionId: "twn_99", timestamp: "2026-04-17T12:00:00.000Z" })}\n` +
      `${JSON.stringify({ type: "session_end", sessionId: "twn_99", timestamp: "2026-04-17T12:00:30.000Z" })}\n`;
    writeFileSync(env.telemetryPath, append, { flag: "a" });
    const next = await handler.parse(c, env.telemetryPath, new AbortController().signal);
    expect(next.length).toBe(2);
    expect(next[0]?.session_id).toBe("twn_99");
    expect(next[0]?.dev_metrics.event_kind).toBe("session_start");
    expect(next[1]?.dev_metrics.event_kind).toBe("session_end");
  } finally {
    env.cleanup();
  }
});

test("parse() skips malformed JSON lines without aborting the rest", async () => {
  const env = setupProfile();
  try {
    writeFileSync(
      env.telemetryPath,
      [
        '{"type":"session_start","sessionId":"twn_x","timestamp":"2026-04-17T13:00:00.000Z"}',
        "{not json",
        '{"type":"session_end","sessionId":"twn_x","timestamp":"2026-04-17T13:00:01.000Z"}',
      ].join("\n"),
    );
    const handler = makeTwinnyHandler(identity);
    const events = await handler.parse(
      ctx(env.userDir),
      env.telemetryPath,
      new AbortController().signal,
    );
    expect(events.length).toBe(2);
  } finally {
    env.cleanup();
  }
});

test("parse() respects an aborted signal and returns early", async () => {
  const env = setupProfile();
  try {
    const handler = makeTwinnyHandler(identity);
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await handler.parse(ctx(env.userDir), env.telemetryPath, ctrl.signal);
    expect(events).toEqual([]);
  } finally {
    env.cleanup();
  }
});

test("handler advertises honest fidelity + caveats", () => {
  const handler = makeTwinnyHandler(identity);
  expect(handler.extensionId).toBe("rjmacarthy.twinny");
  expect(handler.fidelity).toBe("estimated");
  expect(handler.caveats?.length ?? 0).toBeGreaterThan(0);
});
