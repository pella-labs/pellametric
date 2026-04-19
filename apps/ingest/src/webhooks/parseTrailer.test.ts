import { describe, expect, test } from "bun:test";
import { parseAiAssistedTrailer, sanitizeCommitMessageForLog } from "./parseTrailer";

describe("parseAiAssistedTrailer — happy paths", () => {
  test("single trailer in tail paragraph", () => {
    const msg = [
      "fix(auth): token rotation bug",
      "",
      "Refresh before retry.",
      "",
      "AI-Assisted: bematist-abc12345-7c4c-4f71-9b4a-21d5f8e65e1e",
    ].join("\n");
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "abc12345-7c4c-4f71-9b4a-21d5f8e65e1e",
      tool: "bematist",
    });
  });

  test("trailer + other trailers in same block", () => {
    const msg = [
      "feat: add thing",
      "",
      "body",
      "",
      "Signed-off-by: Alice <alice@example.com>",
      "AI-Assisted: bematist-sess_abcdef01",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ].join("\n");
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "sess_abcdef01",
      tool: "bematist",
    });
  });

  test("CRLF line endings", () => {
    const msg =
      "subj\r\n\r\nbody\r\n\r\nAI-Assisted: bematist-01234567-abcd-ef01-2345-6789abcdef01\r\n";
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "01234567-abcd-ef01-2345-6789abcdef01",
      tool: "bematist",
    });
  });

  test("CR-only line endings (legacy Mac)", () => {
    const msg = "subj\r\rbody\r\rAI-Assisted: bematist-abcdefgh";
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "abcdefgh",
      tool: "bematist",
    });
  });

  test("case-insensitive key (AI-ASSISTED, ai-assisted)", () => {
    for (const key of ["ai-assisted", "AI-ASSISTED", "Ai-Assisted"]) {
      const msg = `subj\n\nbody\n\n${key}: bematist-SESSION-123abc`;
      expect(parseAiAssistedTrailer(msg)).toEqual({
        sessionId: "SESSION-123abc",
        tool: "bematist",
      });
    }
  });

  test("tolerates extra whitespace around colon and value", () => {
    const msg = "subj\n\nbody\n\nAI-Assisted :  bematist-abcdefgh0123  ";
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "abcdefgh0123",
      tool: "bematist",
    });
  });

  test("single-paragraph message IS itself the trailer block", () => {
    // No body, just the trailer.
    const msg = "AI-Assisted: bematist-onlytrailer1";
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "onlytrailer1",
      tool: "bematist",
    });
  });

  test("trailing newlines + whitespace do not confuse parser", () => {
    const msg = "subj\n\nAI-Assisted: bematist-tailspace1\n\n\n";
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "tailspace1",
      tool: "bematist",
    });
  });
});

describe("parseAiAssistedTrailer — rejection / null paths", () => {
  test("returns null on empty string / non-string", () => {
    expect(parseAiAssistedTrailer("")).toBeNull();
    expect(parseAiAssistedTrailer("   \n\n  ")).toBeNull();
    // @ts-expect-error testing non-string behavior
    expect(parseAiAssistedTrailer(undefined)).toBeNull();
    // @ts-expect-error testing non-string behavior
    expect(parseAiAssistedTrailer(null)).toBeNull();
  });

  test("returns null when trailer is in a NON-final paragraph", () => {
    const msg = [
      "subj",
      "",
      "AI-Assisted: bematist-earlyblock1",
      "",
      "final paragraph but this is prose, not a trailer line.",
    ].join("\n");
    // Final paragraph is prose → no trailers there; early AI-Assisted ignored.
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("returns null when tail paragraph mixes prose + trailer (prose poisons block)", () => {
    const msg = [
      "subj",
      "",
      "body",
      "",
      "This is not a trailer line.",
      "AI-Assisted: bematist-shouldignore",
    ].join("\n");
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("URL in trailer block → block is prose, parser abstains", () => {
    // A bare URL `https://example.com` matches `word:word` syntactically but
    // we guard with `[^/]` after the colon so URLs don't count as trailer
    // lines — and crucially, a URL in the tail block means the block is prose.
    const msg = [
      "subj",
      "",
      "body",
      "",
      "See: https://example.com",
      "AI-Assisted: bematist-sessionXY12",
    ].join("\n");
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("rejects missing bematist- prefix", () => {
    const msg = "subj\n\nAI-Assisted: copilot-abcdefgh01";
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("rejects uppercase BEMATIST- prefix (we require lowercase)", () => {
    const msg = "subj\n\nAI-Assisted: BEMATIST-abcdefgh01";
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("rejects sessionId too short (<8)", () => {
    const msg = "subj\n\nAI-Assisted: bematist-abc12";
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("rejects sessionId too long (>128)", () => {
    const long = "a".repeat(129);
    const msg = `subj\n\nAI-Assisted: bematist-${long}`;
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("rejects sessionId with spaces", () => {
    const msg = "subj\n\nAI-Assisted: bematist-abcd efgh";
    expect(parseAiAssistedTrailer(msg)).toBeNull();
  });

  test("rejects sessionId with SQL-injection-shaped content", () => {
    const attempts = [
      "abc'; DROP TABLE outcomes;--",
      'abc" OR 1=1 --',
      "abc;--",
      "../../etc/passwd",
      "abc\u0000nul",
      "abc\nnewline",
      "abc<script>",
      "abc`backtick",
    ];
    for (const a of attempts) {
      const msg = `subj\n\nAI-Assisted: bematist-${a}`;
      expect(parseAiAssistedTrailer(msg)).toBeNull();
    }
  });

  test("returns null on a commit with no trailer at all", () => {
    expect(parseAiAssistedTrailer("fix: something\n\nNo trailer here.")).toBeNull();
  });

  test("first matching trailer wins when multiple AI-Assisted lines exist", () => {
    // Defensive: we pick the first one, not the last, so a malicious actor
    // can't shadow an earlier valid trailer with a bogus second line.
    const msg = [
      "subj",
      "",
      "Signed-off-by: Alice",
      "AI-Assisted: bematist-firstwin123",
      "AI-Assisted: bematist-secondIgnored",
    ].join("\n");
    expect(parseAiAssistedTrailer(msg)).toEqual({
      sessionId: "firstwin123",
      tool: "bematist",
    });
  });

  test("empty commit message returns null", () => {
    expect(parseAiAssistedTrailer("")).toBeNull();
  });
});

describe("sanitizeCommitMessageForLog", () => {
  test("replaces message with char-count token", () => {
    expect(sanitizeCommitMessageForLog("hello")).toBe("<truncated:5-chars>");
    expect(sanitizeCommitMessageForLog("")).toBe("<truncated:0-chars>");
  });

  test("handles non-string input gracefully", () => {
    // @ts-expect-error non-string input
    expect(sanitizeCommitMessageForLog(undefined)).toBe("<truncated:0-chars>");
    // @ts-expect-error non-string input
    expect(sanitizeCommitMessageForLog(null)).toBe("<truncated:0-chars>");
  });
});
