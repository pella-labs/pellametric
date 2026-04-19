// Waste estimation from grammata session-level data. Every signal here is a
// PROXY — we don't have per-turn outcome attribution yet. What we do have:
//
//   - per-session retryCount / totalEditTurns (Claude, Codex) → fraction of
//     edit turns that had to be reverted or redone.
//   - analytics.retryStats.retryCostUsd → grammata's global retry cost
//     (computed the same way but aggregated).
//
// We treat `retryRatio × sessionCost` as "estimated retry waste" and the
// remainder as "estimated productive spend". This is imperfect (a session
// that retried once on a cheap turn doesn't linearly waste 50% of the whole
// session's cost), but it's directionally correct and honest: we cap the
// ratio at 1.0 and label the tiles "estimated" in the UI.

import "server-only";

import type { ClaudeSummary, CodexSummary } from "grammata";

export interface WasteDay {
  date: string; // YYYY-MM-DD
  productive: number;
  retryWaste: number;
  total: number;
}

export interface WasteSessionRow {
  source: "claude-code" | "codex";
  id: string;
  project: string;
  model: string;
  date: string;
  cost: number;
  retryCount: number;
  totalEditTurns: number;
  estimatedWaste: number;
  wasteRate: number;
  durationMs: number;
  /** One-line context. For Claude this is `sessionName` (first queue-operation
   *  text, up to 80 chars); for Codex the `firstMessage`. Rendered as the
   *  primary clickable label in outcomes tables — the whole point is
   *  "what did I actually do in this session" since the row numbers alone
   *  don't tell you that. Safe to surface on local/self-view (Tier C for own
   *  data). */
  summary: string;
  gitBranch: string;
  /** Name of the most-used tool in this session (e.g. "Edit", "Read"). */
  topTool: string;
}

export interface WasteProjectRow {
  project: string;
  sources: ("claude-code" | "codex")[];
  cost: number;
  estimatedWaste: number;
  wasteRate: number;
  sessions: number;
  /** Sum of session durationMs across all sessions in this project.
   *  Used for the "productive time" column on the Productive side of the
   *  2×2 grid — it's *total* time, not productive-only, because we don't
   *  have per-turn timing. The productive vs. waste split uses cost, not
   *  time; this column is an honest "how much clock-time did the project
   *  eat" signal. */
  durationMs: number;
}

export interface WasteSummary {
  daily: WasteDay[];
  sessions: WasteSessionRow[];
  projects: WasteProjectRow[];
  totalCost: number;
  totalWaste: number;
  /** 0..1 — share of total spend estimated to be retry waste. */
  wasteRate: number;
  /** From grammata.analytics.retryStats — authoritative global retry cost.
   *  Reported separately so users can see both our per-session estimate and
   *  grammata's aggregate — they should agree within a few %. */
  grammataRetryCostUsd: number;
}

/**
 * Pick the most-used tool name from a grammata toolBreakdown map. Returns ""
 * when no tools were used (e.g. a pure-chat session). Ties broken by first
 * entry in the map — good enough for a single-tag "what kind of work" signal.
 */
function topToolName(breakdown: Record<string, number> | undefined): string {
  if (!breakdown) return "";
  let best = "";
  let bestCount = 0;
  for (const [name, count] of Object.entries(breakdown)) {
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }
  return best;
}

/**
 * Per-session retry ratio. Uses totalEditTurns as the denominator because
 * that's what grammata counts retries against (only edit-bearing turns can
 * be "retried"). If totalEditTurns is 0 we fall back to turnCount so short
 * prompt sessions that hit one error don't disappear from the view.
 */
function retryRatio(retryCount: number, editTurns: number, turnCount: number): number {
  const denom = editTurns > 0 ? editTurns : turnCount > 0 ? turnCount : 1;
  if (retryCount <= 0) return 0;
  return Math.min(1, retryCount / denom);
}

