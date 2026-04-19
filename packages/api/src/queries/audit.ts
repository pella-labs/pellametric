import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import type { MyViewHistoryInput, MyViewHistoryOutput } from "../schemas/audit";

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
 * Real-branch Postgres read. Stubbed to empty until the query columns are
 * re-aligned with the actual `audit_events` schema (uses hashed identifiers
 * — `target_engineer_id_hash`, `session_id_hash`, no `actor_display_name`
 * or `actor_role` columns) and the `notification_prefs` table is actually
 * created. Tracked as an M4 follow-up — see `dev-docs/m4-team-demo-plan.md`.
 */
async function getMyViewHistoryReal(
  _ctx: Ctx,
  input: MyViewHistoryInput,
): Promise<MyViewHistoryOutput> {
  return {
    window: input.window,
    events: [],
    notification_pref: "daily_digest",
  };
}

const _WINDOW_HOURS: Record<MyViewHistoryInput["window"], number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};
