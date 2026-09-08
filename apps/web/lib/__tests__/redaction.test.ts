import { describe, it, expect } from "vitest";
import { redactCommitMessage } from "@/lib/lineage/redact";

describe("redactCommitMessage", () => {
  it("redacts AWS access keys", () => {
    const r = redactCommitMessage("seed creds: AKIAIOSFODNN7EXAMPLE oops");
    expect(r.redacted).toContain("[REDACTED:aws_key]");
    expect(r.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.wasRedacted).toBe(true);
  });

  it("redacts GitHub PATs", () => {
    const r = redactCommitMessage("token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(r.redacted).toContain("[REDACTED:github_pat]");
    expect(r.wasRedacted).toBe(true);
  });

  it("redacts Anthropic keys", () => {
    const r = redactCommitMessage("hardcoded sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(r.redacted).toContain("[REDACTED:anthropic]");
    expect(r.wasRedacted).toBe(true);
  });

  it("redacts high-entropy bounded strings", () => {
    const r = redactCommitMessage("secret=abcDEF0123456789abcDEF0123456789abcDEF");
    expect(r.redacted).toContain("[REDACTED:high_entropy]");
    expect(r.wasRedacted).toBe(true);
  });

  it("leaves benign messages unchanged", () => {
    const r = redactCommitMessage("fix typo in README");
    expect(r.redacted).toBe("fix typo in README");
    expect(r.wasRedacted).toBe(false);
    expect(r.truncated).toBe(false);
  });

  it("truncates messages over 1024 chars", () => {
    // Use real prose so high-entropy regex doesn't compact the input first.
    const sentence = "refactor module to remove circular dependency on user store. ";
    const big = sentence.repeat(40); // ~2480 chars
    const r = redactCommitMessage(big);
    expect(r.redacted.length).toBe(1024);
    expect(r.truncated).toBe(true);
  });
});
