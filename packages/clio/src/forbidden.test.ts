import { describe, expect, test } from "bun:test";
import { assertNoForbiddenFields, ForbiddenFieldError, findForbiddenField } from "./forbidden";
import { FORBIDDEN_FIELDS } from "./types";

describe("forbidden field guard", () => {
  test("accepts a clean event-shaped object", () => {
    expect(() => assertNoForbiddenFields({ a: 1, nested: { b: "ok" } })).not.toThrow();
  });

  test("rejects each forbidden top-level key", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(() => assertNoForbiddenFields({ [f]: "x" })).toThrow(ForbiddenFieldError);
    }
  });

  test("rejects forbidden keys nested inside objects", () => {
    const event = { meta: { gen_ai: { prompt_text: "leak" } } };
    expect(() => assertNoForbiddenFields(event)).toThrow(/prompt_text/);
  });

  test("rejects forbidden keys inside arrays of objects", () => {
    const event = { trail: [{ ok: 1 }, { messages: [] }] };
    expect(() => assertNoForbiddenFields(event)).toThrow(/messages/);
  });

  test("findForbiddenField returns the path when present", () => {
    const r = findForbiddenField({ a: { b: { rawPrompt: "x" } } });
    expect(r).not.toBeNull();
    expect(r?.field).toBe("rawPrompt");
    expect(r?.path).toBe("$.a.b.rawPrompt");
  });

  test("findForbiddenField returns null on clean input", () => {
    expect(findForbiddenField({ a: 1 })).toBeNull();
  });

  test("does not blow up on cyclic refs (depth-capped)", () => {
    const a: Record<string, unknown> = { x: 1 };
    const b: Record<string, unknown> = { y: a };
    a.b = b;
    expect(() => assertNoForbiddenFields(a)).not.toThrow();
  });
});
