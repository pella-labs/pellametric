# 01 — Event wire (Collector → Ingest)

**Status:** draft
**Owners:** Workstream B (collector), Workstream C (ingest)
**Consumers:** D (storage), G (redaction reads it before persisting), H (scoring reads stored events)
**Last touched:** 2026-04-16

## Purpose

The single payload shape that crosses the network from a per-machine collector to the central ingest server. This is **the** load-bearing seam — get it wrong and every downstream workstream rebuilds.

Two transports carry the same logical event:

1. **OTLP HTTP/Protobuf** at `POST /v1/{traces,metrics,logs}` — preferred for any source that already speaks OTel (Claude Code with `CLAUDE_CODE_ENABLE_TELEMETRY=1`, Copilot CLI, future).
2. **Custom JSON** at `POST /v1/events` — for adapters that read SQLite/JSONL (Cursor, Codex, OpenCode, Continue.dev, Cline/Roo/Kilo) and don't have native OTel.

Both transports normalize to the same internal `Event` row landing in ClickHouse `events`.

## Schema (canonical internal `Event`)

```ts
// packages/schema/event.ts (draft)
import { z } from "zod";

export const EventSchema = z.object({
  // Identity & dedup
  client_event_id: z.string().uuid(),     // collector-generated, idempotency key
  schema_version: z.number().int().min(1).max(255), // UInt8 — wire format version
  ts: z.string().datetime(),              // ISO 8601 UTC; ingest validates ≤ now+5m

  // Tenant / actor — server overrides these from JWT (do NOT trust collector)
  tenant_id: z.string(),                  // server-derived
  engineer_id: z.string(),                // = stable_hash(SSO_subject); server-derived
  device_id: z.string(),                  // collector-claimed; server validates against device registry

  // Source
  source: z.enum([
    "claude-code", "codex", "cursor", "opencode", "continue",
    "vscode-generic", "goose", "copilot-ide", "copilot-cli",
    "cline", "roo", "kilo", "antigravity",
  ]),
  source_version: z.string().optional(),
  fidelity: z.enum(["full", "estimated", "aggregate-only", "post-migration"]),
  cost_estimated: z.boolean().default(false),

  // Tier (privacy posture for THIS event)
  tier: z.enum(["A", "B", "C"]),

  // Session / sequencing
  session_id: z.string(),                 // adapter-specific, hashed if Tier A
  event_seq: z.number().int().nonnegative(), // monotonic per session
  parent_session_id: z.string().optional(),

  // OTel GenAI semantic conventions (gen_ai.*)
  gen_ai: z.object({
    system: z.string().optional(),         // e.g. "anthropic", "openai"
    request: z.object({
      model: z.string().optional(),
      max_tokens: z.number().int().optional(),
    }).optional(),
    response: z.object({
      model: z.string().optional(),
      finish_reasons: z.array(z.string()).optional(),
    }).optional(),
    usage: z.object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cache_read_input_tokens: z.number().int().nonnegative().optional(),
      cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    }).optional(),
  }).optional(),

  // Bematist extensions (dev_metrics.*) — coding-agent specifics, analog to gen_ai.*
  dev_metrics: z.object({
    event_kind: z.enum([
      "session_start", "session_end",
      "llm_request", "llm_response",
      "tool_call", "tool_result",
      "code_edit_proposed", "code_edit_decision",  // accept/reject/modify
      "exec_command_start", "exec_command_end",
      "patch_apply_start", "patch_apply_end",
    ]),
    cost_usd: z.number().nonnegative().optional(),
    pricing_version: z.string().optional(),       // LiteLLM JSON commit SHA at capture
    duration_ms: z.number().int().nonnegative().optional(),

    // Tool call specifics
    tool_name: z.string().optional(),
    tool_status: z.enum(["ok", "error", "denied"]).optional(),

    // Code edit specifics (for accepted-hunk attribution — D29 / §8.5)
    hunk_sha256: z.string().optional(),
    file_path_hash: z.string().optional(),         // hashed; raw path forbidden in Tier A/B
    edit_decision: z.enum(["accept", "reject", "modify"]).optional(),
    revert_within_24h: z.boolean().optional(),

    // First-try-rate inputs (cross-agent normalized; Phase 0 P0 fix)
    first_try_failure: z.boolean().optional(),
  }),

  // Tier-C-only fields — server REJECTS (HTTP 400) if present from Tier A/B sources
  prompt_text: z.string().optional(),     // Tier C only; redacted server-side
  tool_input: z.unknown().optional(),     // Tier C only; redacted
  tool_output: z.unknown().optional(),    // Tier C only; redacted

  // Clio-pipeline output for Tier B+ — abstract only, never raw
  prompt_record: z.object({
    session_id_hash: z.string(),
    prompt_index: z.number().int().nonnegative(),
    abstract: z.string(),
    embedding: z.array(z.number()).optional(),
    redaction_report: z.object({
      counts: z.record(z.string(), z.number()),
      pipeline_version: z.string(),
    }),
  }).optional(),

  // Server-side redaction marker (added at ingest, never sent by collector)
  redaction_count: z.number().int().nonnegative().optional(),

  // Catch-all for unknown attributes (D16) — promoted to typed col after 2 stable releases
  raw_attrs: z.record(z.string(), z.unknown()).optional(),
});

export type Event = z.infer<typeof EventSchema>;
```

