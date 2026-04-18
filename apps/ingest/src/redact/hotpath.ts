// Ingest hot-path redaction (contract 08; CLAUDE.md §Security Rules).
//
// `redactEventInPlace` is the synchronous seam the ingest server calls for
// every zod-valid, dedup-firstSight event before canonicalize + WAL append.
// Keeping this module isolated from server.ts lets us:
//
//   - Own the redaction hot path without touching ingest's auth/dedup/WAL code.
//     The boot wire-up (swap `deps.redactStage` to `defaultRedactionStage`) is
//     a one-line change in `apps/ingest/src/index.ts` — not in scope for this
//     PR per the A6 brief.
//   - Centralize Tier-A raw_attrs allowlist application at write-time (C10).
//     The existing `applyTierAAllowlist` (apps/ingest/src/tier/enforceTier.ts)
//     still runs pre-WAL when `ENFORCE_TIER_A_ALLOWLIST=1`; this module is a
//     defense-in-depth pass that also redacts Tier-A `raw_attrs` VALUES and
//     emits a `redaction_audit` row per hit.
//   - Emit `redaction_audit` rows for the D-workstream side table (contract
//     09 §Side tables). Writer is pluggable so unit tests assert shape
//     without a live CH connection.
//
// Invariants (contract 08):
//   - Synchronous and single-threaded per call (inv #1).
//   - Deterministic — same input → same output (inv #2).
//   - Server is authoritative — if the collector already redacted, we
//     re-scan and overwrite (inv #3).
//   - Markers[] carry only (type, hash, detector, rule). Raw values live in
//     the audit side-log, never in the event row (inv #4).
//   - Tier-A raw_attrs allowlist enforced at write-time (inv #5).
//   - Replacement format `<REDACTED:type:hash>` is stable (inv #6).

import {
  createRedactionStage,
  defaultRedactionStage,
  filterRawAttrs,
  type RedactionMarker,
  type RedactStage,
} from "@bematist/redact";
import type { Event } from "@bematist/schema";

/**
 * A single audit row emitted per redaction hit. Shape aligned with contract 09
 * §Side tables `redaction_audit` (30d, separate from `events`). Schema may be
 * extended by the D workstream; field names here are the source of truth for
 * downstream consumers.
 */
export interface RedactionAuditRow {
  /** Tenant/org id — RLS key. */
  tenant_id: string;
  /** Event `client_event_id` — joins back to `events`. */
  client_event_id: string;
  /** Session id (hashed when tier='A'). */
  session_id: string;
  /** Ordinal within the event's markers[] — stable per (client_event_id, seq). */
  marker_seq: number;
  /** Where the marker was found. */
  field: "prompt_text" | "tool_input" | "tool_output" | "raw_attrs";
  /** PII / secret type. */
  type: RedactionMarker["type"];
  /** `trufflehog` | `gitleaks` | `presidio`. */
  detector: RedactionMarker["detector"];
  /** Rule name — e.g. "AWSAccessKey". */
  rule: string;
  /** sha256(original).slice(0, 16). */
  hash: string;
  /** Engine-assigned tier at redaction time (Tier A allowlist applied). */
  tier: "A" | "B" | "C";
  /** UTC ms — server clock, not wire ts, for audit immutability. */
  redacted_at_ms: number;
}

/**
 * Pluggable sink for audit rows. Production binds to a ClickHouse batcher
 * writing to `redaction_audit`. Tests bind an in-memory sink to assert shape.
 */
export interface RedactionAuditSink {
  emit(rows: ReadonlyArray<RedactionAuditRow>): void | Promise<void>;
}

export function createInMemoryAuditSink(): RedactionAuditSink & {
  rows: RedactionAuditRow[];
  reset: () => void;
} {
  const rows: RedactionAuditRow[] = [];
  return {
    rows,
    emit(batch) {
      for (const r of batch) rows.push(r);
    },
    reset() {
      rows.length = 0;
    },
  };
}

export interface RedactEventResult {
  /** The event with string fields redacted and `redaction_count` bumped. */
  event: Event;
  /** Markers emitted by the scanner (pre-audit). */
  markers: ReadonlyArray<RedactionMarker>;
  /** Audit rows — one per marker. Also emitted to `sink` when provided. */
  audit: ReadonlyArray<RedactionAuditRow>;
  /** True when Tier-A `raw_attrs` were trimmed to allowlist. */
  raw_attrs_filtered: boolean;
}

export interface RedactEventOptions {
  /** Override the stage for tests — defaults to `defaultRedactionStage`. */
  stage?: RedactStage;
  /** Per-org extras to the Tier-A raw_attrs allowlist (contract 08 §F). */
  raw_attrs_allowlist_extra?: readonly string[];
  /** Server clock — injectable for deterministic tests. */
  now?: () => number;
  /** Audit sink. When set, rows are emitted; this function STILL returns them
   *  so the caller can choose to await the sink write. */
  auditSink?: RedactionAuditSink;
}

/**
 * Redact a parsed event. Returns a NEW event object (the input is not
 * mutated) with:
 *
 *   - `prompt_text`, `tool_input`, `tool_output` string leaves replaced with
 *     `<REDACTED:type:hash>` markers.
 *   - `raw_attrs` values redacted; when tier='A', the allowlist is enforced at
 *     write time (drops non-allowed keys). Per-org extras flow via `opts.raw_attrs_allowlist_extra`.
 *   - `redaction_count` bumped by the total number of markers emitted.
 *
 * Audit rows are returned for every marker. When `opts.auditSink` is set we
 * also forward the rows to the sink — fire-and-forget semantics for the hot
 * path; the sink MUST be non-blocking. In production the sink is a CH batcher
 * with its own backpressure (see `apps/ingest/src/clickhouse/`).
 */
