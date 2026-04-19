import { describe, expect, test } from "bun:test";
import { findMarkers, REDACTION_MARKER_REGEX } from "./redactionMarker";

describe("findMarkers", () => {
  test("returns empty on text with no markers", () => {
    expect(findMarkers("just regular prose, no markers here")).toEqual([]);
  });

  test("parses a single marker with correct indices", () => {
    const text = "token <REDACTED:secret:0123456789abcdef> here";
    const markers = findMarkers(text);
    expect(markers).toHaveLength(1);
    const [m] = markers;
    expect(m).toBeDefined();
    expect(m?.type).toBe("secret");
    expect(m?.hash).toBe("0123456789abcdef");
    if (!m) throw new Error("expected marker");
    expect(text.slice(m.start, m.end)).toBe("<REDACTED:secret:0123456789abcdef>");
  });

  test("parses multiple markers in one string", () => {
    const text =
      "hello <REDACTED:email:aaaaaaaaaaaaaaaa> and <REDACTED:phone:bbbbbbbbbbbbbbbb> world";
    const markers = findMarkers(text);
    expect(markers.map((m) => m.type)).toEqual(["email", "phone"]);
    expect(markers.map((m) => m.hash)).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
  });

  test("coerces unknown type tokens to 'other' to stay forward-compatible", () => {
    const text = "<REDACTED:futuretype:cccccccccccccccc>";
    const markers = findMarkers(text);
    expect(markers[0]?.type).toBe("other");
  });

  test("ignores malformed markers", () => {
    const malformed = [
      "<REDACTED:secret>",
      "<REDACTED:secret:tooshort>",
      "<REDACTED:SECRET:abcdef1234567890>", // uppercase not in our charset
      "<REDACTED::abcdef1234567890>",
    ];
    for (const m of malformed) {
      expect(findMarkers(m)).toEqual([]);
    }
  });

  test("regex is idempotent under repeated calls (no dangling lastIndex)", () => {
    const text = "<REDACTED:secret:0123456789abcdef>";
    expect(findMarkers(text)).toHaveLength(1);
    expect(findMarkers(text)).toHaveLength(1);
    // sanity: the regex has the /g flag
    expect(REDACTION_MARKER_REGEX.flags).toContain("g");
  });
});