export function buildWasteSummary(
  claude: ClaudeSummary | null,
  codex: CodexSummary | null,
  grammataRetryCostUsd: number,
): WasteSummary {
  const sessions: WasteSessionRow[] = [];
  const dailyMap = new Map<string, WasteDay>();
  const projectMap = new Map<string, WasteProjectRow>();

  let totalCost = 0;
  let totalWaste = 0;

  function touchDay(dateIso: string, cost: number, waste: number): void {
    const date = dateIso.slice(0, 10);
    const cur = dailyMap.get(date) ?? { date, productive: 0, retryWaste: 0, total: 0 };
    cur.total += cost;
    cur.retryWaste += waste;
    cur.productive = Math.max(0, cur.total - cur.retryWaste);
    dailyMap.set(date, cur);
  }

  function touchProject(
    project: string,
    source: "claude-code" | "codex",
    cost: number,
    waste: number,
    durationMs: number,
  ): void {
    if (!project) return;
    const cur = projectMap.get(project) ?? {
      project,
      sources: [],
      cost: 0,
      estimatedWaste: 0,
      wasteRate: 0,
      sessions: 0,
      durationMs: 0,
    };
    cur.cost += cost;
    cur.estimatedWaste += waste;
    cur.sessions += 1;
    cur.durationMs += durationMs;
    if (!cur.sources.includes(source)) cur.sources.push(source);
    cur.wasteRate = cur.cost > 0 ? cur.estimatedWaste / cur.cost : 0;
    projectMap.set(project, cur);
  }

  if (claude) {
    for (const s of claude.sessions) {
      const ratio = retryRatio(s.retryCount, s.totalEditTurns, s.turnCount);
      const waste = s.costUsd * ratio;
      totalCost += s.costUsd;
      totalWaste += waste;
      const date = (s.firstTimestamp ?? "").slice(0, 10) || "unknown";
      sessions.push({
        source: "claude-code",
        id: s.sessionId,
        project: s.project,
        model: s.model,
        date,
        cost: s.costUsd,
        retryCount: s.retryCount,
        totalEditTurns: s.totalEditTurns,
        estimatedWaste: waste,
        wasteRate: ratio,
        durationMs: s.durationMs ?? 0,
        summary: s.sessionName ?? "",
        gitBranch: s.gitBranch ?? "",
        topTool: topToolName(s.toolBreakdown),
      });
      touchDay(s.firstTimestamp ?? "", s.costUsd, waste);
      touchProject(s.project, "claude-code", s.costUsd, waste, s.durationMs ?? 0);
    }
  }

  if (codex) {
    for (const s of codex.sessions) {
      // Codex messageCount ≈ turn equivalent; totalActions as edit-turn proxy.
      const editProxy = s.totalActions > 0 ? s.totalActions : s.messageCount;
      const ratio = retryRatio(s.retryCount, editProxy, s.messageCount);
      const waste = s.costUsd * ratio;
      totalCost += s.costUsd;
      totalWaste += waste;
      const date = (s.createdAt ?? "").slice(0, 10) || "unknown";
      sessions.push({
        source: "codex",
        id: s.sessionId,
        project: s.project,
        model: s.model,
        date,
        cost: s.costUsd,
        retryCount: s.retryCount,
        totalEditTurns: editProxy,
        estimatedWaste: waste,
        wasteRate: ratio,
        durationMs: s.durationMs ?? 0,
        summary: s.firstMessage ?? s.sessionName ?? "",
        gitBranch: s.gitBranch ?? "",
        topTool: topToolName(s.toolBreakdown),
      });
      touchDay(s.createdAt ?? "", s.costUsd, waste);
      touchProject(s.project, "codex", s.costUsd, waste, s.durationMs ?? 0);
    }
  }

  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const projects = [...projectMap.values()].sort((a, b) => b.estimatedWaste - a.estimatedWaste);
  sessions.sort((a, b) => b.estimatedWaste - a.estimatedWaste);

  return {
    daily,
    sessions,
    projects,
    totalCost,
    totalWaste,
    wasteRate: totalCost > 0 ? totalWaste / totalCost : 0,
    grammataRetryCostUsd,
  };
}
