import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import type { AuditEvent, MyViewHistoryInput, MyViewHistoryOutput } from "../schemas/audit";

/**
 * Return the list of manager drills into the caller's surfaces within the
 * requested window. Backs the `/me/digest` page.
 *
 * Engineers can always view their own history. Admins/auditors can view
 * anyone's, but this query is narrowed to the caller (the `/engineer/:id`
 * history for other roles is a separate query).
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads the `audit_events` Postgres table filtered by
 *     (`tenant_id`, `target_engineer_id = actor_id`).
 *   - Otherwise (default) returns an empty history — realistic M1 state.
 */
export async function getMyViewHistory(
  ctx: Ctx,
  input: MyViewHistoryInput,
): Promise<MyViewHistoryOutput> {
  assertRole(ctx, ["engineer", "admin", "auditor"]);
  if (useFixtures()) return getMyViewHistoryFixture(ctx, input);
  return getMyViewHistoryReal(ctx, input);
}

async function getMyViewHistoryFixture(
  _ctx: Ctx,
  input: MyViewHistoryInput,
): Promise<MyViewHistoryOutput> {
  return {
    window: input.window,
    events: [],
    notification_pref: "daily_digest",
  };
}

/**
 * Real-branch Postgres read. Filters by (`tenant_id`, `target_engineer_id`);
 * RLS on `audit_events` prevents cross-tenant access even if a caller forges
 * the id. Window clamps `ts` via interval arithmetic server-side.
 *
 * EXPLAIN: composite btree on (`org_id`, `target_engineer_id`, `ts DESC`).
 */
async function getMyViewHistoryReal(
  ctx: Ctx,
  input: MyViewHistoryInput,
): Promise<MyViewHistoryOutput> {
  const intervalHours = WINDOW_HOURS[input.window];

  const events = await ctx.db.pg.query<AuditEvent>(
    `SELECT
       id,
       ts,
       actor_id,
       actor_display_name,
       actor_role,
       target_engineer_id,
       surface,
       reason,
       session_id
     FROM audit_events
     WHERE org_id = $1
       AND target_engineer_id = $2
       AND ts >= now() - ($3 || ' hours')::interval
     ORDER BY ts DESC
     LIMIT 500`,
    [ctx.tenant_id, ctx.actor_id, intervalHours],
  );

  const prefRows = await ctx.db.pg.query<{
    notification_pref: "daily_digest" | "immediate" | "opted_out";
  }>(
    `SELECT notification_pref
       FROM notification_prefs
      WHERE org_id = $1
        AND engineer_id = $2
      LIMIT 1`,
    [ctx.tenant_id, ctx.actor_id],
  );

  return {
    window: input.window,
    events,
    notification_pref: prefRows[0]?.notification_pref ?? "daily_digest",
  };
}

const WINDOW_HOURS: Record<MyViewHistoryInput["window"], number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};
