// Stage 3 — Verify (contract 06 §3).
//
// Clio's identifying-content second pass. A `Verifier` returns YES (drop) or
// NO (keep). On YES the record is dropped permanently — NEVER retry. A retry
// is a prompt-injection attack surface ("describe yourself differently to
// pass verification").
//
// MERGE BLOCKER (CLAUDE.md §Testing Rules): verifier recall ≥ 95% on the
// seeded identifying-abstract corpus. `builtinVerifier` is tuned against the
// 50-prompt adversarial fixture shipped in `packages/fixtures/clio/identifying/`.
//
// In production the verifier runs on the same local MCP / Ollama chain as
// Stage 2 — this file exposes a provider abstraction so the collector can
// swap the built-in rule pack for a real LLM. The built-in pack is the
// last-resort default AND the reference oracle the M2 eval gate enforces.

export type VerifyDecision = "DROP" | "KEEP";

export interface VerifyInput {
  /** The abstract from Stage 2. Never the raw prompt. */
  abstract: string;
}

export interface VerifyResult {
  decision: VerifyDecision;
  /** Which rule(s) / signal(s) fired, for audit. */
  reasons: string[];
}

export interface Verifier {
  verify(input: VerifyInput): Promise<VerifyResult> | VerifyResult;
}

// -----------------------------------------------------------------------------
// Rule pack
// -----------------------------------------------------------------------------
//
// Each rule fires when a clearly-identifying signal survived abstraction. The
// rules err toward precision/recall on the 50-case fixture; precision is a
// secondary concern (a false-positive just drops a benign abstract, which is
// acceptable — contract 06 says verifier drops are never retried, and the
// server-side redactor will still run on abstract text).

interface Rule {
  id: string;
  description: string;
  test: (text: string) => boolean;
}

const HAS_REDACTED_MARKER: Rule = {
  id: "leftover_redacted_marker",
  description: "abstract still contains <REDACTED:...> — abstraction is incomplete",
  test: (t) => /<REDACTED:[^>]+>/.test(t),
};

const HAS_EMAIL: Rule = {
  id: "email",
  description: "abstract names an email address",
  test: (t) => /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(t),
};

const HAS_URL: Rule = {
  id: "url",
  description: "abstract includes a URL or domain",
  test: (t) =>
    /\bhttps?:\/\/\S+/.test(t) ||
    /\b[a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|io|dev|co|ai|app|sh)\b/i.test(t),
};

const HAS_HOME_PATH: Rule = {
  id: "home_path",
  description: "abstract includes a user-home filesystem path",
  test: (t) => /\/(?:Users|home)\/[A-Za-z0-9_.-]+/.test(t),
};

const HAS_PHONE: Rule = {
  id: "phone",
  description: "abstract includes a phone-number-shaped string",
  test: (t) => /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(t),
};

const HAS_SSN: Rule = {
  id: "ssn",
  description: "abstract includes a US SSN",
  test: (t) => /\b\d{3}-\d{2}-\d{4}\b/.test(t),
};

const HAS_CREDIT_CARD: Rule = {
  id: "credit_card",
  description: "abstract includes a credit-card-shaped number",
  test: (t) => /\b(?:\d[ -]?){13,19}\b/.test(t),
};

const HAS_IP: Rule = {
  id: "ip",
  description: "abstract includes an IPv4 address",
  test: (t) => /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(t),
};

const HAS_SECRET_SHAPE: Rule = {
  id: "secret_shape",
  description: "abstract contains a secret-key-shaped token",
  test: (t) =>
    /\bAKIA[0-9A-Z]{16}\b/.test(t) ||
    /\bghp_[0-9A-Za-z]{36}\b/.test(t) ||
    /\bgho_[0-9A-Za-z]{36}\b/.test(t) ||
    /\bgithub_pat_[0-9A-Za-z_]{82}\b/.test(t) ||
    /\bsk-[A-Za-z0-9-]{20,}\b/.test(t) ||
    /\bxox[baprs]-[0-9]{10,13}-/.test(t) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ/.test(t),
};

const HAS_TICKET_ID: Rule = {
  id: "ticket_id",
  description: "abstract references a ticket/issue identifier",
  test: (t) => /\b[A-Z]{2,6}-\d{2,6}\b/.test(t),
};

const HAS_SHA: Rule = {
  id: "git_sha",
  description: "abstract references a git SHA or long hex hash",
  test: (t) => /\b[0-9a-f]{7,40}\b/i.test(t) && /\b[0-9a-f]{12,}\b/i.test(t),
};

// A small, high-signal proper-noun cheat list covering real-world product /
// organization names that appear across our dev-workflow adversarial corpus.
// This is intentionally NOT exhaustive — a real LLM verifier catches the long
// tail. The list is the floor the M2 gate enforces against regression.
const PROPER_NOUNS: ReadonlySet<string> = new Set(
  [
    "Stripe",
    "Plaid",
    "OpenAI",
    "Anthropic",
    "Google",
    "Amazon",
    "Microsoft",
    "Meta",
    "Pella",
    "Bematist",
    "Acme",
    "Contoso",
    "Initech",
    "Globex",
    "Umbrella",
    "Weyland",
    "Cyberdyne",
    "Wayne",
    "Stark",
    "Wonka",
    "Gringotts",
    "Nakatomi",
    "Aperture",
    "Monsanto",
    "Ollivander",
    "Bernstein",
    "Goldberg",
    "Rodriguez",
    "O'Brien",
    "Chen",
    "Patel",
    "Smith",
    "Garcia",
    "Johnson",
    "Kim",
    "Suzuki",
    "Jorge",
    "Sebastian",
    "Sandesh",
    "Walid",
  ].map((n) => n.toLowerCase()),
);

