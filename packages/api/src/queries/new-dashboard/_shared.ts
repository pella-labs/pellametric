import type { DashboardFilter } from "../../schemas/new-dashboard";

export const WINDOW_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * Build the shared WHERE clauses + named params for a ClickHouse `events`
 * filter based on the dashboard's filter bar inputs. Repo filter is dropped
 * when empty rather than 1=0'd so we never silently zero-out a tile.
 */
export function buildCommonClauses(
  tenant_id: string,
  days: number,
  filter: DashboardFilter,
): { clauses: string[]; params: Record<string, unknown> } {
  const clauses = [
    "org_id = {tenant_id:String}",
    "ts >= now() - toIntervalDay({days:UInt16})",
  ];
  const params: Record<string, unknown> = { tenant_id, days };

  if (filter.engineer_ids && filter.engineer_ids.length > 0) {
    clauses.push("engineer_id IN {engineer_ids:Array(String)}");
    params.engineer_ids = filter.engineer_ids;
  }
  if (filter.repo_ids && filter.repo_ids.length > 0) {
    clauses.push("repo_id_hash IN {repo_ids:Array(String)}");
    params.repo_ids = filter.repo_ids;
  }
  if (filter.tool) {
    clauses.push("tool_name = {tool:String}");
    params.tool = filter.tool;
  }
  if (filter.model) {
    clauses.push(
      "(gen_ai_response_model = {model:String} OR gen_ai_request_model = {model:String})",
    );
    params.model = filter.model;
  }

  return { clauses, params };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededRand(seed: number, n: number): number {
  const x = Math.sin(seed + n * 17.13) * 10000;
  return x - Math.floor(x);
}

export function hash8(s: string): string {
  return seedFromString(s).toString(16).padStart(8, "0").slice(0, 8);
}
