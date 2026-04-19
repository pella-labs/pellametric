"use server";
import {
  enqueueGithubSync,
  patchRepoTracking,
  patchTrackingMode,
  redeliverWebhooks,
  rotateWebhookSecret,
} from "@bematist/api";
import { RedeliverWebhooksInput } from "@bematist/api/schemas/github/redeliver";
import { EnqueueGithubSyncInput } from "@bematist/api/schemas/github/sync";
import {
  PatchRepoTrackingInput,
  PatchTrackingModeInput,
} from "@bematist/api/schemas/github/tracking";
import { RotateWebhookSecretInput } from "@bematist/api/schemas/github/webhookSecret";
import { revalidatePath } from "next/cache";
import {
  getGithubRecomputeEmitter,
  getGithubRepoRecomputeEmitter,
} from "@/lib/github/recomputeEmitter";
import { getGithubRedeliveryDeps } from "@/lib/github/redeliveryDeps";
import { getSessionCtx } from "@/lib/session";
import { zodAction } from "@/lib/zodActions";

/**
 * Server Actions for the 5 admin/github surfaces shipped in G2.
 *
 * Every action re-asserts admin role inside `packages/api` via
 * `assertRole(["admin"])` — the UI gate is a UX affordance, not the
 * security boundary. Every write action audit-logs the attempt.
 */
const _enqueueSyncAction = zodAction(EnqueueGithubSyncInput, enqueueGithubSync);

export async function enqueueSyncAction(raw: { installation_id?: string; force?: boolean }) {
  const result = await _enqueueSyncAction(raw);
  if (result.ok) {
    revalidatePath("/admin/github");
  }
  return result;
}

/** PATCH /api/admin/github/tracking-mode — wraps `patchTrackingMode`. */
export async function patchTrackingModeAction(raw: { mode: "all" | "selected" }) {
  const parsed = PatchTrackingModeInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        code: "BAD_REQUEST" as const,
        message: "Invalid input.",
        issues: parsed.error.issues,
      },
    };
  }
  try {
    const ctx = await getSessionCtx();
    const recompute = await getGithubRecomputeEmitter(ctx);
    const data = await patchTrackingMode(ctx, parsed.data, { recompute });
    revalidatePath("/admin/github");
    revalidatePath("/admin/github/repos");
    return { ok: true as const, data };
  } catch (err) {
    return errorResult(err);
  }
}

/** PATCH /api/admin/github/repos/:provider_repo_id/tracking. */
export async function patchRepoTrackingAction(raw: {
  provider_repo_id: string;
  state: "inherit" | "included" | "excluded";
}) {
  const parsed = PatchRepoTrackingInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        code: "BAD_REQUEST" as const,
        message: "Invalid input.",
        issues: parsed.error.issues,
      },
    };
  }
  try {
    const ctx = await getSessionCtx();
    const recompute = await getGithubRepoRecomputeEmitter(ctx);
    const data = await patchRepoTracking(ctx, parsed.data, { recompute });
    revalidatePath("/admin/github/repos");
    return { ok: true as const, data };
  } catch (err) {
    return errorResult(err);
  }
}

/** POST /api/admin/github/webhook-secret/rotate. */
export async function rotateWebhookSecretAction(raw: {
  new_secret_ref: string;
  installation_id?: string;
}) {
  const parsed = RotateWebhookSecretInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        code: "BAD_REQUEST" as const,
        message: "Invalid input.",
        issues: parsed.error.issues,
      },
    };
  }
  try {
    const ctx = await getSessionCtx();
    const data = await rotateWebhookSecret(ctx, parsed.data);
    revalidatePath("/admin/github");
    return { ok: true as const, data };
  } catch (err) {
    return errorResult(err);
  }
}

/** POST /api/admin/github/redeliver. */
export async function redeliverWebhooksAction(raw: {
  from: string;
  to: string;
  event_types?: string[];
  installation_id?: string;
}) {
  const parsed = RedeliverWebhooksInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        code: "BAD_REQUEST" as const,
        message: "Invalid input.",
        issues: parsed.error.issues,
      },
    };
  }
  try {
    const ctx = await getSessionCtx();
    const deps = await getGithubRedeliveryDeps();
    const data = await redeliverWebhooks(ctx, parsed.data, deps);
    revalidatePath("/admin/github");
    return { ok: true as const, data };
  } catch (err) {
    return errorResult(err);
  }
}

function errorResult(err: unknown) {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    "name" in err &&
    (err as { name: unknown }).name === "AuthError"
  ) {
    const e = err as { code: string; message?: string };
    const code = e.code as "UNAUTHORIZED" | "FORBIDDEN";
    return {
      ok: false as const,
      error: { code, message: e.message ?? "Auth error." },
    };
  }
  const message = err instanceof Error ? err.message : "Unexpected server error.";
  return {
    ok: false as const,
    error: { code: "INTERNAL_SERVER_ERROR" as const, message },
  };
}
