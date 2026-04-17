// RedactStage interface (Sprint-1 Phase-2 I3).
//
// `RedactStage` is the contract between the ingest server and the redaction
// pipeline (packages/redact). Sprint 1 ships `noopRedactStage` so ingest has a
// stable seam for Sprint 2 when the real TruffleHog + Gitleaks + Presidio
// pipeline (contract 08) lands. Both the server and the collector import the
// same impl — server is authoritative.

export type Tier = "A" | "B" | "C";

export interface RedactInput {
  prompt_text?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  raw_attrs?: Record<string, unknown>;
  /** Tier of the source event — Tier A enforces an allowlist on raw_attrs. */
  tier: Tier;
}

export interface RedactionMarker {
  type:
    | "secret"
    | "email"
    | "phone"
    | "name"
    | "ip"
    | "credit_card"
    | "ssn"
    | "url"
    | "address"
    | "other";
  /** sha256(original_value).slice(0, 16) — dedup analytics only. */
  hash: string;
  detector: "trufflehog" | "gitleaks" | "presidio";
  /** e.g. "AWSAccessKey", "SlackToken", "GenericPII". */
  rule: string;
}

export interface RedactOutput {
  prompt_text?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  raw_attrs?: Record<string, unknown>;
  /** Total markers introduced; written to Event.redaction_count (raw counter). */
  redaction_count: number;
  /** Per-type breakdown for audit. */
  redaction_breakdown: Partial<Record<RedactionMarker["type"], number>>;
  /** Detailed markers — written to a side log, NOT the event row. */
  markers: RedactionMarker[];
  /** True if the Tier-A allowlist filtered raw_attrs keys. */
  raw_attrs_filtered: boolean;
}

export interface RedactStage {
  run(input: RedactInput): Promise<RedactOutput> | RedactOutput;
}

/**
 * Identity stage — passes input through unchanged with zeroed counters.
 *
 * Shipped as the default `deps.redactStage` in Sprint 1; Sprint 2 swaps it for
 * the real pipeline. Behavior is a merge-blocker invariant: ANY change here
 * must bump the Phase-2 test list.
 */
export const noopRedactStage: RedactStage = {
  run(input: RedactInput): RedactOutput {
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
