# 08 — Server-side redaction

**Status:** draft
**Owners:** Workstream G (privacy/redaction)
**Consumers:** C (calls redaction synchronously at ingest time, before storage), B (collector runs the same pipeline as defense-in-depth, but server is authoritative)
**Last touched:** 2026-04-16

## Purpose

`packages/redact` provides one synchronous interface that the ingest server calls on every event before it touches storage. Server-side runs the same TruffleHog + Gitleaks + Presidio pipeline as the on-device collector pipeline (`06-clio-pipeline.md`), but is **authoritative** — rules update without redeploying every dev's binary.

If redaction misses a secret, customers stop trusting the product. If redaction over-eagerly redacts, the dashboard becomes useless. Both failure modes are real; both have CI gates.

## Function shape

```ts
// packages/redact/index.ts (draft)
export interface RedactInput {
  /** Fields scanned in priority order. */
  prompt_text?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  raw_attrs?: Record<string, unknown>;
  /** Tier of the source event — Tier A enforces an allowlist on raw_attrs. */
  tier: "A" | "B" | "C";
}

export interface RedactionMarker {
  type: "secret" | "email" | "phone" | "name" | "ip" | "credit_card" | "ssn" | "url" | "address" | "other";
  hash: string;          // sha256(original_value).slice(0, 16) — for dedup analytics
  detector: "trufflehog" | "gitleaks" | "presidio";
  rule: string;          // e.g. "AWSAccessKey", "SlackToken", "GenericPII"
}

export interface RedactOutput {
  prompt_text?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  raw_attrs?: Record<string, unknown>;
  /** Total markers introduced; written to Event.redaction_count. */
  redaction_count: number;
  /** Per-type breakdown for audit. */
  redaction_breakdown: Record<RedactionMarker["type"], number>;
  /** Detailed markers — written to a side log, NOT the Event. */
  markers: RedactionMarker[];
  /** True if Tier A allowlist filtered out raw_attrs keys. */
  raw_attrs_filtered: boolean;
}

export function redact(input: RedactInput): RedactOutput;
```

## Replacement format

```
<REDACTED:type:hash>
```

- `type` is one of the `RedactionMarker.type` values.
- `hash` is `sha256(original).slice(0, 16)` — lets us see "this same secret appeared 5 times" without storing the secret.
- Format is regex-stable: dashboard renderers can detect markers and render as a chip without re-scanning.

## Pipeline order

1. **TruffleHog** — 800+ secret detector types. Runs first because misses here are highest-blast-radius.
2. **Gitleaks** — broader regex catch (covers cases TruffleHog misses; complementary).
3. **Presidio NER** — PII (names, emails, phones, addresses). Configurable per-org.

Each stage replaces matched substrings with `<REDACTED:…>` markers. Subsequent stages don't re-scan replaced regions.

## Tier A allowlist (CLAUDE.md C10)

For events where `tier='A'`, after the three-stage scan, `raw_attrs` is filtered to an allowlist:

```ts
// packages/redact/tier_a_allowlist.ts (draft)
export const TIER_A_RAW_ATTRS_ALLOWLIST = new Set([
  "schema_version", "source", "source_version",
  "device.id", "service.version",
  "gen_ai.system", "gen_ai.request.model", "gen_ai.response.model",
  "dev_metrics.event_kind", "dev_metrics.tool_name", "dev_metrics.tool_status",
  "dev_metrics.duration_ms", "dev_metrics.first_try_failure",
  // Counts and durations only. NO content fields.
]);
```

Anything not on the list is dropped silently with a counter increment (`raw_attrs_filtered=true`).

## Forbidden-field rejection (NOT part of redact, but adjacent)

The ingest validator (`02-ingest-api.md`) rejects with HTTP 400 BEFORE calling `redact()` if the event is from a Tier A/B source AND contains any of:

```
rawPrompt, prompt, prompt_text, messages,
toolArgs, toolOutputs,
fileContents, diffs, filePaths,
ticketIds, emails, realNames
```

