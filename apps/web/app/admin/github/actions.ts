"use server";
import { enqueueGithubSync } from "@bematist/api";
import { EnqueueGithubSyncInput } from "@bematist/api/schemas/github/sync";
import { revalidatePath } from "next/cache";
import { zodAction } from "@/lib/zodActions";

/**
 * Server Action for the "Start sync" button on the `/admin/github` page.
 *
 * Wraps the `enqueueGithubSync` mutation. The mutation writes an
 * `audit_log` row + re-asserts admin role inside `packages/api` — the UI
 * gate is a UX affordance, not the security boundary.
 */
const _enqueueSyncAction = zodAction(EnqueueGithubSyncInput, enqueueGithubSync);

export async function enqueueSyncAction(raw: { installation_id?: string; force?: boolean }) {
  const result = await _enqueueSyncAction(raw);
  if (result.ok) {
    revalidatePath("/admin/github");
  }
  return result;
}
