// CH → AnalyticsData. Queries the `events` table for a viewer's rows,
// reconstructs UnifiedSession[], and runs grammata's buildAnalytics so
// every existing page aggregator keeps working unchanged.

import "server-only";

import { createClient } from "@clickhouse/client";
import type { MergedUsage, UnifiedSession } from "grammata";
import { buildAnalytics } from "grammata";
import type { AnalyticsData } from "grammata";

const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";

interface SessionRow {
  session_id: string;
  ts_iso: string;
  source: string;
  source_version: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_create: number;
  duration_ms: number;
  provider: string;
  model: string;
  branch: string | null;
  raw_attrs: string;
  errs: number;
  oks: number;
}

function parseRawAttrs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function readAnalyticsForEngineer(
  orgId: string,
  engineerId: string,
): Promise<{ analytics: AnalyticsData; sessionCount: number }> {
  const ch = createClient({
    url: CH_URL,
    database: CH_DATABASE,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  try {
    const rs = await ch.query({
      query: `
        SELECT
          session_id,
          toString(min(ts))                                      AS ts_iso,
          any(source)                                            AS source,
          any(source_version)                                    AS source_version,
          sumIf(cost_usd, event_kind = 'llm_response')           AS cost_usd,
          sumIf(input_tokens, event_kind = 'llm_response')       AS input_tokens,
          sumIf(output_tokens, event_kind = 'llm_response')      AS output_tokens,
          sumIf(cache_read_input_tokens, event_kind = 'llm_response')     AS cache_read,
          sumIf(cache_creation_input_tokens, event_kind = 'llm_response') AS cache_create,
          toUInt32(toUnixTimestamp64Milli(max(ts)) - toUnixTimestamp64Milli(min(ts))) AS duration_ms,
          anyIf(gen_ai_system, gen_ai_system != '')              AS provider,
          anyIf(gen_ai_response_model, gen_ai_response_model != '') AS model,
          anyIf(branch, branch IS NOT NULL AND branch != '')     AS branch,
          anyIf(raw_attrs, raw_attrs != '' AND raw_attrs != '{}') AS raw_attrs,
          countIf(event_kind = 'tool_result' AND tool_status = 'error') AS errs,
          countIf(event_kind = 'tool_result' AND tool_status = 'ok')    AS oks
        FROM events
        WHERE org_id = {orgId:String}
          AND engineer_id = {engineerId:String}
        GROUP BY session_id
        ORDER BY min(ts)
      `,
      query_params: { orgId, engineerId },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as SessionRow[];
    await ch.close();

    const sessions: UnifiedSession[] = rows.map((r) => {
      const attrs = parseRawAttrs(r.raw_attrs);
      const inputTokens = Number(r.input_tokens) || 0;
      const outputTokens = Number(r.output_tokens) || 0;
      const cacheRead = Number(r.cache_read) || 0;
      const cacheCreate = Number(r.cache_create) || 0;
      const errs = Number(r.errs) || 0;
      const oks = Number(r.oks) || 0;
      const d = new Date(r.ts_iso.replace(" ", "T") + "Z");
      return {
        id: r.session_id,
        name: (attrs.name as string) || r.session_id.slice(0, 8),
        project: (attrs.project as string) || "",
        date: d.toISOString(),
        durationMs: Number(r.duration_ms) || 0,
        model: r.model || "",
        source: (r.source as UnifiedSession["source"]) || "claude",
        provider: r.provider || "",
        inputTokens,
        outputTokens,
        totalTokens:
          (attrs.totalTokens as number) || inputTokens + outputTokens + cacheRead + cacheCreate,
        cost: Number(r.cost_usd) || 0,
        messageCount: (attrs.messageCount as number) || 0,
        toolCalls: errs + oks,
        cacheReadTokens: cacheRead,
        cacheCreateTokens: cacheCreate,
        toolBreakdown: (attrs.toolBreakdown as Record<string, number>) || {},
        startHour: (attrs.startHour as number) || d.getUTCHours(),
        gitBranch: r.branch || "",
        prLinks: (attrs.prLinks as string[]) || [],
        version: r.source_version || "",
        entrypoint: (attrs.entrypoint as string) || "",
        retryCount: (attrs.retryCount as number) || errs,
        totalEditTurns: (attrs.totalEditTurns as number) || errs + oks,
        mostRetriedFile: (attrs.mostRetriedFile as string | null) ?? null,
        perToolCounts:
          (attrs.perToolCounts as Record<string, { total: number; retried: number }>) || {},
        // Extras tunneled via raw_attrs for Cursor page tiles.
        linesAdded: (attrs.linesAdded as number) || 0,
        linesRemoved: (attrs.linesRemoved as number) || 0,
      } as UnifiedSession & { linesAdded: number; linesRemoved: number };
    });

    // Reconstruct a minimal MergedUsage that buildAnalytics consumes.
    const merged: MergedUsage = {
      sessions,
      totalCost: sessions.reduce((a, s) => a + s.cost, 0),
      totalInputTokens: sessions.reduce((a, s) => a + s.inputTokens, 0),
      totalOutputTokens: sessions.reduce((a, s) => a + s.outputTokens, 0),
      cacheSavingsUsd: 0,
      totalCacheReadTokens: sessions.reduce((a, s) => a + s.cacheReadTokens, 0),
      toolBreakdown: {},
      hourDistribution: new Array(24).fill(0),
      sourceStats: {} as MergedUsage["sourceStats"],
      providerStats: {},
    };

    return { analytics: buildAnalytics(merged), sessionCount: sessions.length };
  } catch (e) {
    await ch.close().catch(() => undefined);
    console.error("[ch-analytics] query failed:", e);
    throw e;
  }
}
