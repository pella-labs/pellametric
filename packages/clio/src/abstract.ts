// Stage 2 — Abstract (contract 06 §2).
//
// Priority chain (never skip to a later tier if an earlier one is healthy):
//   1. User's own running Claude Code / Codex via local MCP.
//   2. Local Ollama with Qwen 2.5-7B (bundled config).
//   3. Skip — flag `abstract_pending: true`; ingest may retry on permitted
//      server-side models.
//
// HARD RULE (contract 06 Invariant 2): NEVER a cloud LLM on raw prompt.
// `CloudProviderRefusedError` is thrown if an attempted provider self-reports
// as cloud-backed — trust no flag but our own switch statement.
//
// Inputs to this stage are ALWAYS the already-redacted text from Stage 1
// (Invariant in pipeline.ts). The provider still gets a redacted envelope —
// belt-and-braces.

export type AbstractProviderId = "claude-code-mcp" | "codex-mcp" | "ollama-qwen";

export interface AbstractRequest {
  /** Redacted prompt text from Stage 1. Raw prompts MUST NOT reach here. */
  redactedText: string;
}

export interface AbstractResult {
  /** 1-3 sentence summary. Empty string is treated as failure. */
  abstract: string;
  /** Which provider produced it. */
  provider: AbstractProviderId;
}

export interface ProviderHealth {
  ok: boolean;
  reason?: string;
}

export interface AbstractProvider {
  readonly id: AbstractProviderId;
  /** MUST be `false` for every provider in this chain — cloud is forbidden. */
  readonly isCloud: false;
  abstract(req: AbstractRequest): Promise<AbstractResult>;
  health(): Promise<ProviderHealth>;
}

export class CloudProviderRefusedError extends Error {
  constructor(id: string) {
    super(
      `clio abstract: cloud provider '${id}' refused — Invariant 2 (never a cloud LLM on raw prompt)`,
    );
    this.name = "CloudProviderRefusedError";
  }
}

/**
 * Result of running Stage 2. `pending` indicates no local provider was
 * healthy; `abstract` is empty and the collector tags the PromptRecord with
 * `abstract_pending: true`.
 */
export type AbstractStageResult =
  | { pending: false; abstract: string; provider: AbstractProviderId }
  | { pending: true; reason: string };

/**
 * Run the Stage 2 priority chain. Always returns — never throws on a single
 * provider failure. Throws only if a provider is miscoded as cloud-backed.
 */
export async function runAbstract(
  req: AbstractRequest,
  providers: AbstractProvider[],
): Promise<AbstractStageResult> {
  const reasons: string[] = [];
  for (const p of providers) {
    if ((p as unknown as { isCloud: unknown }).isCloud !== false) {
      throw new CloudProviderRefusedError(p.id);
    }
    const h = await safeHealth(p);
    if (!h.ok) {
      reasons.push(`${p.id}: ${h.reason ?? "unhealthy"}`);
      continue;
    }
    try {
      const out = await p.abstract(req);
      if (out.abstract.trim().length === 0) {
        reasons.push(`${p.id}: empty abstract`);
        continue;
      }
      return { pending: false, abstract: out.abstract, provider: out.provider };
    } catch (err) {
      reasons.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    pending: true,
    reason:
      reasons.length > 0
        ? `no healthy local provider: ${reasons.join("; ")}`
        : "no providers configured",
  };
}

async function safeHealth(p: AbstractProvider): Promise<ProviderHealth> {
  try {
    return await p.health();
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// -----------------------------------------------------------------------------
// Concrete providers
// -----------------------------------------------------------------------------

/**
 * Generic MCP abstract provider. The MCP transport is supplied by the caller
 * (typically `@modelcontextprotocol/sdk` in the collector). This class only
 * encodes the Clio-specific prompt template + response contract.
 *
 * If the underlying MCP host is an Anthropic Claude Code session running on
 * the developer's machine, it's local by construction — the user is already
 * using that model, we're not opening a new network hop to a cloud API.
 */
export class MCPAbstractProvider implements AbstractProvider {
  readonly id: AbstractProviderId;
  readonly isCloud = false as const;
  private readonly call: (prompt: string) => Promise<string>;
  private readonly probe: () => Promise<boolean>;

  constructor(args: {
    id: Extract<AbstractProviderId, "claude-code-mcp" | "codex-mcp">;
    call: (prompt: string) => Promise<string>;
    probe?: () => Promise<boolean>;
  }) {
    this.id = args.id;
    this.call = args.call;
    this.probe = args.probe ?? (async () => true);
  }

  async health(): Promise<ProviderHealth> {
    try {
      const ok = await this.probe();
      return ok ? { ok: true } : { ok: false, reason: "probe returned false" };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async abstract(req: AbstractRequest): Promise<AbstractResult> {
    const prompt = buildAbstractPrompt(req.redactedText);
    const out = await this.call(prompt);
    return { abstract: normalizeAbstract(out), provider: this.id };
  }
}

/** Ollama Qwen 2.5-7B local provider. */
export class OllamaAbstractProvider implements AbstractProvider {
  readonly id = "ollama-qwen" as const;
  readonly isCloud = false as const;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl?: string; model?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
    this.model = opts.model ?? "qwen2.5:7b";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async health(): Promise<ProviderHealth> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, { method: "GET" });
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async abstract(req: AbstractRequest): Promise<AbstractResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: buildAbstractPrompt(req.redactedText),
        stream: false,
        options: { temperature: 0.1 },
      }),
    });
    if (!res.ok) throw new Error(`ollama: HTTP ${res.status}`);
    const body = (await res.json()) as { response?: string };
    return { abstract: normalizeAbstract(body.response ?? ""), provider: this.id };
  }
}

// -----------------------------------------------------------------------------
// Prompt + response hygiene
// -----------------------------------------------------------------------------

const ABSTRACT_PROMPT_TEMPLATE = `You are an on-device privacy filter. Input is a developer prompt with secrets and PII already replaced by <REDACTED:type:hash> markers. Produce a 1-3 sentence abstract describing the TASK, not the specifics. Do not invent identifying details. Do not reproduce any <REDACTED:...> markers. Do not mention specific file paths, URLs, proper nouns, or numbers. Output only the abstract, no preamble.

<user_data>
{{INPUT}}
</user_data>

Abstract:`;

function buildAbstractPrompt(redactedText: string): string {
  return ABSTRACT_PROMPT_TEMPLATE.replace("{{INPUT}}", redactedText);
}

/**
 * Trim the abstract to 1-3 sentences, strip any lingering REDACTED markers
 * (belt-and-braces — the abstract should never reproduce them), and enforce
 * a hard character cap so a misbehaving local LLM can't exfiltrate by volume.
 */
export function normalizeAbstract(raw: string): string {
  let out = raw.trim();
  out = out.replace(/<REDACTED:[^>]+>/g, "");
  out = out.replace(/\s+/g, " ").trim();
  // First 3 sentences.
  const sentences = out.split(/(?<=[.!?])\s+/).slice(0, 3);
  out = sentences.join(" ").trim();
  if (out.length > 500) out = `${out.slice(0, 497)}...`;
  return out;
}
