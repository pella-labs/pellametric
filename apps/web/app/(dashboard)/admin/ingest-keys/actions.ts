"use server";
import { createIngestKey, revokeIngestKey } from "@bematist/api";
import { CreateIngestKeyInput, RevokeIngestKeyInput } from "@bematist/api/schemas/ingestKey";
import { revalidatePath } from "next/cache";
import { zodAction } from "@/lib/zodActions";

/**
 * Server Actions for the admin ingest-keys surface.
 *
 * Both wrap `zodAction` so:
 *   - input is zod-validated against the canonical schema in
 *     `packages/api/src/schemas/ingestKey.ts`,
 *   - the session `Ctx` is resolved once, then passed to the mutation,
 *   - errors come back as `{ ok: false, error: { code, message } }` —
 *     the client UI switches on `ok` and never has to try/catch over the
 *     `"use server"` boundary.
 *
 * `revalidatePath` is called after both mutations so the RSC list picks up
 * the new / revoked key on the next navigation (no stale cache).
 *
 * SECURITY: the mutation body re-asserts `admin` via `assertRole(ctx, …)`
 * inside `packages/api`. A forged fetch hitting this action with a
 * non-admin session still hits `AuthError(FORBIDDEN)` — the layout gate is
 * a UX affordance, not the security boundary.
 */

const _createIngestKeyAction = zodAction(CreateIngestKeyInput, createIngestKey);
const _revokeIngestKeyAction = zodAction(RevokeIngestKeyInput, revokeIngestKey);

export async function createIngestKeyAction(raw: {
  engineer_id: string;
  name: string;
  tier_default?: "A" | "B";
}) {
  const result = await _createIngestKeyAction(raw);
  if (result.ok) {
    revalidatePath("/admin/ingest-keys");
  }
  return result;
}

export async function revokeIngestKeyAction(raw: { id: string }) {
  const result = await _revokeIngestKeyAction(raw);
  if (result.ok) {
    revalidatePath("/admin/ingest-keys");
  }
  return result;
}
