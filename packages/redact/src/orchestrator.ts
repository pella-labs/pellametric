// Redaction orchestrator — the single synchronous entry point called by the
// ingest hot path (apps/ingest/src/redact/hotpath.ts) and by the Clio on-device
// pipeline (packages/clio). Server-side is authoritative per contract 08.
//
// Contract 08 invariants enforced here:
//   1. Synchronous, single-threaded per call (invariant #1).
//   2. Deterministic — same input → same markers, same hashes (invariant #2).
//   3. Output format `<REDACTED:type:hash>` is stable (invariant #6).
//   4. Markers[] carry no PII/secrets outside the side log (invariant #4).
//   5. Tier-A raw_attrs allowlist applied post-scan (invariant #5).
//
// Pipeline: TruffleHog → Gitleaks → Presidio. Each stage adds finds to the
// scratch list; overlaps resolved by "first span wins" on (start ASC,
// end DESC, detector-order). Subsequent stages do not re-scan inside spans
// already replaced by earlier stages.

import { createHash } from "node:crypto";
import { gitleaksEngine, presidioEngine, trufflehogEngine } from "./engines";
import type { Engine, Find } from "./engines/types";
import type { RedactInput, RedactionMarker, RedactOutput, RedactStage } from "./stage";
import { filterRawAttrs } from "./tier_a_allowlist";

const HASH_LEN = 16;

// Stable ordering when two engines disagree on a span — deterministic dedup.
const DETECTOR_RANK: Record<RedactionMarker["detector"], number> = {
  trufflehog: 0,
  gitleaks: 1,
  presidio: 2,
};

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, HASH_LEN);
}

function renderMarker(type: RedactionMarker["type"], hash: string): string {
  return `<REDACTED:${type}:${hash}>`;
}

/**
 * Merge overlapping/adjacent finds. Preference: earlier start, then longer
 * span, then engine rank. No two output finds overlap.
 */
function mergeFinds(finds: Find[]): Find[] {
  if (finds.length === 0) return finds;
  const sorted = [...finds].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    return DETECTOR_RANK[a.detector] - DETECTOR_RANK[b.detector];
  });
  const out: Find[] = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last && f.start < last.end) {
      // Overlap — keep the earlier/longer (already preferred by sort). If the
      // current span extends beyond the kept one we can't "merge" them because
      // the span types may differ; drop the later span entirely. This matches
      // contract-08 §Pipeline-order: later stages don't re-scan replaced regions.
      continue;
    }
    out.push(f);
  }
  return out;
}

/**
 * Replace finds in `text` with `<REDACTED:type:hash>` markers and emit the
 * marker list. Finds must be non-overlapping (pass through `mergeFinds`).
 */
function applyFinds(text: string, finds: Find[]): { text: string; markers: RedactionMarker[] } {
  if (finds.length === 0) return { text, markers: [] };
  const pieces: string[] = [];
  const markers: RedactionMarker[] = [];
  let cursor = 0;
  for (const f of finds) {
    if (f.start < cursor) continue; // shouldn't happen post-merge.
    pieces.push(text.slice(cursor, f.start));
    const hash = hashValue(f.value);
    pieces.push(renderMarker(f.type, hash));
    markers.push({
      type: f.type,
      hash,
      detector: f.detector,
      rule: f.rule,
    });
    cursor = f.end;
  }
  pieces.push(text.slice(cursor));
  return { text: pieces.join(""), markers };
}

/**
 * Scan a single string across all engines. Runs TruffleHog first, then
 * Gitleaks (skipping regions already inside a trufflehog span), then
 * Presidio (skipping regions already inside earlier spans). This matches
 * the "subsequent stages don't re-scan replaced regions" invariant from
 * contract 08 §Pipeline order.
 */
