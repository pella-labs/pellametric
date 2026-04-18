// Clio 4-stage on-device pipeline orchestrator (contract 06 §Adapter integration).
//
// Stages, in order:
//   1. Redact   — TruffleHog + Gitleaks + Presidio (`@bematist/redact`)
//   2. Abstract — local MCP → Ollama → skip (NEVER cloud)
//   3. Verify   — drop on YES, never retry
//   4. Embed    — local Xenova MiniLM-L6, cache by sha256(abstract)
//
// Output: PromptRecord. Forbidden fields are checked at the end as
// belt-and-braces — the adapter shouldn't be holding raw text by then.

import { createHash } from "node:crypto";
import type { RedactStage } from "@bematist/redact";
import { type AbstractProvider, runAbstract } from "./abstract";
import { type Embedder, XenovaEmbedder } from "./embed";
import { assertNoForbiddenFields, ForbiddenFieldError } from "./forbidden";
import { runRedact } from "./redact";
import { CLIO_PIPELINE_VERSION, type PromptRecord, type Tier } from "./types";
import { runVerify, type Verifier } from "./verify";

export interface PipelineDeps {
  /** Stage 1 redactor — defaults to the package built-in. */
  redactStage?: RedactStage;
  /** Stage 2 priority chain. Empty array → always `abstract_pending=true`. */
  abstractProviders?: AbstractProvider[];
  /** Stage 3 verifier — defaults to the package built-in rule pack. */
  verifier?: Verifier;
  /** Stage 4 embedder — defaults to XenovaEmbedder. Tests inject HashingEmbedder. */
  embedder?: Embedder;
}

export interface PipelineInput {
  /** Raw session id; hashed before emit. */
  session_id: string;
  /** Position in session for ordering. */
  prompt_index: number;
  /** Raw prompt text. NEVER survives past Stage 1. */
  rawPromptText: string;
  /** Source tier. Tier A skips this entire pipeline at the adapter. */
  tier: Tier;
}

export type PipelineOutput =
  | { kind: "emitted"; record: PromptRecord }
  | { kind: "dropped_by_verifier"; reasons: string[] }
  | { kind: "skipped_tier_a" };

/**
 * Run the 4-stage pipeline. The adapter calls this once per prompt-bearing
 * event. Tier A inputs are refused — adapters MUST NOT pass prompt text for
 * Tier A sources at all (`kind: "skipped_tier_a"` is returned to surface the
 * misuse loudly in tests).
 */
export async function runPipeline(
  input: PipelineInput,
  deps: PipelineDeps = {},
): Promise<PipelineOutput> {
  if (input.tier === "A") {
    return { kind: "skipped_tier_a" };
  }

  // ─── Stage 1: Redact ───
  const redacted = await runRedact({
    rawPromptText: input.rawPromptText,
    ...(deps.redactStage !== undefined ? { stage: deps.redactStage } : {}),
    tier: input.tier,
  });

  // ─── Stage 2: Abstract ───
  const abstractRes = await runAbstract(
    { redactedText: redacted.text },
    deps.abstractProviders ?? [],
  );

  if (abstractRes.pending) {
    // Skip path: emit a pending record so the server can retry on permitted models.
    const record: PromptRecord = {
      session_id_hash: hashSessionId(input.session_id),
      prompt_index: input.prompt_index,
      abstract: "",
      redaction_report: redacted.report,
      abstract_pending: true,
    };
    finalCheck(record);
    return { kind: "emitted", record };
  }

  // ─── Stage 3: Verify ───
  const verdict = await runVerify({ abstract: abstractRes.abstract }, deps.verifier);
  if (verdict.decision === "DROP") {
    return { kind: "dropped_by_verifier", reasons: verdict.reasons };
  }

  // ─── Stage 4: Embed ───
  const embedder = deps.embedder ?? new XenovaEmbedder();
  const embedded = await embedder.embed({ abstract: abstractRes.abstract });

  const record: PromptRecord = {
    session_id_hash: hashSessionId(input.session_id),
    prompt_index: input.prompt_index,
    abstract: abstractRes.abstract,
    embedding: embedded.vector,
    redaction_report: redacted.report,
  };
  finalCheck(record);
  return { kind: "emitted", record };
}

/**
 * Belt-and-braces: assert the emitted record carries none of the forbidden
 * fields. A bug in a custom verifier or embedder shouldn't be able to attach
 * `prompt_text` to the output. Throws `ForbiddenFieldError` if violated —
 * a hard signal in tests.
 */
function finalCheck(record: PromptRecord): void {
  assertNoForbiddenFields(record);
  if (
    !record.redaction_report ||
    record.redaction_report.pipeline_version !== CLIO_PIPELINE_VERSION
  ) {
    throw new Error("clio pipeline: pipeline_version mismatch");
  }
}

export { ForbiddenFieldError };

function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex").slice(0, 32);
}

/**
 * Adapter-friendly helper documented in contract 06: attach a `PromptRecord`
 * to an event-shaped object, in place, only if the verifier kept it.
 *
 * The event type is intentionally `unknown` here — `@bematist/clio` does NOT
 * import `@bematist/schema` to avoid a workspace cycle. The adapter passes a
 * concrete Event in.
 *
 * Returns:
 *   - the event with `prompt_record` attached (kind = emitted)
 *   - the event with `prompt_record` set to a pending stub (kind = pending; same record shape with abstract_pending=true)
 *   - `null` if the verifier dropped (caller should NOT emit the event)
 */
export async function attachPromptRecord<E extends Record<string, unknown>>(
  event: E,
  rawPromptText: string,
  args: {
    session_id: string;
    prompt_index: number;
    tier: Tier;
    deps?: PipelineDeps;
  },
): Promise<(E & { prompt_record: PromptRecord }) | null> {
  // Defensive: the adapter must not be passing forbidden field names on the event.
  assertNoForbiddenFields(event);

  if (args.tier === "A") return null;

  const result = await runPipeline(
    {
      session_id: args.session_id,
      prompt_index: args.prompt_index,
      rawPromptText,
      tier: args.tier,
    },
    args.deps ?? {},
  );

  if (result.kind === "dropped_by_verifier") return null;
  if (result.kind === "skipped_tier_a") return null;
  return { ...event, prompt_record: result.record } as E & { prompt_record: PromptRecord };
}
