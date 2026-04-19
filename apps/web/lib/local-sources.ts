// Server-only wrapper around grammata. Reads every supported coding-agent
// source off the local filesystem in a single pass and memoizes for 60s so
// multiple server-rendered tiles in one request don't re-walk the filesystem.

import "server-only";

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AnalyticsData,
  ClaudeSummary,
  CodexSummary,
  CursorSummary,
  GooseSummary,
  UnifiedSession,
} from "grammata";
import { buildAnalytics, mergeAll, readClaude, readCodex, readCursor, readGoose } from "grammata";

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

const USE_CH = process.env.BEMATIST_USE_CH === "1";

async function readFreshFromCh(): Promise<LocalData> {
  const { ensureBackfill } = await import("./ch-backfill");
  const { readAnalyticsForEngineer } = await import("./ch-analytics");
  const { getSessionCtx } = await import("./session");
  const { resolveEngineerId } = await import("./resolve-engineer-id");

  // Identity alignment: ingest writes events with engineer_id = developer.id
  // (the row in `developers` keyed off the mint token). Session gives us
  // ctx.actor_id = user_id. Resolve the developer row so CH queries match.
  const ctx = await getSessionCtx();
  const orgId = ctx.tenant_id;
  const resolved = await resolveEngineerId(orgId, ctx.actor_id).catch(() => null);
  const engineerId = resolved ?? ctx.actor_id;

  // Auto-backfill — on dev's local machine, grammata reads their filesystem
  // and writes into CH under this engineerId. On Railway this is a no-op
  // (grammata has nothing to read) and the read below still returns data
  // the user backfilled from their own laptop earlier.
  await ensureBackfill(orgId, engineerId);

  const { analytics } = await readAnalyticsForEngineer(orgId, engineerId);

  // Reconstruct per-source summaries from sessionRows so pages that still
  // destructure { claude, codex, cursor } (sessions list, outcomes waste,
  // me/digest) keep rendering. Fields we can't recover from CH (cursor
  // tab-accept counters, codex reasoning blocks) degrade to 0 — pages
  // either show a dash or hide the tile.
  const claudeSessions = analytics.sessionRows.filter((s) => s.source === "claude-code");
  const codexSessions = analytics.sessionRows.filter((s) => s.source === "codex");
  const cursorSessions = analytics.sessionRows.filter((s) => s.source === "cursor");

  const claudeSummary = claudeSessions.length
    ? {
        sessions: claudeSessions.map((s) => ({
          sessionId: s.id,
          sessionName: s.name || s.id.slice(0, 8),
          project: s.project || "",
          firstTimestamp: s.date,
          lastTimestamp: s.date,
          durationMs: s.durationMs || 0,
          model: s.model || "",
          inputTokens: s.inputTokens || 0,
          outputTokens: s.outputTokens || 0,
          cacheReadTokens: s.cacheReadTokens || 0,
          cacheCreateTokens: s.cacheCreateTokens || 0,
          costUsd: s.cost || 0,
          turnCount: (s.messageCount || 0) * 2,
          toolCalls: s.toolCalls || 0,
          toolBreakdown: s.toolBreakdown || {},
          gitBranch: s.gitBranch || "",
          prLinks: s.prLinks || [],
          retryCount: s.retryCount || 0,
          totalEditTurns: s.totalEditTurns || 0,
          mostRetriedFile: s.mostRetriedFile ?? null,
          perToolCounts: s.perToolCounts || {},
          entrypoint: s.entrypoint || "",
          version: s.version || "",
        })),
        totalCost: claudeSessions.reduce((a, s) => a + s.cost, 0),
        totalInputTokens: claudeSessions.reduce((a, s) => a + s.inputTokens, 0),
        totalOutputTokens: claudeSessions.reduce((a, s) => a + s.outputTokens, 0),
        totalCacheReadTokens: claudeSessions.reduce((a, s) => a + s.cacheReadTokens, 0),
        totalCacheCreateTokens: claudeSessions.reduce((a, s) => a + s.cacheCreateTokens, 0),
        cacheSavingsUsd: 0,
        toolBreakdown: {},
        hourDistribution: new Array(24).fill(0),
      }
    : null;

  const codexSummary = codexSessions.length
    ? {
        sessions: codexSessions.map((s) => ({
          sessionId: s.id,
          sessionName: s.name || s.id.slice(0, 8),
          firstMessage: s.name || "",
          project: s.project || "",
          model: s.model || "",
          modelProvider: s.provider || "",
          inputTokens: s.inputTokens || 0,
          cachedInputTokens: s.cacheReadTokens || 0,
          outputTokens: s.outputTokens || 0,
          costUsd: s.cost || 0,
          createdAt: s.date,
          updatedAt: s.date,
          durationMs: s.durationMs || 0,
          source: "codex",
          gitBranch: s.gitBranch || "",
          messageCount: s.messageCount || 0,
          toolCalls: s.toolCalls || 0,
          toolBreakdown: s.toolBreakdown || {},
          retryCount: s.retryCount || 0,
          totalEditTurns: s.totalEditTurns || 0,
          mostRetriedFile: s.mostRetriedFile ?? null,
          perToolCounts: s.perToolCounts || {},
        })),
        totalCost: codexSessions.reduce((a, s) => a + s.cost, 0),
        totalInputTokens: codexSessions.reduce((a, s) => a + s.inputTokens, 0),
        totalCachedInputTokens: codexSessions.reduce((a, s) => a + s.cacheReadTokens, 0),
        totalOutputTokens: codexSessions.reduce((a, s) => a + s.outputTokens, 0),
        toolBreakdown: {},
        totalReasoningBlocks: 0,
        totalWebSearches: 0,
        totalTasks: 0,
      }
    : null;

  // dailyActivity for Cursor "Messages per day" tile — derive from session
  // dates and messageCounts. Not cursor-native but close enough visually.
  const cursorDaily = new Map<string, { messages: number; toolCalls: number }>();
  for (const s of cursorSessions) {
    const d = s.date.slice(0, 10);
    const slot = cursorDaily.get(d) ?? { messages: 0, toolCalls: 0 };
    slot.messages += s.messageCount || 0;
    slot.toolCalls += s.toolCalls || 0;
    cursorDaily.set(d, slot);
  }
  const cursorDailyActivity = Array.from(cursorDaily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const cursorSummary = cursorSessions.length
    ? {
        sessions: cursorSessions.map((s) => ({
          sessionId: s.id,
          sessionName: s.name || s.id.slice(0, 8),
          project: s.project || "",
          mode: "",
          model: s.model || "",
          createdAt: s.date,
          messageCount: s.messageCount || 0,
          linesAdded: (s as UnifiedSession & { linesAdded?: number }).linesAdded ?? 0,
          linesRemoved: (s as UnifiedSession & { linesRemoved?: number }).linesRemoved ?? 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: s.cost || 0,
        })),
        totalCost: cursorSessions.reduce((a, s) => a + s.cost, 0),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalMessages: cursorSessions.reduce((a, s) => a + (s.messageCount || 0), 0),
        totalLinesAdded: cursorSessions.reduce(
          (a, s) => a + ((s as UnifiedSession & { linesAdded?: number }).linesAdded ?? 0),
          0,
        ),
        totalLinesRemoved: cursorSessions.reduce(
          (a, s) => a + ((s as UnifiedSession & { linesRemoved?: number }).linesRemoved ?? 0),
          0,
        ),
        totalFilesCreated: 0,
        models: {},
        toolBreakdown: {},
        totalToolCalls: 0,
        totalToolErrors: 0,
        totalTabSuggestedLines: 0,
        totalTabAcceptedLines: 0,
        totalComposerSuggestedLines: 0,
        totalComposerAcceptedLines: 0,
        dailyActivity: cursorDailyActivity,
        dailyStats: [],
      }
    : null;

  const data: LocalData = {
    // biome-ignore lint/suspicious/noExplicitAny: intentional shape match with grammata
    claude: claudeSummary as any,
    // biome-ignore lint/suspicious/noExplicitAny: intentional shape match with grammata
    codex: codexSummary as any,
    // biome-ignore lint/suspicious/noExplicitAny: intentional shape match with grammata
    cursor: cursorSummary as any,
    goose: null,
    analytics,
    sources: [
      { name: "Claude Code", key: "claude-code", sessions: 0, tokens: 0, cost: 0, activeDays: 0 },
      { name: "Codex", key: "codex", sessions: 0, tokens: 0, cost: 0, activeDays: 0 },
      {
        name: "Cursor",
        key: "cursor",
        sessions: 0,
        tokens: 0,
        cost: 0,
        activeDays: 0,
        costLabel: "subscription",
      },
      { name: "Goose", key: "goose", sessions: 0, tokens: 0, cost: 0, activeDays: 0 },
    ],
    blocks: [],
    activeBlock: null,
    peakBlockTokens: 0,
  };
  // Per-source rollup from sessionRows so Summary source chips still work.
  for (const s of analytics.sessionRows) {
    const key =
      s.source === "claude-code"
        ? "claude-code"
        : (s.source as "codex" | "cursor" | "goose");
    const bucket = data.sources.find((x) => x.key === key);
    if (!bucket) continue;
    bucket.sessions += 1;
    bucket.tokens += (s.inputTokens || 0) + (s.outputTokens || 0);
    bucket.cost += s.cost || 0;
  }
  // Active-days per source.
  for (const bucket of data.sources) {
    const days = new Set<string>();
    for (const s of analytics.sessionRows) {
      const key = s.source;
      if (key === bucket.key) days.add(s.date.slice(0, 10));
    }
    bucket.activeDays = days.size;
  }
  memoryCache = { at: Date.now(), data };
  return data;
}

export async function getLocalData(): Promise<LocalData> {
  const now = Date.now();
  if (memoryCache && now - memoryCache.at < MEMORY_TTL_MS)
    return rehydrateLive(memoryCache.data, now);

  if (USE_CH) {
    if (!inFlight) {
      inFlight = readFreshFromCh().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

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

export type WindowKey = "7d" | "30d" | "90d" | "all";

const WINDOW_DAYS: Record<Exclude<WindowKey, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * Returns a LocalData view filtered to a time window AND (optionally) a
 * single source. Rebuilds mergeAll + buildAnalytics + blocks from the
 * filtered sessions so every downstream tile reflects the window without
 * drifting. "all" + no filter returns the base (no recomputation).
 */
export async function getLocalDataWindowed(
  window: WindowKey,
  filter: SourceFilter,
): Promise<LocalData> {
  const base = await getLocalData();
  if (window === "all" && !filter) return base;

  const cutoff =
    window === "all" ? 0 : Date.now() - WINDOW_DAYS[window] * 24 * 60 * 60 * 1000;

  const afterCutoff = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= cutoff;
  };

  const claude =
    !filter || filter === "claude-code"
      ? base.claude && {
          ...base.claude,
          sessions: base.claude.sessions.filter((s) => afterCutoff(s.firstTimestamp)),
        }
      : null;
  const codex =
    !filter || filter === "codex"
      ? base.codex && {
          ...base.codex,
          sessions: base.codex.sessions.filter((s) => afterCutoff(s.createdAt)),
        }
      : null;
  const cursor =
    !filter || filter === "cursor"
      ? base.cursor && {
          ...base.cursor,
          sessions: base.cursor.sessions.filter((s) => afterCutoff(s.createdAt)),
        }
      : null;
  const goose =
    !filter || filter === "goose"
      ? base.goose && {
          ...base.goose,
          sessions: base.goose.sessions.filter((s) => afterCutoff(s.createdAt)),
        }
      : null;

  const merged = mergeAll(claude, codex, cursor, goose);
  const analytics = buildAnalytics(merged);

  const sources: SourceRollup[] = base.sources.map((s) => {
    const picked =
      s.key === "claude-code"
        ? claude
        : s.key === "codex"
          ? codex
          : s.key === "cursor"
            ? cursor
            : s.key === "goose"
              ? goose
              : null;
    if (!picked) return { ...s, sessions: 0, tokens: 0, cost: 0, activeDays: 0 };
    const sess = picked.sessions;
    const tss =
      s.key === "claude-code"
        ? sess.map((x) => (x as { firstTimestamp: string }).firstTimestamp)
        : sess.map((x) => (x as { createdAt: string }).createdAt);
    return {
      ...s,
      sessions: sess.length,
      tokens:
        s.key === "cursor"
          ? 0
          : sess.reduce(
              (acc, x) =>
                acc +
                ((x as { inputTokens?: number }).inputTokens ?? 0) +
                ((x as { outputTokens?: number }).outputTokens ?? 0),
              0,
            ),
      cost: sess.reduce((acc, x) => acc + ((x as { costUsd?: number }).costUsd ?? 0), 0),
      activeDays: activeDaysFromTimestamps(tss),
    };
  });

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