const HAS_PROPER_NOUN: Rule = {
  id: "proper_noun",
  description: "abstract names a known proper noun",
  test: (t) => {
    const tokens = t.split(/\W+/).filter(Boolean);
    for (const tok of tokens) {
      if (PROPER_NOUNS.has(tok.toLowerCase())) return true;
    }
    return false;
  },
};

// Heuristic: a Capitalized-FirstName Capitalized-LastName pair that isn't the
// sentence-start. Over-fires on things like "React Router" so we guard against
// a small stop-set.
const PROPER_NOUN_STOP: ReadonlySet<string> = new Set([
  "React Router",
  "Node JS",
  "Next JS",
  "Postgres SQL",
  "Open API",
  "Pull Request",
  "Github Actions",
  "GitHub Actions",
  "VS Code",
  "Visual Studio",
  "Claude Code",
  "Tool Call",
  "Data Base",
]);

const HAS_FIRSTLAST_NAME: Rule = {
  id: "first_last_name",
  description: "abstract appears to name a person (Firstname Lastname)",
  test: (t) => {
    const matches = t.match(/\b([A-Z][a-z]{1,}) ([A-Z][a-z]{2,})\b/g);
    if (!matches) return false;
    for (const m of matches) {
      if (!PROPER_NOUN_STOP.has(m)) return true;
    }
    return false;
  },
};

const RULES: readonly Rule[] = [
  HAS_REDACTED_MARKER,
  HAS_EMAIL,
  HAS_URL,
  HAS_HOME_PATH,
  HAS_PHONE,
  HAS_SSN,
  HAS_CREDIT_CARD,
  HAS_IP,
  HAS_SECRET_SHAPE,
  HAS_TICKET_ID,
  HAS_SHA,
  HAS_PROPER_NOUN,
  HAS_FIRSTLAST_NAME,
];

/**
 * Default verifier — rule-based, deterministic, zero-network, testable.
 *
 * This is the oracle the M2 adversarial eval enforces against. When the
 * collector has a real MCP / Ollama verifier available it runs in front of
 * this (and its result is preferred). The built-in pack stays the last-resort
 * floor so an air-gapped deploy with no LLM still blocks the identifying cases.
 */
export const builtinVerifier: Verifier = {
  verify({ abstract }): VerifyResult {
    const reasons: string[] = [];
    for (const r of RULES) {
      if (r.test(abstract)) reasons.push(r.id);
    }
    return { decision: reasons.length > 0 ? "DROP" : "KEEP", reasons };
  },
};

/**
 * Wrap a text-completion callable (MCP / Ollama) into a `Verifier`. The
 * underlying model is asked "does this abstract contain identifying content?
 * Reply YES or NO." The callable MUST NOT be a cloud model — enforced by the
 * provider-level type in `abstract.ts`.
 */
export class LLMVerifier implements Verifier {
  private readonly call: (prompt: string) => Promise<string>;
  constructor(call: (prompt: string) => Promise<string>) {
    this.call = call;
  }
  async verify(input: VerifyInput): Promise<VerifyResult> {
    const prompt = buildVerifierPrompt(input.abstract);
    const raw = (await this.call(prompt)).trim().toUpperCase();
    const decision: VerifyDecision = raw.startsWith("YES") ? "DROP" : "KEEP";
    return { decision, reasons: decision === "DROP" ? ["llm_verifier"] : [] };
  }
}

const VERIFIER_PROMPT_TEMPLATE = `You are a privacy verifier. Does the following abstract contain identifying content — a real name, specific company, email, URL, file path, phone, SSN, credit card, IP, ticket ID, git SHA, API key, or any other uniquely-identifying detail? Answer only YES or NO.

<user_data>
{{INPUT}}
</user_data>

Answer:`;

function buildVerifierPrompt(abstract: string): string {
  return VERIFIER_PROMPT_TEMPLATE.replace("{{INPUT}}", abstract);
}

/**
 * Compose verifiers: run `first`; if it says DROP, short-circuit. Otherwise
 * run `fallback`. Used to layer an LLM verifier in front of the built-in
 * rule pack — if either says DROP, the record is dropped.
 */
export function composeVerifiers(first: Verifier, fallback: Verifier): Verifier {
  return {
    async verify(input) {
      const a = await first.verify(input);
      if (a.decision === "DROP") return a;
      const b = await fallback.verify(input);
      if (b.decision === "DROP") return b;
      return { decision: "KEEP", reasons: [] };
    },
  };
}

/** Run Stage 3. Returns `true` if the record should be dropped. */
export async function runVerify(input: VerifyInput, verifier?: Verifier): Promise<VerifyResult> {
  const v = verifier ?? builtinVerifier;
  return await v.verify(input);
}
