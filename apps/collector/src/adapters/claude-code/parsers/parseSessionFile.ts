import { log } from "../../../logger";
import { readLinesFromOffset } from "./safeRead";
import type { RawClaudeSessionLine, RawClaudeUsage } from "./types";

export interface ParsedSession {
  sessionId: string | null;
  entries: RawClaudeSessionLine[];
  /**
   * Per-requestId max-per-field usage. Kept for back-compat; new code should
   * prefer `perUsageKey` which matches grammata's dedup semantics (keyed by
   * `message.id || requestId || uuid`). `perRequestUsage` only has an entry
   * when the line carries a `requestId`, so it silently drops lines that
   * only have `message.id` or `uuid`.
   */
  perRequestUsage: Map<string, RawClaudeUsage>;
  /**
   * Per-dedup-key max-per-field usage. The key selector is
   * `message.id || requestId || uuid || synthetic`, matching grammata/claude.js.
   * This is the authoritative usage map — normalize emits usage/cost on
   * exactly one llm_response per key, preventing the 2-8× token inflation
   * that streaming partials caused when we emitted usage on every assistant
   * line (each line carried the deduped cumulative total → summing lines
   * multiplied tokens by turns-per-key).
   */
  perUsageKey: Map<string, RawClaudeUsage>;
  /**
   * Map of entry index → dedup key, for every assistant line that carried
   * usage. Normalize walks `entries` in order and looks up this map to
   * decide which line "owns" the usage emission for its key (the first one
   * seen). Lines whose index is the *owner* emit usage + cost; later lines
   * sharing the key emit an llm_response event with no usage and no cost.
   */
  usageKeyByEntryIdx: Map<number, string>;
  /**
   * Set of entry indices that are the *owner* of their usage key — i.e.,
   * the first assistant line observed for that key. Emit usage/cost only
   * here.
   */
  usageOwnerEntryIdx: Set<number>;
  /** Summed across all dedup keys (grammata-compatible). */
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
  const perUsageKey = new Map<string, RawClaudeUsage>();
  const usageKeyByEntryIdx = new Map<number, string>();
  const usageOwnerEntryIdx = new Set<number>();
  const seenKeys = new Set<string>();
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
    const entryIdx = entries.length;
    entries.push(parsed);

    if (parsed.sessionId && !sessionId) sessionId = parsed.sessionId;
    if (parsed.timestamp) {
      if (!firstTimestamp) firstTimestamp = parsed.timestamp;
      lastTimestamp = parsed.timestamp;
    }

    const usage = parsed.message?.usage;
    const rid = parsed.requestId;
    if (usage) {
      // Back-compat: keep the requestId-keyed map populated when requestId
      // exists so older callers don't break.
      if (rid) {
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

      // Grammata-style dedup: prefer `message.id`, then `requestId`, then
      // `uuid`, then a per-entry synthetic. This groups Claude Code's
      // mid-stream partial + final assistant records — they share
      // requestId/message.id but the final record carries cumulative usage;
      // naive summation would double-count every turn.
      const usageKey = parsed.message?.id ?? rid ?? parsed.uuid ?? `anon-${perUsageKey.size}`;
      usageKeyByEntryIdx.set(entryIdx, usageKey);
      if (!seenKeys.has(usageKey)) {
        seenKeys.add(usageKey);
        usageOwnerEntryIdx.add(entryIdx);
      }
      const priorKey = perUsageKey.get(usageKey) ?? {};
      const ki = max(priorKey.input_tokens, usage.input_tokens);
      const ko = max(priorKey.output_tokens, usage.output_tokens);
      const kcr = max(priorKey.cache_read_input_tokens, usage.cache_read_input_tokens);
      const kcc = max(priorKey.cache_creation_input_tokens, usage.cache_creation_input_tokens);
      const next2: RawClaudeUsage = {};
      if (ki !== undefined) next2.input_tokens = ki;
      if (ko !== undefined) next2.output_tokens = ko;
      if (kcr !== undefined) next2.cache_read_input_tokens = kcr;
      if (kcc !== undefined) next2.cache_creation_input_tokens = kcc;
      perUsageKey.set(usageKey, next2);
    }
  }

  const usageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  for (const u of perUsageKey.values()) {
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
    perUsageKey,
    usageKeyByEntryIdx,
    usageOwnerEntryIdx,
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
