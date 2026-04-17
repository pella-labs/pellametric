import { describe, expect, test } from "bun:test";
import { noopRedactStage, type RedactInput, type RedactOutput, type RedactStage } from "./stage";

describe("noopRedactStage", () => {
  test("returns input fields unchanged, redaction_count=0, markers=[]", async () => {
    const input: RedactInput = {
      prompt_text: "hello world",
      tool_input: { cmd: "ls" },
      tool_output: "files",
      raw_attrs: { schema_version: 1 },
      tier: "C",
    };
    const r = await noopRedactStage.run(input);
    expect(r.prompt_text).toBe("hello world");
    expect(r.tool_input).toEqual({ cmd: "ls" });
    expect(r.tool_output).toBe("files");
    expect(r.raw_attrs).toEqual({ schema_version: 1 });
    expect(r.redaction_count).toBe(0);
    expect(r.redaction_breakdown).toEqual({});
    expect(r.markers).toEqual([]);
    expect(r.raw_attrs_filtered).toBe(false);
  });

  test("leaves undefined fields undefined", async () => {
    const r = await noopRedactStage.run({ tier: "A" });
    expect(r.prompt_text).toBeUndefined();
    expect(r.tool_input).toBeUndefined();
    expect(r.tool_output).toBeUndefined();
    expect(r.raw_attrs).toBeUndefined();
    expect(r.redaction_count).toBe(0);
  });
});

describe("RedactStage interface", () => {
  test("type-checks a mock implementation and tracks call count", async () => {
    let calls = 0;
    const mock: RedactStage = {
      async run(input) {
        calls++;
        const out: RedactOutput = {
          redaction_count: 1,
          redaction_breakdown: { secret: 1 },
          markers: [{ type: "secret", hash: "abc", detector: "gitleaks", rule: "TestRule" }],
          raw_attrs_filtered: false,
        };
        if (input.prompt_text !== undefined) out.prompt_text = input.prompt_text;
        if (input.tool_input !== undefined) out.tool_input = input.tool_input;
        if (input.tool_output !== undefined) out.tool_output = input.tool_output;
        if (input.raw_attrs !== undefined) out.raw_attrs = input.raw_attrs;
        return out;
      },
    };
    await mock.run({ tier: "B", prompt_text: "p" });
    await mock.run({ tier: "B" });
    expect(calls).toBe(2);
  });

  test("synchronous-returning impl is accepted (run may return non-Promise)", async () => {
    const sync: RedactStage = {
      run(input) {
        const out: RedactOutput = {
          redaction_count: 0,
          redaction_breakdown: {},
          markers: [],
          raw_attrs_filtered: false,
        };
        if (input.prompt_text !== undefined) out.prompt_text = input.prompt_text;
        if (input.tool_input !== undefined) out.tool_input = input.tool_input;
        if (input.tool_output !== undefined) out.tool_output = input.tool_output;
        if (input.raw_attrs !== undefined) out.raw_attrs = input.raw_attrs;
        return out;
      },
    };
    const r = await sync.run({ tier: "A" });
    expect(r.redaction_count).toBe(0);
  });
});
