import { assertRole, type Ctx } from "../auth";
import type { SetNotificationPrefInput, SetNotificationPrefOutput } from "../schemas/policy";

/**
 * Update the IC's manager-view notification preference (D30).
 *
 * Defaults are chosen for transparency — daily digest is always free, never a
 * premium feature. Engineers can flip to `immediate` or `off`, but opting out
 * is an IC-local change that never lowers what managers can see; it only
 * changes whether the IC is pinged.
 *
 * M1 status: the shape is locked; the body is fixture-level until Walid's PG
 * policies table + audit_log sink land. Writing a no-op return that mirrors
 * the stored value keeps the Server Action + dialog code path round-trippable
 * in dev.
 */
export async function setNotificationPref(
  ctx: Ctx,
  input: SetNotificationPrefInput,
): Promise<SetNotificationPrefOutput> {
  // ICs set their own pref; admins can set org-level defaults (not modeled
  // here — separate admin module).
  assertRole(ctx, ["engineer", "admin"]);

  // TODO(B4.x): replace with:
  //   UPDATE developers SET notification_pref=$1, updated_at=NOW()
  //     WHERE org_id=$2 AND engineer_id=$3 RETURNING updated_at
  //   INSERT INTO audit_log (actor_id, target_engineer, surface='policy', before, after, ts)

  return {
    manager_view: input.manager_view,
    updated_at: new Date().toISOString(),
  };
}
