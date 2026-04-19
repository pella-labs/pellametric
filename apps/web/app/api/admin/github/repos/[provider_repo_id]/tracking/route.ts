import { AuthError, patchRepoTracking } from "@bematist/api";
import { PatchRepoTrackingInput } from "@bematist/api/schemas/github/tracking";
import { type NextRequest, NextResponse } from "next/server";
import { getGithubRepoRecomputeEmitter } from "@/lib/github/recomputeEmitter";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `PATCH /api/admin/github/repos/:provider_repo_id/tracking`.
 *
 * Admin-only. Writes `repos.tracking_state` and emits a scoped recompute
 * message for sessions whose enrichment set intersects this repo (D56).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ provider_repo_id: string }> },
) {
  const { provider_repo_id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  const parsed = PatchRepoTrackingInput.safeParse({
    provider_repo_id,
    ...((body as Record<string, unknown>) ?? {}),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ctx = await getSessionCtx();
    const data = await patchRepoTracking(ctx, parsed.data, {
      recompute: await getGithubRepoRecomputeEmitter(ctx),
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "UNAUTHORIZED" ? 401 : 403;
      return NextResponse.json({ error: err.code.toLowerCase(), message: err.message }, { status });
    }
    const message = err instanceof Error ? err.message : "Unexpected server error.";
    return NextResponse.json({ error: "internal_server_error", message }, { status: 500 });
  }
}
