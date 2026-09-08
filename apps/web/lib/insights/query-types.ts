// Client-safe types + URL state codec for the insight builder.
// Lives in its own file so the client bundle doesn't pull in @/lib/db.
// Server-only compiler is in lib/insights/query.ts.

export type InsightMetric =
  | "tokens_out"
  | "tokens_in"
  | "tokens_cache_read"
  | "cost_usd"
  | "sessions"
  | "wall_sec"
  | "errors"
  | "prs_merged";

export type InsightBreakdown =
  | "source"
  | "model"
  | "repo"
  | "intent_top"
  | "user"
  | "day_of_week"
  | "none";

export type InsightFilter = {
  field: "source" | "model" | "repo" | "intent_top" | "user" | "branch";
  values: string[];
};

export type InsightRange =
  | { kind: "preset"; preset: "7d" | "30d" | "90d" }
  | { kind: "absolute"; from: string; to: string };

export type InsightQuery = {
  metric: InsightMetric;
  breakdown: InsightBreakdown;
  filters: InsightFilter[];
  range: InsightRange;
  granularity: "day" | "week";
};

export type TimePoint = { t: string; series: Record<string, number> };

export type BreakdownRow = {
  key: string;
  label: string;
  total: number;
  sessions?: number;
  users?: number;
};

export type InsightResult =
  | {
      ok: true;
      series: TimePoint[];
      breakdown: BreakdownRow[];
      meta: { kAnonymous: boolean; cohortSize?: number };
    }
  | { ok: false; error: "k_anonymity"; required: number; actual: number };

/**
 * URL state: a single ?q= param holding base64-encoded JSON. The encode/decode
 * uses btoa+escape so it round-trips Unicode without choking.
 */
export function encodeQuery(q: InsightQuery): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(q))));
}

export function decodeQuery(s: string | null | undefined): InsightQuery | null {
  if (!s) return null;
  try {
    const json = decodeURIComponent(escape(atob(s)));
    const obj = JSON.parse(json);
    if (typeof obj !== "object" || obj === null) return null;
    return obj as InsightQuery;
  } catch {
    return null;
  }
}

export const DEFAULT_QUERY: InsightQuery = {
  metric: "tokens_out",
  breakdown: "source",
  filters: [],
  range: { kind: "preset", preset: "30d" },
  granularity: "day",
};
