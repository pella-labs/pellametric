import { z } from "zod";
import { Window } from "./common";

// ---- Filter bar -----------------------------------------------------------

export const DashboardFilter = z.object({
  window: Window.default("30d"),
  repo_ids: z.array(z.string()).optional(),
  engineer_ids: z.array(z.string()).optional(),
  tool: z.string().optional(),
  model: z.string().optional(),
});
export type DashboardFilter = z.infer<typeof DashboardFilter>;

// ---- Section 1: Activity --------------------------------------------------

export const ActivityKpis = z.object({
  sessions: z.number().int().nonnegative(),
  spend_usd: z.number().nonnegative(),
  input_tokens: z.number().nonnegative(),
  output_tokens: z.number().nonnegative(),
  cache_read_tokens: z.number().nonnegative(),
  active_days: z.number().int().nonnegative(),
  avg_session_cost: z.number().nonnegative(),
});
export type ActivityKpis = z.infer<typeof ActivityKpis>;

export const ActivityDailyPoint = z.object({
  day: z.string(),
  sessions: z.number().int().nonnegative(),
  spend_usd: z.number().nonnegative(),
});
export type ActivityDailyPoint = z.infer<typeof ActivityDailyPoint>;

export const ActivityHeatmapCell = z.object({
  dow: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  sessions: z.number().int().nonnegative(),
});
export type ActivityHeatmapCell = z.infer<typeof ActivityHeatmapCell>;

export const TopTool = z.object({
  tool_name: z.string(),
  calls: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});
export type TopTool = z.infer<typeof TopTool>;

export const TopModel = z.object({
  model: z.string(),
  sessions: z.number().int().nonnegative(),
  spend_usd: z.number().nonnegative(),
});
export type TopModel = z.infer<typeof TopModel>;

export const ActivityOverviewInput = DashboardFilter;
export type ActivityOverviewInput = z.infer<typeof ActivityOverviewInput>;

export const ActivityOverviewOutput = z.object({
  kpis: ActivityKpis,
  daily: z.array(ActivityDailyPoint),
  heatmap: z.array(ActivityHeatmapCell),
  top_tools: z.array(TopTool),
  top_models: z.array(TopModel),
  updated_at: z.string(),
});
export type ActivityOverviewOutput = z.infer<typeof ActivityOverviewOutput>;

// ---- Section 2: Code delivery --------------------------------------------

export const PrKpis = z.object({
  opened: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  open_now: z.number().int().nonnegative(),
  first_try_pct: z.number().nullable(),
  revert_pct: z.number().nullable(),
});
export type PrKpis = z.infer<typeof PrKpis>;

export const MergeLatency = z.object({
  median_hours: z.number().nullable(),
  p50: z.number().nullable(),
  p90: z.number().nullable(),
  p99: z.number().nullable(),
});
export type MergeLatency = z.infer<typeof MergeLatency>;

export const WeeklyThroughputPoint = z.object({
  week: z.string(),
  opened: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
});
export type WeeklyThroughputPoint = z.infer<typeof WeeklyThroughputPoint>;

export const SizeDistribution = z.object({
  xs: z.number().int().nonnegative(),
  s: z.number().int().nonnegative(),
  m: z.number().int().nonnegative(),
  l: z.number().int().nonnegative(),
  xl: z.number().int().nonnegative(),
});
export type SizeDistribution = z.infer<typeof SizeDistribution>;

export const PrByRepo = z.object({
  full_name: z.string(),
  opened: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  open_now: z.number().int().nonnegative(),
  median_ttm_hours: z.number().nullable(),
});
export type PrByRepo = z.infer<typeof PrByRepo>;

export const PrByAuthor = z.object({
  author_hash: z.string(),
  display_name: z.string().nullable().optional(),
  opened: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  revert_count: z.number().int().nonnegative(),
});
export type PrByAuthor = z.infer<typeof PrByAuthor>;

export const PrListItem = z.object({
  full_name: z.string(),
  pr_number: z.number().int(),
  state: z.enum(["open", "closed", "merged"]),
  opened_at: z.string(),
  merged_at: z.string().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changed_files: z.number().int().nonnegative(),
  author_hash: z.string(),
  head_ref: z.string(),
  base_ref: z.string(),
});
export type PrListItem = z.infer<typeof PrListItem>;

