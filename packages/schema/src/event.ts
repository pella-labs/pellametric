// Bematist wire-format event schema (contract 01).
//
// NOTE on `redaction_count`:
//   `redaction_count` is a RAW counter emitted by the server-side redaction
//   pipeline (contract 08) for audit / telemetry. It is NOT a D13-versioned
//   user-facing metric. D13 metric-versioning (`_v1`/`_v2`/`_v3` suffixes)
//   applies to derived / displayed metrics (AI Leverage Score, useful output,
//   etc.) — not to internal counters that are never surfaced to the IC or the
//   manager dashboard. See CLAUDE.md §Scoring Rules.

import { z } from "zod";

export const EventSchema = z.object({
  // Identity & dedup
  client_event_id: z.string().uuid(),
  schema_version: z.number().int().min(1).max(255),
  ts: z.string().datetime(),

  // Tenant / actor — server overrides these from JWT (do NOT trust collector)
  tenant_id: z.string(),
  engineer_id: z.string(),
  device_id: z.string(),

  // Source
  source: z.enum([
    "claude-code",
    "codex",
    "cursor",
    "opencode",
    "continue",
    "vscode-generic",
    "goose",
    "copilot-ide",
    "copilot-cli",
    "cline",
    "roo",
    "kilo",
    "antigravity",
  ]),
  source_version: z.string().optional(),
  fidelity: z.enum(["full", "estimated", "aggregate-only", "post-migration"]),
  cost_estimated: z.boolean().default(false),

  // Tier (privacy posture for THIS event)
  tier: z.enum(["A", "B", "C"]),

  // Session / sequencing
  session_id: z.string(),
  event_seq: z.number().int().nonnegative(),
  parent_session_id: z.string().optional(),

  // OTel GenAI semantic conventions (gen_ai.*)
  gen_ai: z
    .object({
      system: z.string().optional(),
      request: z
        .object({
          model: z.string().optional(),
          max_tokens: z.number().int().optional(),
        })
        .optional(),
      response: z
        .object({
          model: z.string().optional(),
          finish_reasons: z.array(z.string()).optional(),
        })
        .optional(),
      usage: z
        .object({
          input_tokens: z.number().int().nonnegative().optional(),
          output_tokens: z.number().int().nonnegative().optional(),
          cache_read_input_tokens: z.number().int().nonnegative().optional(),
          cache_creation_input_tokens: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),

  // DevMetrics extensions (dev_metrics.*) — coding-agent specifics
  dev_metrics: z.object({
    event_kind: z.enum([
      "session_start",
      "session_end",
      "llm_request",
      "llm_response",
      "tool_call",
      "tool_result",
      "code_edit_proposed",
      "code_edit_decision",
      "exec_command_start",
      "exec_command_end",
      "patch_apply_start",
      "patch_apply_end",
    ]),
    cost_usd: z.number().nonnegative().optional(),
    pricing_version: z.string().optional(),
    duration_ms: z.number().int().nonnegative().optional(),

    // Tool call specifics
    tool_name: z.string().optional(),
    tool_status: z.enum(["ok", "error", "denied"]).optional(),

    // Code edit specifics (for accepted-hunk attribution — D29 / §8.5)
    hunk_sha256: z.string().optional(),
    file_path_hash: z.string().optional(),
    edit_decision: z.enum(["accept", "reject", "modify"]).optional(),
    revert_within_24h: z.boolean().optional(),

    // First-try-rate inputs (cross-agent normalized; Phase 0 P0 fix)
    first_try_failure: z.boolean().optional(),
  }),

  // Tier-C-only fields — server REJECTS (HTTP 400) if present from Tier A/B sources
  prompt_text: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_output: z.unknown().optional(),

  // Clio-pipeline output for Tier B+ — abstract only, never raw
  prompt_record: z
    .object({
      session_id_hash: z.string(),
      prompt_index: z.number().int().nonnegative(),
      abstract: z.string(),
      embedding: z.array(z.number()).optional(),
      redaction_report: z.object({
        counts: z.record(z.string(), z.number()),
        pipeline_version: z.string(),
      }),
    })
    .optional(),

  // Server-side redaction marker (added at ingest, never sent by collector)
  redaction_count: z.number().int().nonnegative().optional(),

  // Catch-all for unknown attributes (D16) — promoted to typed col after 2 stable releases
  raw_attrs: z.record(z.string(), z.unknown()).optional(),
});

export type Event = z.infer<typeof EventSchema>;
