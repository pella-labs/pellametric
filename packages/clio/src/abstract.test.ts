import { describe, expect, test } from "bun:test";
import {
  type AbstractProvider,
  CloudProviderRefusedError,
  MCPAbstractProvider,
  normalizeAbstract,
  OllamaAbstractProvider,
  runAbstract,
} from "./abstract";

function makeStubProvider(opts: {
  id?: AbstractProvider["id"];
  healthy?: boolean;
  output?: string;
  fail?: boolean;
}): AbstractProvider {
  return {
    id: (opts.id ?? "claude-code-mcp") as AbstractProvider["id"],
    isCloud: false,
    async health() {
      return opts.healthy === false ? { ok: false, reason: "down" } : { ok: true };
    },
    async abstract() {
      if (opts.fail) throw new Error("boom");
      return { abstract: opts.output ?? "A two-sentence summary.", provider: this.id };
    },
  };
}

describe("Stage 2 — abstract", () => {
  test("returns first healthy provider's abstract", async () => {
    const r = await runAbstract({ redactedText: "foo" }, [
      makeStubProvider({ id: "claude-code-mcp", output: "first" }),
      makeStubProvider({ id: "ollama-qwen", output: "second" }),
    ]);
    expect(r).toEqual({ pending: false, abstract: "first", provider: "claude-code-mcp" });
  });

  test("falls through unhealthy providers", async () => {
    const r = await runAbstract({ redactedText: "foo" }, [
      makeStubProvider({ id: "claude-code-mcp", healthy: false }),
      makeStubProvider({ id: "ollama-qwen", output: "ollama-said-this" }),
    ]);
    expect(r).toEqual({ pending: false, abstract: "ollama-said-this", provider: "ollama-qwen" });
  });

  test("falls through providers that throw", async () => {
    const r = await runAbstract({ redactedText: "foo" }, [
      makeStubProvider({ id: "claude-code-mcp", fail: true }),
      makeStubProvider({ id: "ollama-qwen", output: "ok" }),
    ]);
    expect(r.pending).toBe(false);
  });

  test("returns pending when no provider configured", async () => {
    const r = await runAbstract({ redactedText: "foo" }, []);
    expect(r.pending).toBe(true);
  });

  test("returns pending when all providers fail/unhealthy", async () => {
    const r = await runAbstract({ redactedText: "foo" }, [
      makeStubProvider({ healthy: false }),
      makeStubProvider({ id: "ollama-qwen", fail: true }),
    ]);
    expect(r.pending).toBe(true);
    if (r.pending) expect(r.reason).toMatch(/no healthy local provider/);
  });

  test("rejects a provider mis-flagged as cloud (Invariant 2)", async () => {
    const sneaky = {
      id: "claude-code-mcp" as const,
      isCloud: true,
      async health() {
        return { ok: true };
      },
      async abstract() {
        return { abstract: "x", provider: "claude-code-mcp" as const };
      },
    } as unknown as AbstractProvider;
    await expect(runAbstract({ redactedText: "x" }, [sneaky])).rejects.toBeInstanceOf(
      CloudProviderRefusedError,
    );
  });

  test("treats empty abstract as failure and falls through", async () => {
    const r = await runAbstract({ redactedText: "foo" }, [
      makeStubProvider({ output: "" }),
      makeStubProvider({ id: "ollama-qwen", output: "fallback" }),
    ]);
    expect(r.pending).toBe(false);
    if (!r.pending) expect(r.abstract).toBe("fallback");
  });
});

describe("normalizeAbstract", () => {
  test("trims to ≤3 sentences", () => {
    const out = normalizeAbstract("One. Two. Three. Four. Five.");
    expect(out.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
  });

  test("strips lingering REDACTED markers", () => {
    const out = normalizeAbstract("User asked about <REDACTED:secret:abcdef> a key");
    expect(out).not.toContain("<REDACTED:");
  });

  test("collapses whitespace", () => {
    const out = normalizeAbstract("  hello\n\n  world  ");
    expect(out).toBe("hello world");
  });

  test("hard-caps at 500 chars", () => {
    const long = "a ".repeat(500);
    const out = normalizeAbstract(long);
    expect(out.length).toBeLessThanOrEqual(500);
  });
});

describe("MCPAbstractProvider", () => {
  test("calls the wrapped MCP function and normalizes output", async () => {
    const provider = new MCPAbstractProvider({
      id: "claude-code-mcp",
      call: async () => "Some answer.\n\nMore detail.",
    });
    const r = await provider.abstract({ redactedText: "x" });
    expect(r.provider).toBe("claude-code-mcp");
    expect(r.abstract.length).toBeGreaterThan(0);
  });

  test("health honors the optional probe", async () => {
    const yes = new MCPAbstractProvider({
      id: "claude-code-mcp",
      call: async () => "x",
      probe: async () => true,
    });
    const no = new MCPAbstractProvider({
      id: "claude-code-mcp",
      call: async () => "x",
      probe: async () => false,
    });
    expect((await yes.health()).ok).toBe(true);
    expect((await no.health()).ok).toBe(false);
  });
});

describe("OllamaAbstractProvider", () => {
  test("hits the local /api/tags + /api/generate endpoints", async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (typeof url === "string" && url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ response: "abstracted" }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OllamaAbstractProvider({
      baseUrl: "http://localhost:11434",
      fetchImpl: fakeFetch,
    });
    expect((await p.health()).ok).toBe(true);
    const r = await p.abstract({ redactedText: "foo" });
    expect(r.abstract).toBe("abstracted");
    expect(r.provider).toBe("ollama-qwen");
    expect(calls.some((c) => c.includes("/api/generate"))).toBe(true);
  });

  test("returns unhealthy when ollama is unreachable", async () => {
    const fakeFetch: typeof fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const p = new OllamaAbstractProvider({ fetchImpl: fakeFetch });
    expect((await p.health()).ok).toBe(false);
  });
});