export const CodeDeliveryInput = DashboardFilter;
export type CodeDeliveryInput = z.infer<typeof CodeDeliveryInput>;

export const CodeDeliveryOutput = z.object({
  pr_kpis: PrKpis,
  merge_latency: MergeLatency,
  weekly_throughput: z.array(WeeklyThroughputPoint),
  size_distribution: SizeDistribution,
  pr_by_repo: z.array(PrByRepo),
  pr_by_author: z.array(PrByAuthor),
  commits_without_pr: z.number().int().nonnegative(),
  recent_prs: z.array(PrListItem),
  cost_per_merged_pr: z.number().nullable(),
  cohort_gated: z.boolean(),
  updated_at: z.string(),
});
export type CodeDeliveryOutput = z.infer<typeof CodeDeliveryOutput>;

// ---- Section 3: Sessions feed --------------------------------------------

export const SessionsFeedRow = z.object({
  session_id: z.string(),
  source: z.string(),
  started_at: z.string(),
  duration_minutes: z.number().nullable(),
  engineer_id_hash: z.string(),
  display_name: z.string().nullable().optional(),
  branch: z.string().nullable(),
  repo_full_name: z.string().nullable(),
  linked_pr_numbers: z.array(z.number().int()),
  spend_usd: z.number().nonnegative(),
  tokens_in: z.number().nonnegative(),
  tokens_out: z.number().nonnegative(),
  tool_calls: z.number().int().nonnegative(),
  tool_errors: z.number().int().nonnegative(),
  model: z.string().nullable(),
});
export type SessionsFeedRow = z.infer<typeof SessionsFeedRow>;

export const SessionsFeedInput = DashboardFilter.extend({
  cursor: z.string().nullable().optional(),
  page_size: z.number().int().positive().max(500).default(50),
});
export type SessionsFeedInput = z.infer<typeof SessionsFeedInput>;

export const SessionsFeedOutput = z.object({
  page_info: z.object({
    cursor: z.string().nullable(),
    has_more: z.boolean(),
    total_approx: z.number().int().nonnegative(),
  }),
  rows: z.array(SessionsFeedRow),
});
export type SessionsFeedOutput = z.infer<typeof SessionsFeedOutput>;

// ---- Session detail -------------------------------------------------------

export const SessionTimelineEvent = z.object({
  ts: z.string(),
  event_kind: z.string(),
  tool_name: z.string().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  cost_usd: z.number().nonnegative().nullable().optional(),
});
export type SessionTimelineEvent = z.infer<typeof SessionTimelineEvent>;

export const SessionLinkedPr = z.object({
  repo: z.string(),
  pr_number: z.number().int(),
  title_hash: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  merged_at: z.string().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type SessionLinkedPr = z.infer<typeof SessionLinkedPr>;

export const SessionToolBreakdown = z.object({
  tool_name: z.string(),
  calls: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  total_ms: z.number().int().nonnegative(),
});
export type SessionToolBreakdown = z.infer<typeof SessionToolBreakdown>;

export const SessionDetailInput = z.object({ session_id: z.string() });
export type SessionDetailInput = z.infer<typeof SessionDetailInput>;

export const SessionDetailOutput = z.object({
  header: z.object({
    session_id: z.string(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
    engineer_id_hash: z.string(),
    display_name: z.string().nullable().optional(),
    repo_full_name: z.string().nullable(),
    branch: z.string().nullable(),
    model: z.string().nullable(),
    spend_usd: z.number().nonnegative(),
    total_events: z.number().int().nonnegative(),
  }),
  timeline: z.array(SessionTimelineEvent),
  timeline_truncated: z.boolean(),
  linked_prs: z.array(SessionLinkedPr),
  tool_breakdown: z.array(SessionToolBreakdown),
});
export type SessionDetailOutput = z.infer<typeof SessionDetailOutput>;

// ---- Cohort filters -------------------------------------------------------

export const CohortFiltersOutput = z.object({
  repos: z.array(z.object({ id: z.string(), full_name: z.string() })),
  teammates: z.array(
    z.object({
      engineer_hash: z.string(),
      display_name: z.string().nullable().optional(),
    }),
  ),
  tools: z.array(z.object({ tool_name: z.string() })),
  models: z.array(z.object({ model: z.string() })),
});
export type CohortFiltersOutput = z.infer<typeof CohortFiltersOutput>;
