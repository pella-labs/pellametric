import type { schemas } from "@bematist/api";

export type Filter = schemas.DashboardFilter;

/**
 * Parse Next.js searchParams into a DashboardFilter.
 * Unknown values collapse to sensible defaults so pasted URLs never 400.
 *
 * `selfEngineerId` is the resolved CH `engineer_id` (= `developers.id`) for
 * the caller — NOT the Better Auth `actor_id`. The two are different ids for
 * the same person, and ingest writes events keyed on `developers.id`. Passing
 * the wrong one is the bug that made "Just me" return zero rows.
 */
export function parseFilterFromSearchParams(
  params: Record<string, string | string[] | undefined>,
  selfEngineerId: string,
): Filter {
  const get = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const multi = (k: string): string[] | undefined => {
    const v = params[k];
    if (!v) return undefined;
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === "string" && v.length > 0) return v.split(",").filter(Boolean);
    return undefined;
  };

  const winRaw = get("window");
  const window: Filter["window"] = winRaw === "7d" || winRaw === "90d" ? winRaw : "30d";

  let engineer_ids = multi("eng");
  if (get("justMe") === "1") {
    engineer_ids = [selfEngineerId];
  }

  return {
    window,
    repo_ids: multi("repo"),
    engineer_ids,
    tool: get("tool"),
    model: get("model"),
  };
}

/**
 * Build a path for a filter mutation — callers use this to produce
 * <Link href=... /> targets that preserve the rest of the filter bar state.
 */
export function buildHref(
  base: Filter,
  patch: Partial<Filter & { justMe?: boolean | null }>,
): string {
  const out = new URLSearchParams();
  const merged: Filter & { justMe?: boolean | null } = {
    ...base,
    ...(patch as Filter),
  };
  if (merged.window && merged.window !== "30d") out.set("window", merged.window);
  if (merged.repo_ids && merged.repo_ids.length > 0) out.set("repo", merged.repo_ids.join(","));
  if (merged.engineer_ids && merged.engineer_ids.length > 0) {
    out.set("eng", merged.engineer_ids.join(","));
  }
  if ((patch as { justMe?: boolean | null }).justMe) out.set("justMe", "1");
  if (merged.tool) out.set("tool", merged.tool);
  if (merged.model) out.set("model", merged.model);
  const qs = out.toString();
  return qs ? `/new-dashboard?${qs}` : "/new-dashboard";
}
