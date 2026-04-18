// E2E pipeline tests (contract 06).
//
// Critical assertion (D27): the raw prompt MUST NOT reach the embed stage.
// `embedSpy` records every input the embedder sees; the test fails if it
// ever sees the original raw text.

import { describe, expect, test } from "bun:test";
import {
  type AbstractProvider,
  attachPromptRecord,
  builtinVerifier,
  type Embedder,
  ForbiddenFieldError,
  HashingEmbedder,
  runPipeline,
} from "./index";

function stubAbstractProvider(out: string): AbstractProvider {
  return {
    id: "claude-code-mcp",
    isCloud: false,
    async health() {
      return { ok: true };
    },
    async abstract() {
      return { abstract: out, provider: "claude-code-mcp" };
    },
  };
}

function spyingEmbedder(): { embedder: Embedder; seen: string[] } {
  const seen: string[] = [];
  const inner = new HashingEmbedder();
  const embedder: Embedder = {
    async embed(req) {
      seen.push(req.abstract);
      return inner.embed(req);
    },
  };
  return { embedder, seen };
}

describe("clio pipeline — E2E", () => {
  test("raw prompt NEVER reaches the embed stage (D27 invariant)", async () => {
    const RAW = "ping alex@stripe.com about ticket BEMA-204 from /Users/sgarces/secrets.txt";
    const { embedder, seen } = spyingEmbedder();
    const result = await runPipeline(
      {
        session_id: "sess-1",
        prompt_index: 0,
        rawPromptText: RAW,
        tier: "B",
      },
      {
        abstractProviders: [stubAbstractProvider("Developer asks how to refactor a helper.")],
        verifier: { verify: () => ({ decision: "KEEP", reasons: [] }) },
        embedder,
      },
    );
    expect(result.kind).toBe("emitted");
    if (result.kind !== "emitted") return;
    // The embedder MUST NOT have seen the raw prompt or any of its identifying
    // fragments — only the abstract.
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe("Developer asks how to refactor a helper.");
    for (const fragment of ["alex@stripe.com", "BEMA-204", "/Users/sgarces"]) {
      expect(seen[0]).not.toContain(fragment);
    }
    // The emitted record must carry only the abstract — never the raw text.
    expect(result.record.abstract).not.toContain("alex@stripe.com");
    expect(result.record.abstract).not.toContain("BEMA-204");
    expect(JSON.stringify(result.record)).not.toContain(RAW);
  });

  test("Tier A skips the pipeline entirely (no abstract, no embed)", async () => {
    const { embedder, seen } = spyingEmbedder();
    const r = await runPipeline(
      { session_id: "s", prompt_index: 0, rawPromptText: "anything", tier: "A" },
      { embedder },
    );
    expect(r.kind).toBe("skipped_tier_a");
    expect(seen.length).toBe(0);
  });

  test("verifier DROP yields no record at all", async () => {
    const { embedder, seen } = spyingEmbedder();
    const r = await runPipeline(
      { session_id: "s", prompt_index: 0, rawPromptText: "x", tier: "B" },
      {
        abstractProviders: [stubAbstractProvider("Walid Hossain pushed a fix.")],
        verifier: builtinVerifier,
        embedder,
      },
    );
    expect(r.kind).toBe("dropped_by_verifier");
    expect(seen.length).toBe(0);
  });

  test("no abstract provider → emits abstract_pending=true (no embed call)", async () => {
    const { embedder, seen } = spyingEmbedder();
    const r = await runPipeline(
      { session_id: "s", prompt_index: 0, rawPromptText: "x", tier: "B" },
      { abstractProviders: [], embedder },
    );
    expect(r.kind).toBe("emitted");
    if (r.kind !== "emitted") return;
    expect(r.record.abstract_pending).toBe(true);
    expect(r.record.abstract).toBe("");
    expect(r.record.embedding).toBeUndefined();
    expect(seen.length).toBe(0);
  });

  test("session_id is hashed before emit (raw never crosses wire)", async () => {
    const r = await runPipeline(
      { session_id: "raw-session-id-xyz", prompt_index: 0, rawPromptText: "x", tier: "B" },
      {
        abstractProviders: [stubAbstractProvider("A clean abstract.")],
        verifier: { verify: () => ({ decision: "KEEP", reasons: [] }) },
        embedder: new HashingEmbedder(),
      },
    );
    expect(r.kind).toBe("emitted");
    if (r.kind !== "emitted") return;
    expect(r.record.session_id_hash).not.toBe("raw-session-id-xyz");
    expect(r.record.session_id_hash.length).toBe(32);
  });

  test("emitted record carries pipeline_version", async () => {
    const r = await runPipeline(
      { session_id: "s", prompt_index: 0, rawPromptText: "hi", tier: "B" },
      {
        abstractProviders: [stubAbstractProvider("A clean abstract.")],
        verifier: { verify: () => ({ decision: "KEEP", reasons: [] }) },
        embedder: new HashingEmbedder(),
      },
    );
    expect(r.kind).toBe("emitted");
    if (r.kind !== "emitted") return;
    expect(r.record.redaction_report.pipeline_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("redaction happens BEFORE abstract (Stage 2 sees no secrets)", async () => {
    let seenByAbstract = "";
    const provider: AbstractProvider = {
      id: "claude-code-mcp",
      isCloud: false,
      async health() {
        return { ok: true };
      },
      async abstract(req) {
        seenByAbstract = req.redactedText;
        return { abstract: "User asks about an API call.", provider: "claude-code-mcp" };
      },
    };
    await runPipeline(
      {
        session_id: "s",
        prompt_index: 0,
        rawPromptText: "Use AKIAIOSFODNN7EXAMPLE for boto3",
        tier: "B",
      },
      {
        abstractProviders: [provider],
        verifier: { verify: () => ({ decision: "KEEP", reasons: [] }) },
        embedder: new HashingEmbedder(),
      },
    );
    expect(seenByAbstract).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(seenByAbstract).toMatch(/<REDACTED:secret:/);
  });

  test("attachPromptRecord returns null when adapter passes Tier A", async () => {
    const ev = { source: "claude-code", x: 1 };
    const out = await attachPromptRecord(ev, "anything", {
      session_id: "s",
      prompt_index: 0,
      tier: "A",
    });
    expect(out).toBeNull();
  });

  test("attachPromptRecord returns null on verifier drop", async () => {
    const ev = { source: "claude-code", x: 1 };
    const out = await attachPromptRecord(ev, "anything", {
      session_id: "s",
      prompt_index: 0,
      tier: "B",
      deps: {
        abstractProviders: [stubAbstractProvider("Walid pushed a fix.")],
        verifier: builtinVerifier,
        embedder: new HashingEmbedder(),
      },
    });
    expect(out).toBeNull();
  });

  test("attachPromptRecord throws on a forbidden field on the input event", async () => {
    const ev = { source: "claude-code", prompt_text: "leak" };
    await expect(
      attachPromptRecord(ev, "anything", {
        session_id: "s",
        prompt_index: 0,
        tier: "B",
        deps: {
          abstractProviders: [stubAbstractProvider("ok")],
          embedder: new HashingEmbedder(),
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenFieldError);
  });

  test("attachPromptRecord attaches a clean record on success", async () => {
    const ev = { source: "claude-code", token_count: 42 };
    const out = await attachPromptRecord(ev, "Use AKIAIOSFODNN7EXAMPLE for boto3", {
      session_id: "s",
      prompt_index: 0,
      tier: "C",
      deps: {
        abstractProviders: [stubAbstractProvider("Developer asks about an SDK.")],
        verifier: { verify: () => ({ decision: "KEEP", reasons: [] }) },
        embedder: new HashingEmbedder(),
      },
    });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.source).toBe("claude-code");
    expect(out.token_count).toBe(42);
    expect(out.prompt_record.abstract).toBe("Developer asks about an SDK.");
    expect(out.prompt_record.embedding?.length).toBe(384);
    // Belt-and-braces — emitted event must not contain raw secret string.
    expect(JSON.stringify(out)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
