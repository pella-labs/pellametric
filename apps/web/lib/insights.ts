// Derivations that sit on top of grammata's `AnalyticsData` for the
// `/insights` page. Each helper is a pure function over the merged
// session rows (plus block history for plan detection) — keeps the page
// file focused on layout and these calcs independently testable later.

import "server-only";

import type { AnalyticsData, UnifiedSession } from "grammata";
import type { BillingBlock } from "./blocks";

// ─── Per-model retry rate + cost share ────────────────────────────────

export interface ModelMixRow {
  model: string;
  provider: string;
  sessions: number;
  cost: number;
  costShare: number;
  inputTokens: number;
  outputTokens: number;
  retryRate: number;
  retryCost: number;
}

export function modelMix(analytics: AnalyticsData): ModelMixRow[] {
  const totalCost = analytics.modelBreakdowns.reduce((a, m) => a + m.cost, 0);
  const retryByModel = new Map<string, { retries: number; turns: number; cost: number }>();
  for (const s of analytics.sessionRows) {
    const key = s.model || "—";
    const cur = retryByModel.get(key) ?? { retries: 0, turns: 0, cost: 0 };
    cur.retries += s.retryCount ?? 0;
    cur.turns += s.totalEditTurns || s.messageCount || 0;
    const ratio = s.totalEditTurns > 0 ? Math.min(1, (s.retryCount ?? 0) / s.totalEditTurns) : 0;
    cur.cost += (s.cost ?? 0) * ratio;
    retryByModel.set(key, cur);
  }
  return analytics.modelBreakdowns
    .map((m) => {
      const r = retryByModel.get(m.model) ?? { retries: 0, turns: 0, cost: 0 };
      return {
        model: m.model,
        provider: m.provider,
        sessions: m.sessionCount,
        cost: m.cost,
        costShare: totalCost > 0 ? m.cost / totalCost : 0,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        retryRate: r.turns > 0 ? r.retries / r.turns : 0,
        retryCost: r.cost,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

// ─── Retry $ per tool ─────────────────────────────────────────────────

export interface ToolRetryCostRow {
  tool: string;
  total: number;
  firstTry: number;
  rate: number;
  cost: number;
}

export function toolRetryCost(analytics: AnalyticsData): ToolRetryCostRow[] {
  const costByTool = new Map<string, number>();
  for (const s of analytics.sessionRows) {
    if (!s.perToolCounts) continue;
    const totalTurns = s.totalEditTurns || s.messageCount || 0;
    if (totalTurns === 0 || s.cost === 0) continue;
    for (const [tool, counts] of Object.entries(s.perToolCounts)) {
      if (counts.retried <= 0) continue;
      const share = counts.retried / totalTurns;
      const attributed = s.cost * Math.min(1, share);
      costByTool.set(tool, (costByTool.get(tool) ?? 0) + attributed);
    }
  }
  return analytics.retryStats.perTool
    .map((t) => ({ ...t, cost: costByTool.get(t.tool) ?? 0 }))
    .sort((a, b) => b.cost - a.cost);
}

// ─── Week-over-week diff ──────────────────────────────────────────────

export interface WowDelta {
  label: string;
  current: number;
  previous: number;
  delta: number;
  format: "currency" | "percent" | "number";
  polarity: "up-good" | "down-good";
}

export function weekOverWeek(analytics: AnalyticsData): WowDelta[] {
  const daily = [...analytics.dailyCosts].sort((a, b) => a.date.localeCompare(b.date));
  if (daily.length === 0) return [];
  const tail = daily.slice(-14);
  const prev = tail.slice(0, 7);
  const cur = tail.slice(7);
  const sum = <T>(arr: T[], pick: (x: T) => number): number => arr.reduce((a, b) => a + pick(b), 0);
  const curCost = sum(cur, (d) => d.cost);
  const prevCost = sum(prev, (d) => d.cost);

  const curStart = cur[0]?.date ?? "";
  const prevStart = prev[0]?.date ?? "";
  const curEnd = cur[cur.length - 1]?.date ?? "";
  const prevEnd = prev[prev.length - 1]?.date ?? "";
  const firstTryForRange = (from: string, to: string): number => {
    let retries = 0;
    let turns = 0;
    for (const s of analytics.sessionRows) {
      const d = (s.date ?? "").slice(0, 10);
      if (!d || d < from || d > to) continue;
      retries += s.retryCount ?? 0;
      turns += s.totalEditTurns || s.messageCount || 0;
    }
    return turns > 0 ? 1 - retries / turns : 0;
  };
  const opusShareForRange = (from: string, to: string): number => {
    let opus = 0;
    let total = 0;
    for (const s of analytics.sessionRows) {
      const d = (s.date ?? "").slice(0, 10);
      if (!d || d < from || d > to) continue;
      total += s.cost ?? 0;
      if ((s.model ?? "").toLowerCase().includes("opus")) opus += s.cost ?? 0;
    }
    return total > 0 ? opus / total : 0;
  };
  const cacheSavedForRange = (from: string, to: string): number => {
    let saved = 0;
    for (const s of analytics.sessionRows) {
      const d = (s.date ?? "").slice(0, 10);
      if (!d || d < from || d > to) continue;
      saved += ((s.cacheReadTokens ?? 0) / 1_000_000) * 2.7;
    }
    return saved;
  };
  return [
    {
      label: "Spend",
      current: curCost,
      previous: prevCost,
      delta: prevCost > 0 ? (curCost - prevCost) / prevCost : 0,
      format: "currency",
      polarity: "down-good",
    },
    {
      label: "First-try rate",
      current: firstTryForRange(curStart, curEnd),
      previous: firstTryForRange(prevStart, prevEnd),
      delta: firstTryForRange(curStart, curEnd) - firstTryForRange(prevStart, prevEnd),
      format: "percent",
      polarity: "up-good",
    },
    {
      label: "Cache saved (est.)",
      current: cacheSavedForRange(curStart, curEnd),
      previous: cacheSavedForRange(prevStart, prevEnd),
      delta:
        cacheSavedForRange(prevStart, prevEnd) > 0
          ? (cacheSavedForRange(curStart, curEnd) - cacheSavedForRange(prevStart, prevEnd)) /
            cacheSavedForRange(prevStart, prevEnd)
          : 0,
      format: "currency",
      polarity: "up-good",
    },
    {
      label: "Opus share",
      current: opusShareForRange(curStart, curEnd),
      previous: opusShareForRange(prevStart, prevEnd),
      delta: opusShareForRange(curStart, curEnd) - opusShareForRange(prevStart, prevEnd),
      format: "percent",
      polarity: "down-good",
    },
  ];
}

// ─── Hour × day-of-week heatmap ───────────────────────────────────────

export interface HeatmapCell {
  dow: number;
  hour: number;
  sessions: number;
  cost: number;
}

export function hourDowHeatmap(sessions: UnifiedSession[]): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) cells.push({ dow: d, hour: h, sessions: 0, cost: 0 });
  }
  const idx = (d: number, h: number) => d * 24 + h;
  for (const s of sessions) {
    if (!s.date) continue;
    const t = new Date(s.date);
    if (Number.isNaN(t.getTime())) continue;
    const cell = cells[idx(t.getDay(), t.getHours())];
    if (!cell) continue;
    cell.sessions += 1;
    cell.cost += s.cost ?? 0;
  }
  return cells;
}

// ─── Plan-tier detection (P90 of block tokens) ────────────────────────

export interface PlanDetection {
  tier: "Pro" | "Max5" | "Max20" | "Unknown";
  p90Tokens: number;
  confidence: number;
  sampleSize: number;
}

export function detectPlan(blocks: BillingBlock[]): PlanDetection {
  const tokenTotals = blocks
    .filter((b) => !b.isGap && b.entryCount > 0)
    .map((b) => b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheCreateTokens)
    .sort((a, b) => a - b);
  const n = tokenTotals.length;
  if (n === 0) {
    return { tier: "Unknown", p90Tokens: 0, confidence: 0, sampleSize: 0 };
  }
  const idx = Math.floor(n * 0.9);
  const p90 = tokenTotals[Math.min(idx, n - 1)] ?? 0;
  const tier: PlanDetection["tier"] =
    p90 <= 19_000 ? "Pro" : p90 <= 88_000 ? "Max5" : p90 <= 220_000 ? "Max20" : "Max20";
  const confidence = Math.min(1, Math.sqrt(n / 30));
  return { tier, p90Tokens: p90, confidence, sampleSize: n };
}

// ─── Per-file retry leaderboard ───────────────────────────────────────

export interface FileRetryRow {
  file: string;
  worstInSessions: number;
  estRetryCost: number;
}

export function fileRetryLeaderboard(sessions: UnifiedSession[]): FileRetryRow[] {
  const map = new Map<string, FileRetryRow>();
  for (const s of sessions) {
    if (!s.mostRetriedFile) continue;
    const turns = s.totalEditTurns || s.messageCount || 0;
    if (turns === 0) continue;
    const ratio = Math.min(1, (s.retryCount ?? 0) / turns);
    const attributed = (s.cost ?? 0) * ratio;
    const cur = map.get(s.mostRetriedFile) ?? {
      file: s.mostRetriedFile,
      worstInSessions: 0,
      estRetryCost: 0,
    };
    cur.worstInSessions += 1;
    cur.estRetryCost += attributed;
    map.set(s.mostRetriedFile, cur);
  }
  return [...map.values()].sort((a, b) => b.estRetryCost - a.estRetryCost);
}

// ─── Anomaly / spike detection ────────────────────────────────────────

export interface AnomalyRow {
  date: string;
  cost: number;
  dowBaseline: number;
  stddev: number;
  zScore: number;
  topSession: { id: string; source: string; project: string; cost: number } | null;
}

export function detectAnomalies(analytics: AnalyticsData): AnomalyRow[] {
  const daily = [...analytics.dailyCosts].sort((a, b) => a.date.localeCompare(b.date));
  if (daily.length < 14) return [];

  const byDow: number[][] = Array.from({ length: 7 }, () => []);
  const dowOf = (iso: string) => new Date(iso).getDay();
  for (const d of daily) byDow[dowOf(d.date)]?.push(d.cost);
  const stats = byDow.map((arr) => {
    const n = arr.length;
    const mean = n > 0 ? arr.reduce((a, b) => a + b, 0) / n : 0;
    const variance = n > 1 ? arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
    return { mean, stddev: Math.sqrt(variance), n };
  });

  const topByDate = new Map<
    string,
    { id: string; source: string; project: string; cost: number }
  >();
  for (const s of analytics.sessionRows) {
    const d = (s.date ?? "").slice(0, 10);
    if (!d) continue;
    const cur = topByDate.get(d);
    if (!cur || (s.cost ?? 0) > cur.cost) {
      topByDate.set(d, {
        id: s.id,
        source: s.source,
        project: s.project ?? "",
        cost: s.cost ?? 0,
      });
    }
  }

  const out: AnomalyRow[] = [];
  for (const d of daily) {
    const bucket = stats[dowOf(d.date)];
    if (!bucket || bucket.n < 3 || bucket.stddev === 0) continue;
    const z = (d.cost - bucket.mean) / bucket.stddev;
    if (z >= 2) {
      out.push({
        date: d.date,
        cost: d.cost,
        dowBaseline: bucket.mean,
        stddev: bucket.stddev,
        zScore: z,
        topSession: topByDate.get(d.date) ?? null,
      });
    }
  }
  return out.sort((a, b) => b.zScore - a.zScore).slice(0, 10);
}
