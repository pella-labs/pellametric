# 06 — Clio on-device prompt pipeline

**Status:** draft
**Owners:** Workstream G (privacy/redaction), Workstream B (collector)
**Consumers:** C (ingest receives the output), H (uses embeddings for clustering)
**Last touched:** 2026-04-16

## Purpose

The **only** way prompt text contributes to team-level views. Runs **entirely on the developer's machine, inside the agent binary, before any network call.** Adapted from Anthropic Clio + OpenClio.

If this pipeline emits something it shouldn't, every privacy guarantee in the product is broken. This contract is load-bearing.

## Five stages, in order

### 1. Redact

- Input: raw prompt text from the IDE adapter.
- Tools: TruffleHog (800+ secret detector types) → Gitleaks → Presidio NER (PII).
- Output: text with secrets/PII replaced by `<REDACTED:type:hash>` markers.
- Counters incremented per type (`secret`, `email`, `name`, `ip`, etc.).

### 2. Abstract (Tier B+ only; skipped for Tier A which never sees prompts)

Abstraction LLM priorities (try in order, never skip to a later one if an earlier is available and healthy):

1. **User's own running Claude Code / Codex via local MCP** — already on the dev's machine, already trusted, already paid for.
2. **Local Ollama with Qwen 2.5-7B** (bundled config) — runs on the dev's machine; no network egress.
3. **Skip** — flag `abstract_pending: true`. Will retry next pipeline pass.

**NEVER a cloud LLM on raw prompt.** Not OpenAI, not Anthropic API, not Voyage. Ever. The abstract step is the firewall; if it fails, prompt text doesn't leave.

Output: 1–3 sentence abstract describing what the prompt was about, no identifying content.

### 3. Verify

- Clio's "identifying-content" second pass.
- Verifier LLM (same priority chain as Abstract) returns `YES` (drop) or `NO` (keep).
- **On YES → drop. Never retry the abstract.** A retry would leak via the prompt-injection attack of "describe yourself differently to pass verification".

### 4. Embed

- Provider abstraction in `05-embed-provider.md`.
- For the on-device pipeline, **default is `xenova` (MiniLM-L6, 384d, all-local).** Cloud embedding providers run only at the central ingest layer, on already-abstracted text.
- Cache key: `sha256(abstract)`.

### 5. Emit

Produces a `PromptRecord` (shape below) and attaches it to the matching `Event` before egress journal write.

## `PromptRecord` shape

```ts
// packages/clio/types.ts (draft)
export interface PromptRecord {
  /** Hashed session id; raw session_id never crosses the wire for prompt records. */
  session_id_hash: string;
  /** Position within session; lets us reconstruct conversation shape without text. */
  prompt_index: number;
  /** 1–3 sentence abstract from Stage 2. EMPTY when abstract_pending=true. */
  abstract: string;
  /** Embedding from Stage 4. EMPTY when abstract_pending=true. */
  embedding?: number[];
  /** Per-type counters from Stage 1. */
  redaction_report: {
    counts: Record<string, number>;     // { secret: 2, email: 1, name: 0, ... }
    pipeline_version: string;           // semver of THIS pipeline; bump on rule change
  };
  /** True if Stage 2 fell to "skip"; ingest can retry server-side on permitted models. */
  abstract_pending?: boolean;
  /** True if Stage 3 said YES (identifying); record dropped before reaching here.
   *  This field exists ONLY for telemetry counters (how often we drop). */
  verifier_dropped?: never;             // type-level reminder: dropped records don't emit
}
```

## Forbidden fields (MUST NOT appear anywhere a `PromptRecord` is shipped)

The collector MUST NOT emit any of the following on `Event` or attached to `PromptRecord`:

```
rawPrompt, prompt_text, prompt, messages,
toolArgs, toolOutputs,
fileContents, diffs, filePaths,
ticketIds, emails, realNames
```

The ingest server REJECTS (HTTP 400) any payload containing these from a Tier A/B source. The CI adversarial fuzzer (`bun run test:privacy`) MUST hit 100% rejection. **Merge blocker.**