## OTel mapping

Collectors using OTLP set:
- `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*` — per OTel GenAI semantic conventions.
- `dev_metrics.event_kind`, `dev_metrics.cost_usd`, `dev_metrics.tool_name`, etc. — coding-agent extensions namespaced under `dev_metrics.*` (OTel custom namespace; the prefix is semantic, analog to `gen_ai.*`, not a product brand).
- Resource attributes: `service.name = "bematist-collector"`, `service.version = <binary version>`, `device.id`. **Tenant and engineer identity are NOT trusted from resource attrs** — derived server-side from the JWT.

The ingest's OTLP receiver maps these into the `Event` shape above before redaction and storage.

## Custom JSON shape

`POST /v1/events` accepts:

```json
{
  "events": [ /* Event objects, max 1000 per request */ ]
}
```

Same `Event` schema. Validated with the same zod parser the OTLP receiver uses post-mapping.

## Invariants

1. **`client_event_id` is a UUID and globally unique per event.** Collectors generate, never reuse. Server dedups via Redis `SETNX` keyed on `(tenant_id, session_id, event_seq)` with 7-day TTL.
2. **`schema_version` is mandatory.** Bumped on any breaking change to this contract. Ingest accepts only versions it knows; older collectors keep working until end-of-support.
3. **Server-derived identity wins.** `tenant_id`, `engineer_id` from JWT override anything the collector sent. `device_id` is collector-claimed but cross-checked against the device registry.
4. **Forbidden fields from Tier A/B sources** — server rejects with HTTP 400 if any of these appear when `tier ∈ {A, B}`: `rawPrompt`, `prompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`. The adversarial fuzzer in CI enforces 100%. Single source of truth: `packages/schema/src/invariants.ts FORBIDDEN_FIELDS` (12 entries).
5. **Tier-A `raw_attrs` is allowlist-enforced** at ingest write time (CLAUDE.md C10). Anything not on the allowlist is dropped silently with a counter increment.
6. **`pricing_version` accompanies any `cost_usd`.** Pricing-version shifts surface as a dashboard banner; never silently recomputed (D21).
7. **Unknown attributes go to `raw_attrs`.** Promotion to a typed column requires 2 consecutive releases of observed stability and a Git-ops PR (D16). Never promote in a hotfix.
8. **Collector clock skew tolerance:** ingest accepts `ts` in `[now − 7d, now + 5m]`. Outside that window → HTTP 400. The 7d back-window covers offline replay from the egress journal.

## Open questions

- Do we ship a Protobuf schema for the custom JSON path too, or stay JSON-only? (Owner: C — recommend JSON-only until p99 ingest is under threat.)
- `pricing_version` — string SHA or semver? (Owner: D + H — leaning SHA from the LiteLLM JSON commit.)
- Should `device_id` registration be implicit (first-seen) or explicit (admin pre-registers)? (Owner: C — implicit for solo/embedded, explicit for self-host/managed.)

## Changelog

- 2026-04-16 — initial draft
- 2026-04-16 — Sprint-1 Phase 2: §Invariant #4 forbidden-field list aligned with contracts/08 — added `prompt` as the 12th entry. Source of truth for the list is now packages/schema/src/invariants.ts FORBIDDEN_FIELDS. See D-S1-25, D-S1-30.
- 2026-04-16 — Sprint-1 Phase 5: OTLP HTTP receiver on :4318 lands natively inside ingest (NOT docker-compose sidecar by default — D-S1-14). Decoder is a minimal hand-rolled proto3 + proto3-JSON parser scoped to ExportTraceServiceRequest shapes; @bufbuild/protobuf + vendored opentelemetry-proto is the Sprint-2 swap path when Bun ≥ 1.3.4 CI lands (D-S1-12, coord Jorge/Sebastian).
- 2026-04-16 — Sprint-1 Phase 5 follow-up: OTLP decoder swapped from hand-rolled proto3/JSON to @bufbuild/protobuf + vendored opentelemetry-proto v1.5.0 + buf generate (committed src/gen/). Per D-S1-12. Public decode signatures unchanged; mapping layer untouched.
