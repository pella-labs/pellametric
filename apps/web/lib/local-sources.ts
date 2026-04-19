// Server-only wrapper around grammata. Reads every supported coding-agent
// source off the local filesystem in a single pass and memoizes for 60s so
// multiple server-rendered tiles in one request don't re-walk the filesystem.

import "server-only";

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildAnalytics,
  mergeAll,
  readClaude,
  readCodex,
  readCursor,
  readGoose,
} from "grammata";
import type { AnalyticsData } from "grammata";
import type { ClaudeSummary } from "grammata";
import type { CodexSummary } from "grammata";
import type { CursorSummary } from "grammata";
import type { GooseSummary } from "grammata";

export interface SourceRollup {
  name: string;
  key: "claude-code" | "codex" | "cursor" | "goose";
  sessions: number;
  tokens: number;
  cost: number;
  activeDays: number;
  costLabel?: string;
}

import {
  type ActiveBlockSnapshot,
  type BillingBlock,
  buildBlocks,
  entriesFromSources,
  historicalPeakTokens,
  snapshotActive,
} from "./blocks";

export interface LocalData {
  claude: ClaudeSummary | null;
  codex: CodexSummary | null;
  cursor: CursorSummary | null;
  goose: GooseSummary | null;
  analytics: AnalyticsData;
  sources: SourceRollup[];
  blocks: BillingBlock[];
  activeBlock: ActiveBlockSnapshot | null;
  /** Historical peak block tokens — basis for budget-guard warnings. */
  peakBlockTokens: number;
}

function activeDaysFromTimestamps(tss: string[]): number {
  const days = new Set<string>();
  for (const t of tss) {
    if (typeof t === "string" && t.length >= 10) days.add(t.slice(0, 10));
  }
  return days.size;
}

let memoryCache: { at: number; data: LocalData } | null = null;
const MEMORY_TTL_MS = 60_000;
// Disk cache survives `bun run dev` restarts; serve-stale-while-revalidate so
// a cold page is instant and the background refresh catches real changes.
const DISK_CACHE_PATH = join(tmpdir(), "bematist-web-grammata-cache.json");
const DISK_STALE_MS = 10 * 60_000; // 10 min — grammata walks are ~9s on this machine.

function readDiskCache(): LocalData | null {
  try {
    const st = statSync(DISK_CACHE_PATH);
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs > 6 * 60 * 60_000) return null; // 6h hard expiry — fresh enough reflects real usage.
    const raw = readFileSync(DISK_CACHE_PATH, "utf8");
    return JSON.parse(raw) as LocalData;
  } catch {
    return null;
  }
}

function writeDiskCache(data: LocalData): void {
  try {
    mkdirSync(dirname(DISK_CACHE_PATH), { recursive: true });
    writeFileSync(DISK_CACHE_PATH, JSON.stringify(data));
  } catch {
    // disk cache is an optimization — never fail the request over it.
  }
}

let inFlight: Promise<LocalData> | null = null;

async function readFresh(): Promise<LocalData> {
  // Single pass: read each source once, feed mergeAll + buildAnalytics.
  const [claude, codex, cursor, goose] = await Promise.all([
    readClaude().catch(() => null),
    readCodex().catch(() => null),
    readCursor().catch(() => null),
    readGoose().catch(() => null),
  ]);
  const merged = mergeAll(claude, codex, cursor, goose);
  const analytics = buildAnalytics(merged);

  const sources: SourceRollup[] = [
    {
      name: "Claude Code",
      key: "claude-code",
      sessions: claude?.sessions.length ?? 0,
      tokens: (claude?.totalInputTokens ?? 0) + (claude?.totalOutputTokens ?? 0),
      cost: claude?.totalCost ?? 0,
      activeDays: claude
        ? activeDaysFromTimestamps(claude.sessions.map((s) => s.firstTimestamp))
        : 0,
    },
    {
      name: "Codex",
      key: "codex",
      sessions: codex?.sessions.length ?? 0,
      tokens: (codex?.totalInputTokens ?? 0) + (codex?.totalOutputTokens ?? 0),
      cost: codex?.totalCost ?? 0,
      activeDays: codex ? activeDaysFromTimestamps(codex.sessions.map((s) => s.createdAt)) : 0,
    },
    {
      name: "Cursor",
      key: "cursor",
      sessions: cursor?.sessions.length ?? 0,
      tokens: 0, // Cursor doesn't expose token counts.
      cost: cursor?.totalCost ?? 0,
      activeDays: cursor ? activeDaysFromTimestamps(cursor.sessions.map((s) => s.createdAt)) : 0,
      costLabel: "subscription",
    },
    {
      name: "Goose",
      key: "goose",
      sessions: goose?.sessions.length ?? 0,
      tokens: (goose?.totalInputTokens ?? 0) + (goose?.totalOutputTokens ?? 0),
      cost: goose?.totalCost ?? 0,
      activeDays: goose ? activeDaysFromTimestamps(goose.sessions.map((s) => s.createdAt)) : 0,
    },
  ];

  const entries = entriesFromSources(claude, codex, cursor);
  const blocks = buildBlocks(entries, Date.now());
  const activeBlock = snapshotActive(blocks, Date.now());
  const peakBlockTokens = historicalPeakTokens(blocks);

  const data: LocalData = {
    claude,
    codex,
    cursor,
    goose,
    analytics,
    sources,
    blocks,
    activeBlock,
    peakBlockTokens,
  };
  memoryCache = { at: Date.now(), data };
  writeDiskCache(data);
  return data;
}

