import { describe, it, expect } from "vitest";
import { scoreCommitAttribution, type CommitForAttribution } from "@/lib/lineage/attribute";

const baseCommit = (overrides: Partial<CommitForAttribution> = {}): CommitForAttribution => ({
  authorLogin: "walid",
  authorEmail: "walid@example.com",
  committerEmail: null,
  message: "fix typo",
  additions: 1,
  deletions: 1,
  files: ["README.md"],
  ...overrides,
});

describe("scoreCommitAttribution", () => {
  it("flags bot accounts terminally (P4)", () => {
    const r = scoreCommitAttribution(
      baseCommit({ authorLogin: "dependabot[bot]" }),
      null,
      { useCursor: false },
    );
    expect(r.aiSources).toEqual(["bot"]);
    expect(r.aiConfidence).toBe(100);
  });

  it("trailer + anthropic email → claude @ 90 confidence", () => {
    const r = scoreCommitAttribution(
      baseCommit({
        committerEmail: "noreply@anthropic.com",
        message: "feat: do thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
      }),
      null,
      { useCursor: false },
    );
    expect(r.aiSources).toContain("claude");
    expect(r.aiConfidence).toBe(90);
  });

  it("anthropic email alone → unknown @ 30 (P8)", () => {
    const r = scoreCommitAttribution(
      baseCommit({ committerEmail: "noreply@anthropic.com", message: "fix bug" }),
      null,
      { useCursor: false },
    );
    expect(r.aiSources).toContain("unknown");
    expect(r.aiSources).not.toContain("claude");
    expect(r.aiConfidence).toBe(30);
  });

  it("multi-source: cursor + claude trailers both detected (P6)", () => {
    const r = scoreCommitAttribution(
      baseCommit({
        message: "feat: x\n\nCo-Authored-By: Claude <a>\nCo-Authored-By: Cursor <b>",
      }),
      null,
      { useCursor: false },
    );
    expect(r.aiSources).toEqual(expect.arrayContaining(["claude", "cursor"]));
  });

  it("codex session-join inference fires only without trailers (P32)", () => {
    const r = scoreCommitAttribution(
      baseCommit({ message: "fix" }),
      { source: "codex", confidence: "high" },
      { useCursor: false },
    );
    expect(r.aiSources).toContain("codex");
    expect(r.aiConfidence).toBe(50);
  });

  it("cursor opt-in session-join only when org flag enabled (P31)", () => {
    const off = scoreCommitAttribution(
      baseCommit({ message: "fix" }),
      { source: "cursor", confidence: "high" },
      { useCursor: false },
    );
    expect(off.aiSources).toContain("human");

    const on = scoreCommitAttribution(
      baseCommit({ message: "fix" }),
      { source: "cursor", confidence: "high" },
      { useCursor: true },
    );
    expect(on.aiSources).toContain("cursor");
  });

  it("default human when no signals", () => {
    const r = scoreCommitAttribution(
      baseCommit({ message: "wip" }),
      null,
      { useCursor: false },
    );
    expect(r.aiSources).toEqual(["human"]);
  });
});
