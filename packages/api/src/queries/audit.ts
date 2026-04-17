import { assertRole, type Ctx } from "../auth";
import type {
  MyViewHistoryInput,
  MyViewHistoryOutput,
} from "../schemas/audit";

/**
 * Return the list of manager drills into the caller's surfaces within the
 * requested window. Backs the `/me/digest` page.
 *
 * Engineers can always view their own history. Admins/auditors can view
 * anyone's, but this query is narrowed to the caller (the `/engineer/:id`
 * history for other roles is a separate query).
 */
export async function getMyViewHistory(
  ctx: Ctx,
  _input: MyViewHistoryInput,
): Promise<MyViewHistoryOutput> {
  assertRole(ctx, ["engineer", "admin", "auditor"]);

  // Fixture-backed stub until Walid's audit_events writer lands.
  // Empty history is the realistic M1 state — nobody has revealed anything yet.
  return {
    window: _input.window,
    events: [],
    notification_pref: "daily_digest",
  };
}
