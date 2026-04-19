import { AuthError, getTrackingPreview } from "@bematist/api";
import { TrackingPreviewInput } from "@bematist/api/schemas/github/tracking";
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `GET /api/admin/github/tracking-preview`.
 *
 * Dry-run projection. Admin-only. No writes, no audit_log row.
 */
export async function GET(req: NextRequest) {
  const parsed = TrackingPreviewInput.safeParse({
    mode: req.nextUrl.searchParams.get("mode") ?? undefined,
    included_repos: req.nextUrl.searchParams.get("included_repos") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ctx = await getSessionCtx();
    const data = await getTrackingPreview(ctx, parsed.data);
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
