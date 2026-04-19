import { AuthError, redeliverWebhooks } from "@bematist/api";
import { RedeliverWebhooksInput } from "@bematist/api/schemas/github/redeliver";
import { type NextRequest, NextResponse } from "next/server";
import { getGithubRedeliveryDeps } from "@/lib/github/redeliveryDeps";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `POST /api/admin/github/redeliver`.
 *
 * Replay webhooks in a time range. Admin-only. Audit-logged.
 */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  const parsed = RedeliverWebhooksInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ctx = await getSessionCtx();
    const deps = await getGithubRedeliveryDeps();
    const data = await redeliverWebhooks(ctx, parsed.data, deps);
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
