// ccusage-style 5-hour billing block algorithm, computed over grammata's
// session-level data. Grammata doesn't expose per-turn entries, so each
// session is treated as a single event at its start time — tokens land in
// the block its start timestamp falls in. This is an approximation for
// marathon sessions (a 2-hour session is not spread across blocks) but is
// accurate enough for the headline "current block" + burn-rate view which
// is what ICs care about live.
//
// Reference: ccusage /apps/ccusage/src/_session-blocks.ts — UTC-floored
// block starts, 5h rolling window, gap blocks, isActive detection.

import "server-only";

import type { ClaudeSummary, CodexSummary, CursorSummary } from "grammata";

const BLOCK_MS = 5 * 60 * 60 * 1000; // 5 hours.
const GAP_MS = 5 * 60 * 60 * 1000; // same — ccusage uses identical threshold.

export interface BlockEntry {
  ts: number;
  model: string;
  source: "claude-code" | "codex" | "cursor";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  cost: number;
}

export interface BillingBlock {
  startMs: number;
  endMs: number;
  /** True for gap markers — rendered as idle time between real blocks. */
  isGap: boolean;
  /** True if block is still accepting new entries (now within block AND
   *  last-entry fresher than 5h ago). */
  isActive: boolean;
  entryCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  cost: number;
  models: string[];
  sources: string[];
  /** ISO timestamp of the most recent entry in this block. */
  lastEntryIso: string | null;
}

export interface BurnRate {
  /** Tokens per minute. Excludes cache tokens (matches ccusage "indicator"). */
  tokensPerMinute: number;
  /** USD per hour at current pace. Includes cache cost (actual spend). */
  costPerHour: number;
  /** Classification band for alerts. */
  band: "NORMAL" | "MODERATE" | "HIGH";
}

export interface ActiveBlockSnapshot {
  block: BillingBlock;
  remainingMs: number;
  burnRate: BurnRate;
  /** Linear projection of total cost to block end at current burn rate. */
  projectedCost: number;
}

/** Floor a timestamp down to the nearest UTC hour. */
function floorToHourUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0);
}

export function buildBlocks(entries: BlockEntry[], now: number = Date.now()): BillingBlock[] {
  if (entries.length === 0) return [];
  // Entries must be in chronological order — defend against misordered input.
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);

  const blocks: BillingBlock[] = [];
  let cur: BillingBlock | null = null;
  let lastEntryTs = 0;

  for (const e of sorted) {
    if (!cur) {
      cur = newBlock(e, now);
      applyEntry(cur, e);
      lastEntryTs = e.ts;
      continue;
    }

    const sinceBlockStart = e.ts - cur.startMs;
    const sinceLastEntry = e.ts - lastEntryTs;

    if (sinceBlockStart >= BLOCK_MS || sinceLastEntry >= GAP_MS) {
      // Close current block. Possibly emit a gap block before the next one.
      finalizeBlock(cur, now);
      blocks.push(cur);

      if (sinceLastEntry >= GAP_MS) {
        blocks.push({
          startMs: lastEntryTs,
          endMs: e.ts,
          isGap: true,
          isActive: false,
          entryCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          cost: 0,
          models: [],
          sources: [],
          lastEntryIso: null,
        });
      }

      cur = newBlock(e, now);
    }

    applyEntry(cur, e);
    lastEntryTs = e.ts;
  }

  if (cur) {
    finalizeBlock(cur, now);
    blocks.push(cur);
  }

  return blocks;
}

function newBlock(e: BlockEntry, _now: number): BillingBlock {
  const start = floorToHourUTC(e.ts);
  return {
    startMs: start,
    endMs: start + BLOCK_MS,
    isGap: false,
    isActive: false,
    entryCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    cost: 0,
    models: [],
    sources: [],
    lastEntryIso: null,
  };
}

