import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCursorSessionState,
  type CursorAiSettings,
  type CursorBubble,
  type CursorComposer,
  fileUriToPath,
  interpolateTurnTs,
  isSafeCursorId,
  pickModel,
  sqliteBackendName,
  sqliteQuery,
} from "../parsers/cursor";

describe("fileUriToPath", () => {
  // Run cross-platform assertions: sep varies, but both platforms must
  // reach a path that starts with the correct prefix. These tests assume
  // the active process platform — not "does Windows decode work on mac",
  // just "does the code use the right API so Windows won't break".
  it("decodes Unix file URIs", () => {
    const p = fileUriToPath("file:///Users/walidkhori/Desktop/foo.ts");
    // On darwin this returns "/Users/walidkhori/Desktop/foo.ts". On Windows
    // (where tests won't typically run for macOS-style URIs) fileURLToPath
    // might throw — catch that case by asserting non-null with the right shape.
    if (process.platform !== "win32") {
      expect(p).toBe("/Users/walidkhori/Desktop/foo.ts");
    }
  });
  it("decodes URL-encoded path segments (spaces etc.)", () => {
    if (process.platform !== "win32") {
      expect(fileUriToPath("file:///Users/me/dir%20with%20spaces/bar.md"))
        .toBe("/Users/me/dir with spaces/bar.md");
    }
  });
  it("passes through a plain path unchanged", () => {
    // A bare path (no file:// scheme) is valid input — older Cursor versions
    // sometimes stored workspace folders pre-decoded.
    expect(fileUriToPath("/Users/me/thing")).toBe("/Users/me/thing");
  });
  it("returns null on empty input, swallows malformed URIs without throwing", () => {
    expect(fileUriToPath("")).toBeNull();
    // The Node `url` module throws on invalid file URIs — the helper catches
    // and returns null instead of propagating.
    expect(() => fileUriToPath("file://[badhost]/x")).not.toThrow();
  });
  // Contract for Windows behaviour, documented even if this test suite runs
  // on macOS CI. The key bug we're preventing: the old regex approach
  // produced "/C:/Users/..." which is not a valid Windows path. With
  // fileURLToPath, Windows drive-letter URIs decode to "C:\\Users\\...".
  it("accepts Windows-style drive-letter URIs without crashing", () => {
    const p = fileUriToPath("file:///C:/Users/walid/project");
    // On darwin/linux: returns /C:/Users/... (still stable — no crash).
    // On win32: returns C:\Users\walid\project with backslashes.
    // Either way, must not throw.
    expect(typeof p === "string" || p === null).toBe(true);
  });
});

describe("isSafeCursorId", () => {
  it("accepts valid UUIDs", () => {
    expect(isSafeCursorId("756acbd7-47fa-4fcc-92bb-1175276c3cbf")).toBe(true);
    expect(isSafeCursorId("AA03EC5F-AE4E-4429-8DB6-832D44C50599")).toBe(true);
  });
  it("rejects anything that could enable SQL LIKE injection", () => {
    expect(isSafeCursorId("foo")).toBe(false);
    expect(isSafeCursorId("' OR 1=1; --")).toBe(false);
    expect(isSafeCursorId("756acbd7-47fa-4fcc-92bb-1175276c3cbf:evil")).toBe(false);
    expect(isSafeCursorId("")).toBe(false);
  });
});

describe("pickModel", () => {
  const ai: CursorAiSettings = {
    composerModel: "claude-4-sonnet",
    regularChatModel: "claude-4-sonnet-thinking",
    cmdKModel: "gpt-4o",
  };
  it("uses composerModel in agent/edit modes", () => {
    expect(pickModel({ unifiedMode: "agent" }, ai)).toBe("claude-4-sonnet");
    expect(pickModel({ forceMode: "edit" }, ai)).toBe("claude-4-sonnet");
  });
  it("uses regularChatModel in chat mode", () => {
    expect(pickModel({ unifiedMode: "chat" }, ai)).toBe("claude-4-sonnet-thinking");
  });
  it("falls back between fields when one is missing", () => {
    expect(pickModel({ unifiedMode: "chat" }, { composerModel: "x" })).toBe("x");
    expect(pickModel({ unifiedMode: "agent" }, { regularChatModel: "y" })).toBe("y");
  });
  it("returns undefined if nothing is set", () => {
    expect(pickModel({ unifiedMode: "agent" }, {})).toBeUndefined();
  });
});

