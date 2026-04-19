import { AuthError, getGithubConnection } from "@bematist/api";
import { NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `GET /api/admin/github/connection`.
 *
 * Returns the installation + sync-progress state so the admin UI polls
 * this endpoint during an active sync. Admin-only; the underlying query
 * re-asserts role, so a forged fetch without the admin cookie hits 403 at
 * the query layer rather than succeeding through a framework bypass.
 */
export async function GET() {
  try {
    const ctx = await getSessionCtx();
    const data = await getGithubConnection(ctx, {});
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
