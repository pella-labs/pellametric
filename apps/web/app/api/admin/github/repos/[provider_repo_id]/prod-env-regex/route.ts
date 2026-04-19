import { AuthError, patchRepoProdEnvRegex } from "@bematist/api";
import { PatchRepoProdEnvRegexInput } from "@bematist/api/schemas/github/prodEnvRegex";
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD-github-integration §11.7 / D60 —
 * `PATCH /api/admin/github/repos/:provider_repo_id/prod-env-regex`.
 *
 * Admin-only. Writes `repos.prod_env_allowlist_regex`. Validates the
 * pattern compiles as a JavaScript RegExp; returns 400 on invalid input.
 *
 * Response includes a sample of environments observed in the last 30
 * days that match the new regex — for the admin UI preview panel.
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
  const parsed = PatchRepoProdEnvRegexInput.safeParse({
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
    const data = await patchRepoProdEnvRegex(ctx, parsed.data);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "UNAUTHORIZED" ? 401 : err.code === "BAD_REQUEST" ? 400 : 403;
      return NextResponse.json({ error: err.code.toLowerCase(), message: err.message }, { status });
    }
    const message = err instanceof Error ? err.message : "Unexpected server error.";
    return NextResponse.json({ error: "internal_server_error", message }, { status: 500 });
  }
}
