import { describe, expect, test } from "bun:test";
import {
  builtinVerifier,
  composeVerifiers,
  LLMVerifier,
  runVerify,
  type Verifier,
  type VerifyResult,
} from "./verify";

describe("Stage 3 — verify (unit)", () => {
  test("KEEPs a clean abstract", async () => {
    const r = await builtinVerifier.verify({
      abstract: "User asks how to refactor a small function.",
    });
    expect(r.decision).toBe("KEEP");
  });

  test("DROPs an abstract leaking an email", async () => {
    const r = await builtinVerifier.verify({ abstract: "Developer wants to email foo@bar.com" });
    expect(r.decision).toBe("DROP");
    expect(r.reasons).toContain("email");
  });

  test("DROPs an abstract leaking a leftover REDACTED marker", async () => {
    const r = await builtinVerifier.verify({
      abstract: "Build is failing on <REDACTED:secret:abc> token",
    });
    expect(r.decision).toBe("DROP");
    expect(r.reasons).toContain("leftover_redacted_marker");
  });

  test("LLMVerifier returns DROP when the LLM says YES", async () => {
    const v = new LLMVerifier(async () => "YES");
    const r = await v.verify({ abstract: "anything" });
    expect(r.decision).toBe("DROP");
  });

  test("LLMVerifier returns KEEP on NO", async () => {
    const v = new LLMVerifier(async () => "NO");
    const r = await v.verify({ abstract: "anything" });
    expect(r.decision).toBe("KEEP");
  });

  test("composeVerifiers short-circuits on first DROP", async () => {
    let firstCalls = 0;
    let fallbackCalls = 0;
    const first: Verifier = {
      verify(): VerifyResult {
        firstCalls++;
        return { decision: "DROP", reasons: ["first"] };
      },
    };
    const fallback: Verifier = {
      verify(): VerifyResult {
        fallbackCalls++;
        return { decision: "KEEP", reasons: [] };
      },
    };
    const composed = composeVerifiers(first, fallback);
    const r = await composed.verify({ abstract: "x" });
    expect(r.decision).toBe("DROP");
    expect(firstCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
  });

  test("composeVerifiers DROPs if EITHER says DROP", async () => {
    const composed = composeVerifiers(
      { verify: () => ({ decision: "KEEP", reasons: [] }) },
      builtinVerifier,
    );
    const r = await composed.verify({ abstract: "Email user@x.com" });
    expect(r.decision).toBe("DROP");
  });

  test("runVerify defaults to builtin", async () => {
    const r = await runVerify({ abstract: "User asks a generic question." });
    expect(r.decision).toBe("KEEP");
  });
});