`redact()` is for known-shape Tier-C content. Forbidden-field handling is a different layer.

## Defense in depth — collector also redacts

The on-device Clio pipeline (`06-clio-pipeline.md`) runs the same `redact()` function. **Server is authoritative.** Both must run because:

- **Collector-side** prevents forbidden content from sitting in the local egress journal even briefly.
- **Server-side** catches anything the collector missed and lets us update rules without pushing binaries to thousands of dev machines.

`packages/redact` is a single source — collector and server import the same code.

## Per-org rule overrides

Some orgs need stricter PII rules (healthcare → flag PHI more aggressively) or looser ones (allow URLs in `dev_metrics.tool_input` for internal-only tools).

```ts
export interface OrgRedactionPolicy {
  org_id: string;
  presidio_recognizers_extra?: string[];   // load custom Presidio recognizers
  trufflehog_rules_disabled?: string[];    // narrow false positives
  raw_attrs_allowlist_extra?: string[];    // tier-A allowlist additions
}
```

Loaded from Postgres `policies` table at ingest startup; cached 60s.

## PHI scan (Phase 3)

`bematist scan --phi` is a separate offline tool that scans paste-cache, image-cache, and JSONL for PHI. Not part of the synchronous `redact()` path. Lives in `packages/redact/phi/`.

## Eval gates

```bash
bun run test:privacy     # MERGE BLOCKER
```

- **Recall**: 100-secret seeded corpus → ≥98% caught.
- **Precision**: false-positive rate on a 10k-line "clean" corpus < 0.5%.
- **Forbidden-field fuzzer**: 100% rejection (this is enforced at the validator, but tested here too).
- **Nightly invariant scan**: zero raw secrets or forbidden fields in ClickHouse `events`. Failure = pager.

## Performance

- **Synchronous, called once per event in the ingest hot path.**
- p99 redact() target: <5ms for prompts ≤16KB.
- TruffleHog/Gitleaks/Presidio each have their own perf characteristics; we run them in-process via WASM where available, subprocess otherwise. Subprocess startup is the killer — pool workers.

## Invariants

1. **`redact()` is synchronous and single-threaded per call.** No async. Callers can wrap in a worker pool, but the function itself is pure CPU.
2. **`redact()` is deterministic.** Same input → same output (same markers, same hashes). Required for property-based tests.
3. **Server-side is authoritative.** If the collector and server disagree, server wins — re-redact and overwrite.
4. **No PII or secrets EVER stored in `markers[]` outside the side log.** The side log lives in a separate ClickHouse table with stricter retention (30d max, no Tier promotion).
5. **Tier A `raw_attrs` allowlist enforced at write time, not as hopeful schema design.** The allowlist Set above is the source of truth.
6. **Replacement format `<REDACTED:type:hash>` is stable.** Dashboard renderers depend on it. Any change is breaking.

## Open questions

- Run TruffleHog in-process via WASM, or subprocess? (Owner: G — start subprocess pool, switch to WASM if perf forces it.)
- Per-org allowlist additions — auditor-approval workflow, or self-serve? (Owner: G + I — self-serve for `presidio_recognizers_extra`, auditor-approved for `trufflehog_rules_disabled`.)
- Should we expose a per-event `redact_hint` from adapters (e.g., "this string came from a `git diff`, scan extra carefully")? (Owner: G + B — not v1; revisit if false-negative rate is high.)

## Changelog

- 2026-04-16 — initial draft
- 2026-04-16 — Sprint-1 Phase 2: reorder `prompt`/`prompt_text` so the list mirrors
  `packages/schema/src/invariants.ts FORBIDDEN_FIELDS` 1:1 (the TypeScript constant
  is now the single source of truth); no member added/removed. Contract-parity test
  in `packages/schema/src/invariants.test.ts` enforces the ordering. See D-S1-25,
  D-S1-30.
