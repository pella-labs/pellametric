import { log } from "../../../logger";
import { readLinesFromOffset } from "./safeRead";
import type { RawCodexLine, RawCodexPayload } from "./types";

export interface CodexUsageSnapshot {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
}

export interface CodexTurnUsage extends CodexUsageSnapshot {
  /** Cumulative snapshot observed on this turn. Stored so the next poll can
   *  diff against it even if earlier events have scrolled off. */
  cumulative: CodexUsageSnapshot;
  model?: string;
  timestamp: string;
  turn_id?: string;
}

export interface ParsedCodexSession {
  sessionId: string | null;
  entries: RawCodexLine[];
  /** Per-turn deltas derived from cumulative token_count snapshots (D17).
   *  Map keyed on the synthesised turn key — `turn_id` if present, else
   *  `sequence#<n>`. Max-per-field dedup across repeated cumulative snapshots
   *  for the same turn (cumulative can only grow). */
  perTurnUsage: Map<string, CodexTurnUsage>;
  /** Last cumulative snapshot observed in the file; persisted across polls
   *  so resumed tailing keeps diffing correctly (stateful running total). */
  lastCumulative: CodexUsageSnapshot | null;
  /** Summed across every per-turn delta. */
  usageTotals: CodexUsageSnapshot;
  /** lastTimestamp − firstTimestamp in ms. Null if < 2 timestamps (D17). */
  durationMs: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface ParseOptions {
  /** Running total carried in from the cursor so a mid-session resume still
   *  diffs correctly. Defaults to all-zero. */
  priorCumulative?: CodexUsageSnapshot | null;
}

const ZERO_SNAPSHOT: CodexUsageSnapshot = {
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  total_tokens: 0,
};

export async function parseSessionFile(
  path: string,
  opts: ParseOptions = {},
): Promise<ParsedCodexSession> {
  const { lines } = await readLinesFromOffset(path, 0);
  return parseLines(lines, opts);
}

export function parseLines(lines: string[], opts: ParseOptions = {}): ParsedCodexSession {
  const entries: RawCodexLine[] = [];
  const perTurnUsage = new Map<string, CodexTurnUsage>();
  let lastCumulative: CodexUsageSnapshot | null = opts.priorCumulative ?? null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let sessionId: string | null = null;
  let tokenCountSeq = 0;

  for (const raw of lines) {
    let parsed: RawCodexLine;
    try {
      parsed = JSON.parse(raw) as RawCodexLine;
    } catch (e) {
      log.warn({ err: String(e) }, "codex: skipping malformed JSONL line");
      continue;
    }
    entries.push(parsed);

    if (parsed.session_id && !sessionId) sessionId = parsed.session_id;
    if (parsed.timestamp) {
      if (!firstTimestamp) firstTimestamp = parsed.timestamp;
      lastTimestamp = parsed.timestamp;
    }

    const kind = extractKind(parsed);
    const payload = extractPayload(parsed);

    if (kind === "token_count" && payload) {
      const cumulative = snapshotFromPayload(payload);
      const prior = lastCumulative ?? ZERO_SNAPSHOT;
      const delta: CodexUsageSnapshot = {
        input_tokens: nonNegativeDelta(cumulative.input_tokens, prior.input_tokens),
        output_tokens: nonNegativeDelta(cumulative.output_tokens, prior.output_tokens),
        cached_input_tokens: nonNegativeDelta(
          cumulative.cached_input_tokens,
          prior.cached_input_tokens,
        ),
        total_tokens: nonNegativeDelta(cumulative.total_tokens, prior.total_tokens),
      };
      const turnKey = parsed.turn_id ?? `sequence#${tokenCountSeq}`;
      tokenCountSeq++;

      // Max-per-field dedup (D17). If a turn's cumulative is ever re-emitted
      // in a later line (CLI flush), keep the field-wise max delta we've seen.
      const prev = perTurnUsage.get(turnKey);
      const merged: CodexTurnUsage = {
        input_tokens: Math.max(prev?.input_tokens ?? 0, delta.input_tokens),
        output_tokens: Math.max(prev?.output_tokens ?? 0, delta.output_tokens),
        cached_input_tokens: Math.max(prev?.cached_input_tokens ?? 0, delta.cached_input_tokens),
        total_tokens: Math.max(prev?.total_tokens ?? 0, delta.total_tokens),
        cumulative,
        timestamp: parsed.timestamp ?? prev?.timestamp ?? "",
      };
      const model = payload.model ?? prev?.model;
      if (model !== undefined) merged.model = model;
      const turnId = parsed.turn_id ?? prev?.turn_id;
      if (turnId !== undefined) merged.turn_id = turnId;
      perTurnUsage.set(turnKey, merged);
      lastCumulative = cumulative;
    }
  }

  const usageTotals: CodexUsageSnapshot = { ...ZERO_SNAPSHOT };
  for (const u of perTurnUsage.values()) {
    usageTotals.input_tokens += u.input_tokens;
    usageTotals.output_tokens += u.output_tokens;
    usageTotals.cached_input_tokens += u.cached_input_tokens;
    usageTotals.total_tokens += u.total_tokens;
  }

  let durationMs: number | null = null;
  if (firstTimestamp && lastTimestamp && firstTimestamp !== lastTimestamp) {
    durationMs = Date.parse(lastTimestamp) - Date.parse(firstTimestamp);
  } else if (firstTimestamp && lastTimestamp) {
    durationMs = 0;
  }

  return {
    sessionId,
    entries,
    perTurnUsage,
    lastCumulative,
    usageTotals,
    durationMs,
    firstTimestamp,
    lastTimestamp,
  };
}

export function extractKind(line: RawCodexLine): string | undefined {
  return line.event_msg?.type ?? line.type;
}

export function extractPayload(line: RawCodexLine): RawCodexPayload | undefined {
  return line.event_msg?.payload ?? line.payload;
}

function snapshotFromPayload(p: RawCodexPayload): CodexUsageSnapshot {
  return {
    input_tokens: p.input_tokens ?? 0,
    output_tokens: p.output_tokens ?? 0,
    cached_input_tokens: p.cached_input_tokens ?? 0,
    total_tokens: p.total_tokens ?? 0,
  };
}

function nonNegativeDelta(curr: number, prior: number): number {
  const d = curr - prior;
  return d > 0 ? d : 0;
}

export { ZERO_SNAPSHOT };
