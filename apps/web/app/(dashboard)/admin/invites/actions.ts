"use server";
import { createInvite, revokeInvite } from "@bematist/api";
import { CreateInviteInput, RevokeInviteInput } from "@bematist/api/schemas/invite";
import { revalidatePath } from "next/cache";
import { zodAction } from "@/lib/zodActions";

/**
 * Server Actions for the admin invites surface.
 *
 * Both wrap `zodAction` so:
 *   - input is zod-validated against the canonical schema in
 *     `packages/api/src/schemas/invite.ts`,
 *   - the session `Ctx` is resolved once, then passed to the mutation,
 *   - errors come back as `{ ok: false, error: { code, message } }`.
 *
 * `revalidatePath` flushes the RSC cache so the list re-renders with the
 * new / revoked invite on the next navigation.
 *
 * SECURITY: the mutation body re-asserts `admin` via `assertRole(ctx, …)`
 * inside `packages/api`. A forged fetch with a non-admin session still hits
 * `AuthError(FORBIDDEN)` — the layout gate is UX, not the security boundary.
 */

const _createInviteAction = zodAction(CreateInviteInput, createInvite);
const _revokeInviteAction = zodAction(RevokeInviteInput, revokeInvite);

export async function createInviteAction(raw: {
  role?: "admin" | "ic";
  expires_in_days?: number;
  max_uses?: number | null;
}) {
  const result = await _createInviteAction(raw);
  if (result.ok) {
    revalidatePath("/admin/invites");
  }
  return result;
}

export async function revokeInviteAction(raw: { id: string }) {
  const result = await _revokeInviteAction(raw);
  if (result.ok) {
    revalidatePath("/admin/invites");
  }
  return result;
}
