import { describe, it, expect } from "vitest";
import { aggregate, aggregateBoth } from "../aggregate";

function row(overrides: Partial<any> = {}) {
  const start = new Date("2026-04-10T10:00:00Z");
  const end = new Date("2026-04-10T10:15:00Z");
  return {
    source: "claude",
    repo: "pella-labs/bematist",
    startedAt: start,
    endedAt: end,
    model: "claude-opus-4-7",
    tokensIn: 1000,
    tokensOut: 5000,
    tokensCacheRead: 50000,
    tokensCacheWrite: 1000,
    tokensReasoning: 0,
    messages: 20,
    userTurns: 5,
    errors: 0,
    filesEdited: [],
    toolHist: {},
    skillsUsed: [],
    mcpsUsed: [],
    intentTop: null,
    isSidechain: false,
    teacherMoments: 0,
    frustrationSpikes: 0,
    ...overrides,
  };
}

describe("aggregate", () => {
  it("handles empty input", () => {
    const r = aggregate([], "claude");
    expect(r.meta.sessions).toBe(0);
    expect(r.meta.tokensOut).toBe(0);
    expect(r.hours.labels.length).toBe(0);
  });

  it("filters by source", () => {
    const rows = [row({ source: "claude" }), row({ source: "codex" })];
    expect(aggregate(rows, "claude").meta.sessions).toBe(1);
    expect(aggregate(rows, "codex").meta.sessions).toBe(1);
  });

  it("sums totals correctly", () => {
    const rows = [
      row({ tokensIn: 100, tokensOut: 200, tokensCacheRead: 300, tokensCacheWrite: 50 }),
      row({ tokensIn: 400, tokensOut: 500, tokensCacheRead: 600, tokensCacheWrite: 100 }),
    ];
    const r = aggregate(rows, "claude");
    expect(r.meta.tokensIn).toBe(500);
    expect(r.meta.tokensOut).toBe(700);
    expect(r.meta.tokensCacheRead).toBe(900);
    expect(r.meta.tokensCacheWrite).toBe(150);
  });

  it("computes cacheHitPct = cacheRead / (cacheRead + in + cacheWrite)", () => {
    const rows = [row({ tokensIn: 100, tokensCacheRead: 900, tokensCacheWrite: 0 })];
    const r = aggregate(rows, "claude");
    expect(r.meta.cacheHitPct).toBeCloseTo(90, 1);
  });

  it("counts distinct repos", () => {
    const rows = [
      row({ repo: "pella-labs/a" }),
      row({ repo: "pella-labs/a" }),
      row({ repo: "pella-labs/b" }),
    ];
    expect(aggregate(rows, "claude").meta.projects).toBe(2);
  });

  it("classifies dormant session (10k+ tokens, no files)", () => {
    const rows = [row({ tokensOut: 20000, filesEdited: [], messages: 10, userTurns: 5 })];
    const r = aggregate(rows, "claude");
    expect(r.outcome.labels).toContain("dormant");
    expect(r.meta.wasteTokens).toBe(20000);
  });

  it("classifies in_progress when files are edited", () => {
    const rows = [row({ tokensOut: 20000, filesEdited: ["src/a.ts"], messages: 10 })];
    const r = aggregate(rows, "claude");
    expect(r.outcome.labels).toContain("in_progress");
    expect(r.meta.wasteTokens).toBe(0);
  });

  it("classifies stuck when errors/messages > 0.3 with duration >15min", () => {
    const rows = [row({
      errors: 5, messages: 10,
      startedAt: new Date("2026-04-10T10:00:00Z"),
      endedAt: new Date("2026-04-10T10:30:00Z"),
    })];
    const r = aggregate(rows, "claude");
    expect(r.outcome.labels).toContain("stuck");
  });

  it("classifies zombie when long duration + few messages per hour", () => {
    const rows = [row({
      messages: 5,
      startedAt: new Date("2026-04-10T00:00:00Z"),
      endedAt: new Date("2026-04-10T10:00:00Z"),   // 10 hours
    })];
    const r = aggregate(rows, "claude");
    expect(r.outcome.labels).toContain("zombie");
  });

  it("classifies planned when a planning skill is used", () => {
    const rows = [row({
      skillsUsed: ["superpowers:brainstorming"],
      filesEdited: ["x.ts"],
      messages: 10,
    })];
    const r = aggregate(rows, "claude");
    expect(r.outcome.labels).toContain("planned");
  });

  it("classifies explored when reads dominate and no edits", () => {
    const rows = [row({
      toolHist: { Read: 10, Grep: 5, Glob: 2 },
      filesEdited: [],
      tokensOut: 5000,
      messages: 10,
    })];
    const r = aggregate(rows, "claude");
    expect(r.outcome.labels).toContain("explored");
  });

  it("collects teacher moments + frustration across sessions", () => {
    const rows = [
      row({ teacherMoments: 3, frustrationSpikes: 1 }),
      row({ teacherMoments: 2, frustrationSpikes: 4 }),
    ];
    const r = aggregate(rows, "claude");
    expect(r.meta.teacherMoments).toBe(5);
    expect(r.meta.frustrationSpikes).toBe(5);
  });

  it("flags files touched in 3+ sessions as thrash", () => {
    const rows = [
      row({ filesEdited: ["src/hot.ts"] }),
      row({ filesEdited: ["src/hot.ts"] }),
      row({ filesEdited: ["src/hot.ts"] }),
      row({ filesEdited: ["src/cold.ts"] }),
    ];
    const r = aggregate(rows, "claude");
    expect(r.thrash.length).toBe(1);
    expect(r.thrash[0].file).toBe("src/hot.ts");
    expect(r.thrash[0].sessions).toBe(3);
  });

  it("computes per-repo breakdown sorted by output tokens desc", () => {
    const rows = [
      row({ repo: "o/a", tokensOut: 100 }),
      row({ repo: "o/b", tokensOut: 500 }),
      row({ repo: "o/c", tokensOut: 300 }),
    ];
    const r = aggregate(rows, "claude");
    expect(r.repos[0].repo).toBe("o/b");
    expect(r.repos[1].repo).toBe("o/c");
  });

  it("aggregateBoth returns claude + codex keys", () => {
    const r = aggregateBoth([row({ source: "claude" }), row({ source: "codex" })] as any);
    expect(r).toHaveProperty("claude");
    expect(r).toHaveProperty("codex");
    expect(r.claude.meta.sessions).toBe(1);
    expect(r.codex.meta.sessions).toBe(1);
  });
});