function scanString(text: string, engines: readonly Engine[]): Find[] {
  let covered: Array<{ start: number; end: number }> = [];
  const allFinds: Find[] = [];
  for (const engine of engines) {
    const finds = engine.scan(text).filter((f) => !overlapsAny(f, covered));
    allFinds.push(...finds);
    // Update coverage after each engine so the next engine respects spans.
    covered = mergeRanges([...covered, ...finds.map((f) => ({ start: f.start, end: f.end }))]);
  }
  return allFinds;
}

function overlapsAny(f: Find, ranges: readonly { start: number; end: number }[]): boolean {
  for (const r of ranges) {
    if (f.start < r.end && f.end > r.start) return true;
  }
  return false;
}

function mergeRanges(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  if (first === undefined) return [];
  const out: Array<{ start: number; end: number }> = [{ ...first }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (last === undefined || cur === undefined) continue;
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Walk a plain object / array, redacting any string leaves in-place. Returns
 * the redacted structure and the flat list of markers.
 */
function redactWalk(
  value: unknown,
  engines: readonly Engine[],
  markers: RedactionMarker[],
): unknown {
  if (typeof value === "string") {
    const finds = mergeFinds(scanString(value, engines));
    if (finds.length === 0) return value;
    const { text, markers: m } = applyFinds(value, finds);
    markers.push(...m);
    return text;
  }
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactWalk(v, engines, markers));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactWalk(v, engines, markers);
    }
    return out;
  }
  return value;
}

function bumpBreakdown(
  acc: Partial<Record<RedactionMarker["type"], number>>,
  markers: readonly RedactionMarker[],
): void {
  for (const m of markers) {
    acc[m.type] = (acc[m.type] ?? 0) + 1;
  }
}

export interface OrchestratorOptions {
  /**
   * Optional per-org overrides (contract 08 §Per-org rule overrides). The
   * Sprint-2 minimum is `raw_attrs_allowlist_extra`; other fields are accepted
   * but ignored until the downstream engines support them.
   */
  readonly raw_attrs_allowlist_extra?: readonly string[];
}

/**
 * Build a RedactStage backed by the TruffleHog + Gitleaks + Presidio pipeline.
 *
 * Sync-returning; callers can `await` the result (RedactStage.run allows
 * either). The closure captures `opts` — a new stage must be built when the
 * org policy cache entry flips.
 */
export function createRedactionStage(opts: OrchestratorOptions = {}): RedactStage {
  const engines: readonly Engine[] = [trufflehogEngine, gitleaksEngine, presidioEngine];
  return {
    run(input: RedactInput): RedactOutput {
      const markers: RedactionMarker[] = [];

      const out: RedactOutput = {
        redaction_count: 0,
        redaction_breakdown: {},
        markers: [],
        raw_attrs_filtered: false,
      };

      if (input.prompt_text !== undefined) {
        out.prompt_text = redactWalk(input.prompt_text, engines, markers) as string;
      }
      if (input.tool_input !== undefined) {
        out.tool_input = redactWalk(input.tool_input, engines, markers);
      }
      if (input.tool_output !== undefined) {
        out.tool_output = redactWalk(input.tool_output, engines, markers);
      }
      if (input.raw_attrs !== undefined) {
        // For raw_attrs, scan values first, then (if Tier A) enforce allowlist.
        const scanned = redactWalk(input.raw_attrs, engines, markers) as
          | Record<string, unknown>
          | undefined;
        if (input.tier === "A" && scanned !== undefined) {
          const { filtered, dropped_keys } = filterRawAttrs(
            scanned,
            opts.raw_attrs_allowlist_extra ?? [],
          );
          if (filtered !== undefined) out.raw_attrs = filtered;
          out.raw_attrs_filtered = dropped_keys.length > 0;
        } else if (scanned !== undefined) {
          out.raw_attrs = scanned;
        }
      }

      bumpBreakdown(out.redaction_breakdown, markers);
      out.markers = markers;
      out.redaction_count = markers.length;
      return out;
    },
  };
}

/** Default, singleton stage — used where no per-org overrides are needed. */
export const defaultRedactionStage: RedactStage = createRedactionStage();
