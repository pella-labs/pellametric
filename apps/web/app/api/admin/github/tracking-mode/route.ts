import { AuthError, patchTrackingMode } from "@bematist/api";
import { PatchTrackingModeInput } from "@bematist/api/schemas/github/tracking";
import { type NextRequest, NextResponse } from "next/server";
import { getGithubRecomputeEmitter } from "@/lib/github/recomputeEmitter";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `PATCH /api/admin/github/tracking-mode`.
 *
 * Admin-only. Writes `orgs.github_repo_tracking_mode` and emits a
 * `session_repo_recompute` message per live session (D56).
 */
export async function PATCH(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  const parsed = PatchTrackingModeInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ctx = await getSessionCtx();
    const data = await patchTrackingMode(ctx, parsed.data, {
      recompute: await getGithubRecomputeEmitter(ctx),
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
