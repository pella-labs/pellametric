import { AuthError, assertRole, type Ctx } from "../auth";
import type { RevealInput, RevealOutput } from "../schemas/session";

/**
 * Reveal a session's prompt text. Enforces the three-conditions check (D8):
 *   1. IC opted into project-scope Tier C, OR
 *   2. Admin flipped tenant-wide signed-config Tier C (7d cooldown elapsed +
 *      IC banner shown), OR
 *   3. Auditor role with an active legal-hold flag.
 *
 * On success, writes an immutable `audit_log` row AND a per-view `audit_events`
 * row (D30 — surfaces in the IC's daily digest) and returns a single-use
 * 15-minute reveal token stored in Redis.
 *
 * M1 status: this body is still a stub — Walid's auth + Jorge's audit tables
 * are prerequisites. The shape is locked so the Server Action + UI dialog can
 * be built against the final interface. Throws `FORBIDDEN` until the three
 * conditions can actually be checked against Postgres state.
 */
export async function revealSession(ctx: Ctx, input: RevealInput): Promise<RevealOutput> {
  assertRole(ctx, ["manager", "admin", "auditor"]);

  // TODO(B4): once Walid's Better Auth session + Jorge's RLS land, replace the
  // unconditional throw below with the three-conditions check.
  //
  // Condition 1: engineer-opt-in →
  //   SELECT 1 FROM tier_c_optins WHERE engineer_id=? AND project_id=?
  // Condition 2: tenant signed-config with cooldown elapsed →
  //   SELECT config_signed_at FROM tier_c_configs WHERE tenant_id=? AND elapsed_days >= 7
  //   AND banner_ack=true
  // Condition 3: auditor role + active legal hold →
  //   SELECT 1 FROM legal_holds WHERE target=? AND status='active'
  //
  // If any condition holds:
  //   INSERT INTO audit_log (actor_id, target_engineer, session_id, reason, ts) VALUES (...)
  //   INSERT INTO audit_events (actor_id, target_engineer, surface='reveal_prompt', session_id, reason, ts)
  //   SETEX reveal:<random_token> 900 <session_id>:<actor_id>
  //   return { reveal_token, expires_at }
  void input; // suppress unused-arg until the real body lands
  throw new AuthError(
    "FORBIDDEN",
    "Reveal requires one of: IC opt-in at project scope, tenant-wide signed Tier-C config, or active legal hold.",
  );
}
