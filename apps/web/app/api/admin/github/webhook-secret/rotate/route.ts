import { AuthError, rotateWebhookSecret } from "@bematist/api";
import { RotateWebhookSecretInput } from "@bematist/api/schemas/github/webhookSecret";
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";

/**
 * PRD §14 — `POST /api/admin/github/webhook-secret/rotate`.
 *
 * Admin-only. Atomic two-column swap on `github_installations` — old secret
 * accepted for 10 minutes during dual-accept window (D55).
 */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Invalid JSON." }, { status: 400 });
  }
  const parsed = RotateWebhookSecretInput.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const ctx = await getSessionCtx();
    const data = await rotateWebhookSecret(ctx, parsed.data);
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
