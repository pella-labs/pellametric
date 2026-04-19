import { assertRole, type Ctx } from "../../auth";
import { useFixtures } from "../../env";
import type { CohortFiltersOutput } from "../../schemas/new-dashboard";

export async function cohortFilters(ctx: Ctx): Promise<CohortFiltersOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);
  if (useFixtures()) {
    return {
      repos: [
        { id: "r1", full_name: "pella-labs/bematist" },
        { id: "r2", full_name: "pella-labs/pharos" },
      ],
      teammates: [
        { engineer_hash: "aaaaaaaa", display_name: null },
        { engineer_hash: "bbbbbbbb", display_name: null },
        { engineer_hash: "cccccccc", display_name: null },
      ],
      tools: [{ tool_name: "Bash" }, { tool_name: "Read" }, { tool_name: "Edit" }],
      models: [{ model: "claude-sonnet-4-6" }, { model: "claude-opus-4-7" }],
    };
  }

  const repos = await ctx.db.pg
    .query<{ id: string; full_name: string }>(
      `SELECT id::text AS id, full_name
         FROM repos
        WHERE org_id = $1
          AND deleted_at IS NULL
          AND full_name IS NOT NULL
        ORDER BY full_name ASC
        LIMIT 200`,
      [ctx.tenant_id],
    )
    .catch(() => []);

  const teammatesRows = await ctx.db.ch
    .query<{ engineer_id_hash: string }>(
      `SELECT substring(lower(hex(cityHash64(engineer_id))), 1, 8) AS engineer_id_hash
         FROM events
        WHERE org_id = {tid:String}
          AND ts >= now() - toIntervalDay(90)
          AND engineer_id != ''
        GROUP BY engineer_id
        ORDER BY count() DESC
        LIMIT 100`,
      { tid: ctx.tenant_id },
    )
    .catch(() => []);

  const tools = await ctx.db.ch
    .query<{ tool_name: string }>(
      `SELECT tool_name
         FROM events
        WHERE org_id = {tid:String}
          AND ts >= now() - toIntervalDay(90)
          AND tool_name != ''
        GROUP BY tool_name
        ORDER BY count() DESC
        LIMIT 50`,
      { tid: ctx.tenant_id },
    )
    .catch(() => []);

  const models = await ctx.db.ch
    .query<{ model: string }>(
      `SELECT coalesce(
                nullIf(gen_ai_response_model, ''),
                nullIf(gen_ai_request_model, '')
              ) AS model
         FROM events
        WHERE org_id = {tid:String}
          AND ts >= now() - toIntervalDay(90)
          AND (gen_ai_response_model != '' OR gen_ai_request_model != '')
        GROUP BY model
        ORDER BY count() DESC
        LIMIT 30`,
      { tid: ctx.tenant_id },
    )
    .catch(() => []);

  return {
    repos: repos.map((r) => ({ id: r.id, full_name: r.full_name })),
    teammates: teammatesRows.map((t) => ({ engineer_hash: t.engineer_id_hash })),
    tools: tools.filter((t) => t.tool_name).map((t) => ({ tool_name: t.tool_name })),
    models: models.filter((m) => m.model).map((m) => ({ model: m.model })),
  };
}