## Optional user review (Tier B+ if `policy.review_before_publish=true`)

Before egress journal write, the collector MAY surface a desktop notification with the exact `PromptRecord` payload that's about to be shipped. User can:
- **Allow** — record proceeds.
- **Drop** — record discarded; counters incremented; no retry.
- **Drop & blanket-disable for this session** — disables Clio output for `session_id` for 24h.

Defaults to off (latency hit) but documented as available in `bematist policy show`.

## Pipeline versioning

`pipeline_version` is semver. Bumped on:
- Any change to redaction rules (TruffleHog rule update, Presidio config change).
- Any change to abstract prompt template.
- Any change to verifier prompt template.

Server stores `pipeline_version` per-event so we can audit what version produced any given abstract.

## Adapter integration

The on-device pipeline is **owned by the collector** and called by every adapter that captures prompt text. Adapter SDK (`03-adapter-sdk.md`) provides the helper:

```ts
// packages/clio/index.ts (draft)
import type { Event } from "@bematist/schema";

/** Run the 5-stage pipeline. Mutates `event` to attach prompt_record OR sets event.tier='A'.
 *  Returns null if Stage 3 dropped the record. */
export async function attachPromptRecord(
  event: Event,
  rawPromptText: string,
  ctx: AdapterContext,
): Promise<Event | null>;
```

Adapters never call individual stages — they call this helper or skip prompt capture entirely (Tier A path).

## Server-side defense in depth

Even though this pipeline runs on-device, the **server is authoritative**:
- Server runs the SAME redaction (Workstream G) on `prompt_text`, `tool_input`, `tool_output`, AND `raw_attrs` (`08-redaction.md`).
- Server runs a Clio verifier pass on `abstract` (server-side check) — if it says identifying, the record is dropped at write time.
- A nightly invariant scan proves zero raw secrets or forbidden fields exist in ClickHouse rows. Failure = pager.

## Eval gates

```bash
bun run test:privacy     # MERGE BLOCKER
```

- Seeded-secret corpus (≥100 secrets, mixed types): TruffleHog+Gitleaks+Presidio recall ≥ 98%.
- Forbidden-field fuzzer: 100% rejection.
- Clio verifier: ≥ 95% recall on seeded identifying abstracts.
- Nightly invariant scan: zero raw secrets or forbidden fields in ClickHouse.

## Invariants

1. **Stages run in order. No stage skips except Abstract (Tier A only) and Verify (never).**
2. **Stage 2 NEVER calls a cloud LLM on raw prompt.** Local-only providers.
3. **Stage 3 verifier failures DROP the record permanently.** Never retry.
4. **`PromptRecord` carries hashed session id only.** Raw `session_id` never crosses wire alongside `abstract`.
5. **Forbidden field list (above) is enforced both client-side (refuse to emit) AND server-side (HTTP 400 reject).**
6. **`pipeline_version` is semver and bumped on any rule change.**

## Open questions

- What's the MCP API surface for "user's own Claude Code" — is there a stable contract, or do we pin to a version of Claude Code's MCP? (Owner: G — pin and update; design for swap.)
- Bundled Qwen 2.5-7B is ~5GB — first-run download time is meaningful. Default to download-on-demand or download-at-install? (Owner: B — install time, with `--skip-models` opt-out.)
- `prompt_index` semantics for tool_call/tool_result events that don't map to a "prompt" — counter, or absent? (Owner: G + B — counter, monotonic per session.)

## Changelog

- 2026-04-16 — initial draft.
- 2026-04-16 — Sprint-0 M0: workspace packages use `@bematist/*` namespace.
- 2026-04-16 — M1 follow-up: confirmed `@bematist/*` package references across code snippets in this contract (additive; no behavioral change).
- 2026-04-16 — Naming retrofit: product and CLI are `Bematist` / `bematist` everywhere (single name across all surfaces; supersedes PRD §D32 "DevMetrics stays the product name").
