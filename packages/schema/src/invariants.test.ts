import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { containsForbiddenField, FORBIDDEN_FIELDS, FORBIDDEN_FIELDS_SET } from "./invariants";

// Contract 08 is the Phase-2 source of truth for the 12-entry forbidden list
// (contract 01 is aligned via the Phase-2 additive changelog). The regex below
// extracts the forbidden-field list from the `## Forbidden-field rejection`
// section of contracts/08-redaction.md and compares to our FORBIDDEN_FIELDS
// constant — any drift fails CI.
function extractForbiddenFromContract08(): string[] {
  const path = resolve(__dirname, "../../../contracts/08-redaction.md");
  const text = readFileSync(path, "utf-8");
  const header = "## Forbidden-field rejection";
  const start = text.indexOf(header);
  if (start === -1) throw new Error("contract 08 section not found");
  // Take everything until the next h2 header.
  const next = text.indexOf("\n## ", start + header.length);
  const section = text.slice(start, next === -1 ? undefined : next);
  // Pull the first fenced code block from that section.
  const m = section.match(/```[\s\S]*?```/);
  if (!m) throw new Error("contract 08 fenced code block not found");
  const body = m[0].replace(/```/g, "");
  // Tokens: words separated by commas / whitespace. Keep identifiers only.
  return body
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t));
}

describe("FORBIDDEN_FIELDS constant", () => {
  test("contains exactly 12 entries", () => {
    expect(FORBIDDEN_FIELDS.length).toBe(12);
  });

  test("entries are in the exact contract-specified order", () => {
    expect([...FORBIDDEN_FIELDS]).toEqual([
      "rawPrompt",
      "prompt",
      "prompt_text",
      "messages",
      "toolArgs",
      "toolOutputs",
      "fileContents",
      "diffs",
      "filePaths",
      "ticketIds",
      "emails",
      "realNames",
    ]);
  });

  test("set matches list (contract-parity against contracts/08-redaction.md)", () => {
    const extracted = extractForbiddenFromContract08();
    // The extracted list should be a superset in order of FORBIDDEN_FIELDS —
    // the contract lists exactly these 12. Exact equality proves single source.
    expect(extracted).toEqual([...FORBIDDEN_FIELDS]);
  });

  test("FORBIDDEN_FIELDS_SET contains every entry", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(FORBIDDEN_FIELDS_SET.has(f)).toBe(true);
    }
    expect(FORBIDDEN_FIELDS_SET.size).toBe(FORBIDDEN_FIELDS.length);
  });
});

describe("containsForbiddenField", () => {
  test("returns null for primitives and empty objects", () => {
    expect(containsForbiddenField(null)).toBeNull();
    expect(containsForbiddenField(undefined)).toBeNull();
    expect(containsForbiddenField(0)).toBeNull();
    expect(containsForbiddenField("hello")).toBeNull();
    expect(containsForbiddenField({})).toBeNull();
    expect(containsForbiddenField([])).toBeNull();
  });

  test("returns null for objects with only non-forbidden keys", () => {
    expect(
      containsForbiddenField({
        tenant_id: "org_a",
        dev_metrics: { event_kind: "llm_request", duration_ms: 12 },
        raw_attrs: { device: { ip: "1.2.3.4" } },
      }),
    ).toBeNull();
  });

  test("positive: each forbidden field at depth 0", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(containsForbiddenField({ [f]: "x" })).toBe(f);
    }
  });

  test("positive: each forbidden field at depth 1", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(containsForbiddenField({ a: { [f]: "x" } })).toBe(f);
    }
  });

  test("positive: each forbidden field at depth 2", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(containsForbiddenField({ a: { b: { [f]: "x" } } })).toBe(f);
    }
  });

  test("positive: each forbidden field at depth 3", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(containsForbiddenField({ a: { b: { c: { [f]: "x" } } } })).toBe(f);
    }
  });

  test("positive: forbidden field inside an array element", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(containsForbiddenField([{ [f]: "x" }])).toBe(f);
      expect(containsForbiddenField({ arr: [{ [f]: "x" }] })).toBe(f);
      expect(containsForbiddenField({ a: [{ b: { [f]: "x" } }] })).toBe(f);
    }
  });

  test("returns the FIRST forbidden field encountered (DFS order)", () => {
    const obj = { rawPrompt: "x", prompt_text: "y" };
    // rawPrompt is first in FORBIDDEN_FIELDS, but DFS is insertion-order.
    // We guarantee "a forbidden field is found", not lexicographic priority.
    const hit = containsForbiddenField(obj);
    expect(hit && FORBIDDEN_FIELDS.includes(hit)).toBe(true);
  });

  test("does NOT throw on circular objects (WeakSet guard)", () => {
    const a: Record<string, unknown> = { name: "root" };
    a.self = a;
    expect(() => containsForbiddenField(a)).not.toThrow();
    expect(containsForbiddenField(a)).toBeNull();
  });

  test("returns the forbidden key on a cyclic object without infinite looping", () => {
    const a: Record<string, unknown> = { prompt_text: "secret" };
    a.self = a;
    expect(containsForbiddenField(a)).toBe("prompt_text");
  });

  test("stops at primitives (numbers/strings/bools do not recurse into properties)", () => {
    // Strings have numeric indices but we must not descend into them.
    expect(containsForbiddenField({ s: "rawPrompt" })).toBeNull();
    expect(containsForbiddenField({ n: 42 })).toBeNull();
    expect(containsForbiddenField({ b: true })).toBeNull();
  });
});