/** Recompute time-sensitive fields (isActive flag + activeBlock snapshot)
 *  with a fresh `now`. Cached data carries blocks computed at read time;
 *  we need to re-derive the "which block is live right now" bits on every
 *  request so the dashboard doesn't claim a stale block is still active. */
function rehydrateLive(data: LocalData, now: number): LocalData {
  const refreshed = data.blocks.map((b) => ({ ...b }));
  // Mark only the last non-gap block; everything before it is historical.
  for (let i = refreshed.length - 1; i >= 0; i--) {
    const b = refreshed[i];
    if (!b) continue;
    if (b.isGap) {
      b.isActive = false;
      continue;
    }
    const last = b.lastEntryIso ? Date.parse(b.lastEntryIso) : 0;
    b.isActive = now < b.endMs && now - last < 5 * 60 * 60_000;
    break;
  }
  const activeBlock = snapshotActive(refreshed, now);
  return { ...data, blocks: refreshed, activeBlock };
}

export async function getLocalData(): Promise<LocalData> {
  const now = Date.now();
  if (memoryCache && now - memoryCache.at < MEMORY_TTL_MS)
    return rehydrateLive(memoryCache.data, now);

  // Hydrate from disk on cold start so a fresh `bun run dev` doesn't eat the
  // 9-second grammata walk.
  if (!memoryCache) {
    const disk = readDiskCache();
    if (disk) memoryCache = { at: now, data: disk };
  }

  // Stale-while-revalidate: if the disk cache is ≥10 min old, kick off a
  // background refresh but serve the stale copy immediately. First-ever run
  // falls through to the fresh read and pays the full cost once.
  if (memoryCache) {
    const ageMs = now - memoryCache.at;
    if (ageMs > DISK_STALE_MS && !inFlight) {
      inFlight = readFresh().finally(() => {
        inFlight = null;
      });
    }
    return rehydrateLive(memoryCache.data, now);
  }

  if (!inFlight) {
    inFlight = readFresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function invalidateLocalData(): void {
  memoryCache = null;
}

export type SourceFilter = "claude-code" | "codex" | "cursor" | "goose" | null;

/**
 * Return a view of LocalData where everything but the named source is blanked
 * out. Re-runs mergeAll + buildAnalytics + block algorithm so headline tiles,
 * charts, and the billing-block tile all reflect only that source. Runs
 * entirely in memory — no filesystem re-read — so filtering is ~instant
 * after the first load.
 */
export async function getLocalDataFor(filter: SourceFilter): Promise<LocalData> {
  const base = await getLocalData();
  if (!filter) return base;

  const claude = filter === "claude-code" ? base.claude : null;
  const codex = filter === "codex" ? base.codex : null;
  const cursor = filter === "cursor" ? base.cursor : null;
  const goose = filter === "goose" ? base.goose : null;

  const merged = mergeAll(claude, codex, cursor, goose);
  const analytics = buildAnalytics(merged);
  const sources = base.sources.map((s) =>
    s.key === filter ? s : { ...s, sessions: 0, tokens: 0, cost: 0, activeDays: 0 },
  );
  const entries = entriesFromSources(claude, codex, cursor);
  const blocks = buildBlocks(entries, Date.now());
  const activeBlock = snapshotActive(blocks, Date.now());
  const peakBlockTokens = historicalPeakTokens(blocks);

  return {
    claude,
    codex,
    cursor,
    goose,
    analytics,
    sources,
    blocks,
    activeBlock,
    peakBlockTokens,
  };
}
