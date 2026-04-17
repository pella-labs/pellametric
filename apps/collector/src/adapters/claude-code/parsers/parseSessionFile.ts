import { log } from "../../../logger";
import { readLinesFromOffset } from "./safeRead";
import type { RawClaudeSessionLine, RawClaudeUsage } from "./types";

export interface ParsedSession {
  sessionId: string | null;
  entries: RawClaudeSessionLine[];
  /** Per-requestId max-per-field (D17). */
  perRequestUsage: Map<string, RawClaudeUsage>;
  /** Summed across all requestIds. */
  usageTotals: Required<RawClaudeUsage>;
  /** lastTimestamp − firstTimestamp in ms. Null if < 2 timestamps. */
  durationMs: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

/**
 * Parse a Claude Code session JSONL file.
 *
 * D17 P0 fixes baked in:
 *   1. Per-requestId dedup with Map<requestId, usage>, max-per-field.
 *   2. durationMs = lastTimestamp − firstTimestamp.
 *   3. Safe file reader — no size cap.
 *
 * Line-parse failures log warn and skip that line; a corrupted tail line never
 * kills the whole session.
 */
export async function parseSessionFile(path: string): Promise<ParsedSession> {
  const { lines } = await readLinesFromOffset(path, 0);
  return parseLines(lines);
}

export function parseLines(lines: string[]): ParsedSession {
  const entries: RawClaudeSessionLine[] = [];
  const perRequestUsage = new Map<string, RawClaudeUsage>();
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let sessionId: string | null = null;

  for (const raw of lines) {
    let parsed: RawClaudeSessionLine;
    try {
      parsed = JSON.parse(raw) as RawClaudeSessionLine;
    } catch (e) {
      log.warn({ err: String(e) }, "claude-code: skipping malformed JSONL line");
      continue;
    }
    entries.push(parsed);

    if (parsed.sessionId && !sessionId) sessionId = parsed.sessionId;
    if (parsed.timestamp) {
      if (!firstTimestamp) firstTimestamp = parsed.timestamp;
      lastTimestamp = parsed.timestamp;
    }

    const usage = parsed.message?.usage;
    const rid = parsed.requestId;
    if (usage && rid) {
      const prior = perRequestUsage.get(rid) ?? {};
      const input = max(prior.input_tokens, usage.input_tokens);
      const output = max(prior.output_tokens, usage.output_tokens);
      const cacheRead = max(prior.cache_read_input_tokens, usage.cache_read_input_tokens);
      const cacheCreation = max(
        prior.cache_creation_input_tokens,
        usage.cache_creation_input_tokens,
      );
      const next: RawClaudeUsage = {};
      if (input !== undefined) next.input_tokens = input;
      if (output !== undefined) next.output_tokens = output;
      if (cacheRead !== undefined) next.cache_read_input_tokens = cacheRead;
      if (cacheCreation !== undefined) next.cache_creation_input_tokens = cacheCreation;
      perRequestUsage.set(rid, next);
    }
  }

  const usageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  for (const u of perRequestUsage.values()) {
    usageTotals.input_tokens += u.input_tokens ?? 0;
    usageTotals.output_tokens += u.output_tokens ?? 0;
    usageTotals.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    usageTotals.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
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
    perRequestUsage,
    usageTotals,
    durationMs,
    firstTimestamp,
    lastTimestamp,
  };
}

function max(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}