export async function redactEventInPlace(
  event: Event,
  opts: RedactEventOptions = {},
): Promise<RedactEventResult> {
  // When the caller passes per-org allowlist extras, build a stage that
  // honours them — the default singleton doesn't know about them. When no
  // extras are supplied we use the cached `defaultRedactionStage`.
  const stage =
    opts.stage ??
    (opts.raw_attrs_allowlist_extra && opts.raw_attrs_allowlist_extra.length > 0
      ? createRedactionStage({ raw_attrs_allowlist_extra: opts.raw_attrs_allowlist_extra })
      : defaultRedactionStage);
  const now = opts.now ?? (() => Date.now());

  // Build the RedactInput with conditional spreads so we never pass
  // `undefined` on a field the stage treats as exactOptional.
  const stageInput: Parameters<typeof stage.run>[0] = { tier: event.tier };
  if (event.prompt_text !== undefined) stageInput.prompt_text = event.prompt_text;
  if (event.tool_input !== undefined) stageInput.tool_input = event.tool_input;
  if (event.tool_output !== undefined) stageInput.tool_output = event.tool_output;
  if (event.raw_attrs !== undefined) stageInput.raw_attrs = event.raw_attrs;
  const out = await stage.run(stageInput);

  // Defense in depth: even if the stage's internal Tier-A allowlist fired,
  // re-apply it here with the per-org extras. filterRawAttrs is idempotent.
  let rawAttrs = out.raw_attrs;
  let rawFiltered = out.raw_attrs_filtered;
  if (event.tier === "A" && rawAttrs !== undefined) {
    const { filtered, dropped_keys } = filterRawAttrs(
      rawAttrs,
      opts.raw_attrs_allowlist_extra ?? [],
    );
    if (dropped_keys.length > 0) rawFiltered = true;
    rawAttrs = filtered;
  }

  const priorCount = event.redaction_count ?? 0;
  const markerCount = out.markers.length;

  const nextEvent: Event = {
    ...event,
    redaction_count: priorCount + markerCount,
  };
  const redactedPrompt = out.prompt_text ?? event.prompt_text;
  if (redactedPrompt !== undefined) nextEvent.prompt_text = redactedPrompt;
  const redactedToolInput = out.tool_input ?? event.tool_input;
  if (redactedToolInput !== undefined) nextEvent.tool_input = redactedToolInput;
  const redactedToolOutput = out.tool_output ?? event.tool_output;
  if (redactedToolOutput !== undefined) nextEvent.tool_output = redactedToolOutput;
  const redactedAttrs = rawAttrs ?? event.raw_attrs;
  if (redactedAttrs !== undefined) nextEvent.raw_attrs = redactedAttrs;

  // Build audit rows. `field` is a best-effort attribution — we re-scan each
  // field to mark where a marker landed. This is O(M * F) with tiny constants
  // (F=4, M typically small); well under the 5ms budget.
  const audit: RedactionAuditRow[] = [];
  const ts = now();
  for (let i = 0; i < out.markers.length; i++) {
    const m = out.markers[i];
    if (m === undefined) continue;
    audit.push({
      tenant_id: event.tenant_id,
      client_event_id: event.client_event_id,
      session_id: event.session_id,
      marker_seq: i,
      field: attributeField(m, out),
      type: m.type,
      detector: m.detector,
      rule: m.rule,
      hash: m.hash,
      tier: event.tier,
      redacted_at_ms: ts,
    });
  }

  if (opts.auditSink && audit.length > 0) {
    await opts.auditSink.emit(audit);
  }

  return {
    event: nextEvent,
    markers: out.markers,
    audit,
    raw_attrs_filtered: rawFiltered,
  };
}

/**
 * Best-effort field attribution for a marker: scan each redacted field for
 * the `<REDACTED:type:hash>` token. First field containing it wins. Used
 * only in the audit row — does NOT gate the hot-path replacement.
 */
function attributeField(
  m: RedactionMarker,
  out: {
    prompt_text?: string;
    tool_input?: unknown;
    tool_output?: unknown;
    raw_attrs?: Record<string, unknown>;
  },
): RedactionAuditRow["field"] {
  const needle = `<REDACTED:${m.type}:${m.hash}>`;
  if (typeof out.prompt_text === "string" && out.prompt_text.includes(needle)) {
    return "prompt_text";
  }
  if (stringifiedContains(out.tool_input, needle)) return "tool_input";
  if (stringifiedContains(out.tool_output, needle)) return "tool_output";
  if (stringifiedContains(out.raw_attrs, needle)) return "raw_attrs";
  // Marker didn't resolve to a field — rare (all-same-hash collisions); bucket
  // as raw_attrs conservatively.
  return "raw_attrs";
}

function stringifiedContains(value: unknown, needle: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.includes(needle);
  try {
    return JSON.stringify(value).includes(needle);
  } catch {
    return false;
  }
}

/**
 * Shape check: true if `event` contains any string marker. Used by smoke
 * tests and by the privacy nightly invariant scan (A16).
 */
export function containsRedactionMarker(event: Event): boolean {
  const re = /<REDACTED:[a-z_]+:[0-9a-f]{16}>/;
  if (typeof event.prompt_text === "string" && re.test(event.prompt_text)) return true;
  if (stringifiedContains(event.tool_input, "<REDACTED:")) return true;
  if (stringifiedContains(event.tool_output, "<REDACTED:")) return true;
  if (stringifiedContains(event.raw_attrs, "<REDACTED:")) return true;
  return false;
}
