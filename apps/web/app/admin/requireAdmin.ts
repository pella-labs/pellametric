import "server-only";
import { getSessionCtx } from "@/lib/session";

/**
 * Server-side admin admission. Returns a discriminated result so the caller
 * (admin layout) can call `redirect()` at its own discretion — callers that
 * want to branch (e.g. a 404 surface) can read `role` and handle differently.
 *
 * Keep this thin — the query/mutation layer enforces role via `assertRole()`
 * regardless. This exists to convert "role mismatch" into "send to `/`"
 * instead of rendering the admin chrome and crashing on the first data call.
 */
export type AdminAdmission =
  | { ok: true; tenant_id: string; actor_id: string }
  | { ok: false; redirectTo: "/" };

export async function requireAdmin(): Promise<AdminAdmission> {
  const ctx = await getSessionCtx();
  if (ctx.role !== "admin") {
    return { ok: false, redirectTo: "/" };
  }
  return { ok: true, tenant_id: ctx.tenant_id, actor_id: ctx.actor_id };
}
