import { AuthError, enqueueGithubSync } from "@bematist/api";
import { EnqueueGithubSyncInput } from "@bematist/api/schemas/github/sync";
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `POST /api/admin/github/sync`.
 *
 * Enqueues an initial sync / manual reconciliation. Admin-only.
 * Body is optional; `{ force: true }` re-walks from page 1.
 */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    // Body may be empty for the common "just run sync" click.
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  const parsed = EnqueueGithubSyncInput.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ctx = await getSessionCtx();
    const data = await enqueueGithubSync(ctx, parsed.data);
    return NextResponse.json(data, { status: 202 });
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "UNAUTHORIZED" ? 401 : 403;
      return NextResponse.json({ error: err.code.toLowerCase(), message: err.message }, { status });
    }
    const message = err instanceof Error ? err.message : "Unexpected server error.";
    return NextResponse.json({ error: "internal_server_error", message }, { status: 500 });
  }
}