function applyEntry(b: BillingBlock, e: BlockEntry): void {
  b.entryCount++;
  b.inputTokens += e.inputTokens;
  b.outputTokens += e.outputTokens;
  b.cacheReadTokens += e.cacheReadTokens;
  b.cacheCreateTokens += e.cacheCreateTokens;
  b.cost += e.cost;
  if (e.model && !b.models.includes(e.model)) b.models.push(e.model);
  if (e.source && !b.sources.includes(e.source)) b.sources.push(e.source);
  const iso = new Date(e.ts).toISOString();
  if (!b.lastEntryIso || iso > b.lastEntryIso) b.lastEntryIso = iso;
}

function finalizeBlock(b: BillingBlock, now: number): void {
  const last = b.lastEntryIso ? Date.parse(b.lastEntryIso) : 0;
  b.isActive = now < b.endMs && now - last < GAP_MS;
}

/** Translate grammata per-source summaries into block entries. */
export function entriesFromSources(
  claude: ClaudeSummary | null,
  codex: CodexSummary | null,
  cursor: CursorSummary | null,
): BlockEntry[] {
  const out: BlockEntry[] = [];
  if (claude) {
    for (const s of claude.sessions) {
      const ts = Date.parse(s.firstTimestamp);
      if (Number.isNaN(ts)) continue;
      out.push({
        ts,
        model: s.model || "claude-unknown",
        source: "claude-code",
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        cacheReadTokens: s.cacheReadTokens ?? 0,
        cacheCreateTokens: s.cacheCreateTokens ?? 0,
        cost: s.costUsd ?? 0,
      });
    }
  }
  if (codex) {
    for (const s of codex.sessions) {
      const ts = Date.parse(s.createdAt);
      if (Number.isNaN(ts)) continue;
      out.push({
        ts,
        model: s.model || "codex-unknown",
        source: "codex",
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        cacheReadTokens: s.cachedInputTokens ?? 0,
        cacheCreateTokens: 0,
        cost: s.costUsd ?? 0,
      });
    }
  }
  if (cursor) {
    for (const s of cursor.sessions) {
      const ts = Date.parse(s.createdAt);
      if (Number.isNaN(ts)) continue;
      out.push({
        ts,
        model: s.model || "cursor-unknown",
        source: "cursor",
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        cost: s.costUsd ?? 0,
      });
    }
  }
  return out;
}

/** Classification bands — deliberately simple, tunable once we have real
 *  cohort data. Mirrors ccusage's HIGH/MODERATE/NORMAL split. */
function bandFor(tokensPerMinute: number): BurnRate["band"] {
  if (tokensPerMinute >= 1500) return "HIGH";
  if (tokensPerMinute >= 500) return "MODERATE";
  return "NORMAL";
}

export function computeBurnRate(block: BillingBlock, now: number): BurnRate {
  const elapsedMs = Math.max(1, now - block.startMs);
  const elapsedMin = elapsedMs / 60_000;
  const elapsedHr = elapsedMs / 3_600_000;
  // Match ccusage: "indicator" excludes cache tokens to keep thresholds
  // stable across models with varying cache patterns.
  const indicatorTokens = block.inputTokens + block.outputTokens;
  const tokensPerMinute = indicatorTokens / elapsedMin;
  const costPerHour = block.cost / elapsedHr;
  return { tokensPerMinute, costPerHour, band: bandFor(tokensPerMinute) };
}

export function snapshotActive(
  blocks: BillingBlock[],
  now: number = Date.now(),
): ActiveBlockSnapshot | null {
  const active = blocks.find((b) => b.isActive && !b.isGap);
  if (!active) return null;
  const remainingMs = Math.max(0, active.endMs - now);
  const burnRate = computeBurnRate(active, now);
  const remainingHr = remainingMs / 3_600_000;
  const projectedCost = active.cost + burnRate.costPerHour * remainingHr;
  return { block: active, remainingMs, burnRate, projectedCost };
}

/** Historical peak — the biggest block we've ever seen by total tokens.
 *  Used for the `-t max` budget-guard warning on the active block. */
export function historicalPeakTokens(blocks: BillingBlock[]): number {
  let peak = 0;
  for (const b of blocks) {
    if (b.isGap) continue;
    const t = b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheCreateTokens;
    if (t > peak) peak = t;
  }
  return peak;
}
