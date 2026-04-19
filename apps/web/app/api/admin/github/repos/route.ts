import { AuthError, listGithubRepos } from "@bematist/api";
import { ListGithubReposInput } from "@bematist/api/schemas/github/repos";
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `GET /api/admin/github/repos`.
 *
 * Paginated list of repos for the admin UI's repo table. Read-only in G1;
 * tracking-mode PATCH + per-repo PATCH ship in G2-admin-apis.
 */
export async function GET(req: NextRequest) {
  const parsed = ListGithubReposInput.safeParse({
    page: Number(req.nextUrl.searchParams.get("page") ?? "1"),
    per_page: Number(req.nextUrl.searchParams.get("per_page") ?? "50"),
    q: req.nextUrl.searchParams.get("q") ?? undefined,
    include_archived: req.nextUrl.searchParams.get("include_archived") === "true",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ctx = await getSessionCtx();
    const data = await listGithubRepos(ctx, parsed.data);
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