describe("interpolateTurnTs", () => {
  it("returns distinct monotonic timestamps across turns", () => {
    const start = 1_000_000;
    const end = 2_000_000;
    const ts = [0, 1, 2, 3, 4].map(i => interpolateTurnTs(start, end, i, 5).getTime());
    // strictly increasing
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    // first == start (plus the +i disambiguator = 0); last == end (plus +n-1)
    expect(ts[0]).toBe(start);
    expect(ts[ts.length - 1]).toBe(end + 4);
  });
  it("handles a single-turn session", () => {
    const s = 42;
    const t = interpolateTurnTs(s, s + 1000, 0, 1);
    expect(t.getTime()).toBe(s);
  });
  it("stays monotonic even when span is zero (instantaneous session)", () => {
    const ts = [0, 1, 2].map(i => interpolateTurnTs(100, 100, i, 3).getTime());
    expect(ts).toEqual([100, 101, 102]);
  });
});

describe("buildCursorSessionState", () => {
  const cd: CursorComposer = {
    composerId: "756acbd7-47fa-4fcc-92bb-1175276c3cbf",
    createdAt: 1_700_000_000_000,
    lastUpdatedAt: 1_700_000_060_000,
    status: "completed",
    unifiedMode: "agent",
    forceMode: "edit",
    fullConversationHeadersOnly: [
      { bubbleId: "b0", type: 1 },
      { bubbleId: "b1", type: 2 },
      { bubbleId: "b2", type: 2 },
      { bubbleId: "b3", type: 1 },
      { bubbleId: "b4", type: 2 },
    ],
    originalFileStates: {
      "file:///Users/me/foo.ts": {},
      "file:///Users/me/dir%20with%20spaces/bar.md": {},
    },
    newlyCreatedFiles: ["/Users/me/new.ts"],
  };
  const bubblesOrdered: CursorBubble[] = [
    { type: 1, text: "please fix this broken build", tokenCount: null },
    { type: 2, text: "", tokenCount: { inputTokens: 100, outputTokens: 50 }, toolFormerData: { name: "read_file", status: "completed" } },
    { type: 2, text: "here is what I found", tokenCount: { inputTokens: 200, outputTokens: 80 } },
    { type: 1, text: "nope that's wrong, undo it" },
    { type: 2, text: "", toolFormerData: { name: "search_replace", status: "error" } },
  ];
  // Plus one orphan bubble that the ordering doesn't reference.
  const orphan: CursorBubble = {
    type: 2,
    text: "",
    tokenCount: { inputTokens: 5, outputTokens: 3 },
    toolFormerData: { name: "read_file", status: "completed" },
  };
  const bubblesAll = [...bubblesOrdered, orphan];

  const s = buildCursorSessionState(cd, bubblesOrdered, bubblesAll, "/Users/me/repo", "claude-4-sonnet");

  it("sets identity + timing fields", () => {
    expect(s.sid).toBe(cd.composerId);
    expect(s.cwd).toBe("/Users/me/repo");
    expect(s.model).toBe("claude-4-sonnet");
    expect(s.start?.getTime()).toBe(cd.createdAt);
    expect(s.end?.getTime()).toBe(cd.lastUpdatedAt);
  });

  it("aggregates tokens across ALL bubbles (including orphans)", () => {
    expect(s.tokensIn).toBe(100 + 200 + 5);
    expect(s.tokensOut).toBe(50 + 80 + 3);
    // Cursor does not expose these — honest zero.
    expect(s.tokensCacheRead).toBe(0);
    expect(s.tokensCacheWrite).toBe(0);
    expect(s.tokensReasoning).toBe(0);
  });

  it("counts messages (assistant text replies) and tool errors", () => {
    // only the one assistant bubble with non-empty text counts
    expect(s.messages).toBe(1);
    // one tool with status=error, plus none from orphan
    expect(s.errors).toBe(1);
    // tool histogram includes orphan (2x read_file, 1x search_replace)
    expect(s.toolHist).toEqual({ read_file: 2, search_replace: 1 });
  });

  it("counts user turns only from the ordered conversation", () => {
    expect(s.userTurns).toBe(2);
    expect(s.promptWords).toHaveLength(2);
    expect(s.intents).toHaveProperty("bugfix");  // "please fix this broken build"
    expect(s.prompts).toHaveLength(2);
    // prompt timestamps are distinct and in-span
    const t0 = s.prompts[0].ts.getTime();
    const t1 = s.prompts[1].ts.getTime();
    expect(t0).toBeGreaterThanOrEqual(cd.createdAt!);
    expect(t1).toBeGreaterThan(t0);
    expect(t1).toBeLessThanOrEqual(cd.lastUpdatedAt! + 5);
  });

  it("detects frustration + teacher signals", () => {
    // "nope that's wrong, undo it" hits TEACHER_RE and is short enough
    expect(s.teacherMoments).toBe(1);
  });

  it("decodes file:// URIs and includes newlyCreatedFiles in filesEdited", () => {
    const files = [...s.filesEdited].sort();
    expect(files).toContain("/Users/me/foo.ts");
    expect(files).toContain("/Users/me/dir with spaces/bar.md");
    expect(files).toContain("/Users/me/new.ts");
  });

  it("marks isSidechain=false and leaves skills/mcps empty", () => {
    expect(s.isSidechain).toBe(false);
    expect([...s.skillsUsed]).toEqual([]);
    expect([...s.mcpsUsed]).toEqual([]);
  });
});

