import { describe, it, expect } from "vitest";
import { classifyIntent, TEACHER_RE, FRUSTRATION_RE, parseGithubRemote } from "../classify";

describe("classifyIntent", () => {
  it("recognises approvals", () => {
    expect(classifyIntent("sure")).toBe("approval");
    expect(classifyIntent("ok")).toBe("approval");
    expect(classifyIntent("yes")).toBe("approval");
    expect(classifyIntent("do it")).toBe("approval");
    expect(classifyIntent("yep!")).toBe("approval");
  });

  it("long approval-like text falls through to other classes", () => {
    const long = "ok but before we continue can you explain how the ingest pipeline batches sessions";
    expect(classifyIntent(long)).not.toBe("approval");
  });

  it("bugfix beats feature + refactor when keywords overlap", () => {
    expect(classifyIntent("fix the broken crash in the build")).toBe("bugfix");
  });

  it("refactor classified from rename/simplify/cleanup", () => {
    expect(classifyIntent("rename this variable across the file")).toBe("refactor");
    expect(classifyIntent("clean up the whole module")).toBe("refactor");
  });

  it("feature for add/build/implement/setup/wire", () => {
    expect(classifyIntent("add a new invite flow")).toBe("feature");
    expect(classifyIntent("implement the collector")).toBe("feature");
    expect(classifyIntent("wire up the ingest route")).toBe("feature");
  });

  it("exploration for how/what/why", () => {
    expect(classifyIntent("how does this batching work")).toBe("exploration");
    expect(classifyIntent("what is the cache hit rate")).toBe("exploration");
  });

  it("falls back to 'other' when nothing matches", () => {
    expect(classifyIntent("asdf qwerty")).toBe("other");
    expect(classifyIntent("")).toBe("other");
  });
});

describe("TEACHER_RE", () => {
  it("detects correction language", () => {
    expect(TEACHER_RE.test("no do it differently")).toBe(true);
    expect(TEACHER_RE.test("that's not right")).toBe(true);
    expect(TEACHER_RE.test("undo that")).toBe(true);
    expect(TEACHER_RE.test("actually let's skip it")).toBe(true);
    expect(TEACHER_RE.test("nope")).toBe(true);
  });
  it("does not match neutral text", () => {
    expect(TEACHER_RE.test("looking good, ship it")).toBe(false);
    expect(TEACHER_RE.test("add a column for created_at")).toBe(false);
  });
});

describe("FRUSTRATION_RE", () => {
  it("catches common frustration markers", () => {
    expect(FRUSTRATION_RE.test("wtf is this")).toBe(true);
    expect(FRUSTRATION_RE.test("ugh")).toBe(true);
    expect(FRUSTRATION_RE.test("STOP")).toBe(true);          // all caps
    expect(FRUSTRATION_RE.test("no!!")).toBe(true);          // repeated !
  });
  it("does not fire on short ALL CAPS words (<4 chars) or normal text", () => {
    expect(FRUSTRATION_RE.test("OK now add a row")).toBe(false);
    expect(FRUSTRATION_RE.test("what's the next step")).toBe(false);
  });
});

describe("parseGithubRemote", () => {
  it("parses https url", () => {
    expect(parseGithubRemote("https://github.com/pella-labs/bematist.git")).toEqual({ owner: "pella-labs", repo: "bematist" });
  });
  it("parses ssh url", () => {
    expect(parseGithubRemote("git@github.com:pella-labs/pharos.git")).toEqual({ owner: "pella-labs", repo: "pharos" });
  });
  it("returns null for non-github", () => {
    expect(parseGithubRemote("git@gitlab.com:foo/bar.git")).toBeNull();
    expect(parseGithubRemote("")).toBeNull();
  });
});
