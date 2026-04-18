// Clio on-device pipeline types (contract 06).
//
// The `PromptRecord` is the ONLY shape permitted to cross the wire for prompt
// content at Tier B+. The forbidden-field list below is enforced both
// client-side (refuse to emit) and server-side (HTTP 400 reject).

export type Tier = "A" | "B" | "C";

export interface RedactionReport {
  /** Per-type counters (secret, email, name, ip, ...). */
  counts: Record<string, number>;
  /** Semver. Bumped on any rule/template/prompt change (contract 06 §Pipeline versioning). */
  pipeline_version: string;
}

/**
 * The load-bearing shape that carries prompt content out of the collector.
 *
 * - `abstract` is always derived from a redacted copy of the input — never
 *   the raw prompt (contract 06 Invariant 2).
 * - `embedding` is produced from `abstract` only (Invariant 4).
 * - `abstract_pending: true` means Stage 2 fell to "skip" (no local LLM
 *   available); `abstract` is empty and the server may retry on permitted
 *   models.
 * - Verifier drops NEVER produce a `PromptRecord` — the type intentionally
 *   has no room for a "dropped" variant.
 */
export interface PromptRecord {
  session_id_hash: string;
  prompt_index: number;
  abstract: string;
  embedding?: number[];
  redaction_report: RedactionReport;
  abstract_pending?: boolean;
}

/**
 * Forbidden fields — MUST NOT appear alongside a `PromptRecord`, anywhere in
 * an event payload. Contract 06 §Forbidden fields. Server rejects (HTTP 400)
 * on any of these for Tier A/B sources.
 *
 * Enforced by `assertNoForbiddenFields` (see forbidden.ts). Exported as a
 * readonly array so the ingest adversarial fuzzer can iterate it.
 */
export const FORBIDDEN_FIELDS = Object.freeze([
  "rawPrompt",
  "prompt_text",
  "prompt",
  "messages",
  "toolArgs",
  "toolOutputs",
  "fileContents",
  "diffs",
  "filePaths",
  "ticketIds",
  "emails",
  "realNames",
] as const);

export type ForbiddenField = (typeof FORBIDDEN_FIELDS)[number];

/**
 * Current Clio pipeline version. Bumped on:
 *   - any redaction rule change
 *   - any abstract-prompt template change
 *   - any verifier-prompt template change
 */
export const CLIO_PIPELINE_VERSION = "1.0.0";