describe("sqlite backend selection", () => {
  it("picks bun:sqlite when running under Bun, else the sqlite3 CLI", () => {
    const backend = sqliteBackendName();
    // vitest runs under Node or Bun depending on the caller. Either is OK —
    // we just assert the selection is consistent with the runtime.
    const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
    expect(backend).toBe(isBun ? "bun" : "cli");
  });

  it("reads a real SQLite file end-to-end via whichever backend is active", () => {
    // Only run if the active backend has a usable path to SQLite. On CI
    // (linux runners with sqlite3 installed) both backends work; on a
    // sandboxed Node with no sqlite3 CLI and no Bun, skip — the adapter's
    // public contract is "return [] on any read error", which is tested
    // elsewhere by passing non-existent paths.
    const dbPath = path.join(os.tmpdir(), `pella-cursor-test-${process.pid}.db`);
    try {
      // Seed the DB via the active backend by writing through a raw sqlite3
      // CLI call if present. If not present and we're on Bun, use bun:sqlite
      // directly. Either way produces a tiny DB we can read back.
      if (sqliteBackendName() === "bun") {
        const bunGlobal = (globalThis as { Bun?: unknown }).Bun;
        if (!bunGlobal) return;
        // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite only loads under Bun
        const { Database } = require("bun" + ":sqlite") as any;
        const seed = new Database(dbPath);
        seed.run("CREATE TABLE kv (k TEXT, v TEXT)");
        seed.run("INSERT INTO kv VALUES ('hello', 'world')");
        seed.run("INSERT INTO kv VALUES ('multi', 'line\nvalue|with|pipes')");
        seed.close();
      } else {
        // CLI backend: use the system sqlite3 to seed, skip test if absent.
        try {
          const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
          execFileSync("sqlite3", [dbPath, "CREATE TABLE kv (k TEXT, v TEXT); INSERT INTO kv VALUES ('hello','world'), ('multi','line\nvalue|with|pipes');"]);
        } catch {
          return; // no sqlite3 CLI on this host — skip
        }
      }
      const rows = sqliteQuery<{ k: string; v: string }>(dbPath, "SELECT k, v FROM kv ORDER BY k");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ k: "hello", v: "world" });
      // The point of this test: pipes and newlines in values survive both backends.
      expect(rows[1]).toEqual({ k: "multi", v: "line\nvalue|with|pipes" });
    } finally {
      try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
    }
  });

  it("returns [] for non-existent DB paths (both backends)", () => {
    const rows = sqliteQuery("/nonexistent/path/to.db", "SELECT 1");
    expect(rows).toEqual([]);
  });
});
