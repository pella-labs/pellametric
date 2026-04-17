import { getSummary } from "@bematist/api";
import { DashboardSummaryInput } from "@bematist/api/schemas/dashboard";
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCtx } from "@/lib/session";

/**
 * Route Handler for client-fetched dashboard summary. Most reads go through
 * direct RSC imports; this endpoint exists so:
 *   (a) client components can polled-refresh the summary without full RSC
 *       reload, and
 *   (b) the CLI (`bematist outcomes`) consumes the same surface.
 */
export async function GET(req: NextRequest) {
  const parsed = DashboardSummaryInput.safeParse({
    window: req.nextUrl.searchParams.get("window") ?? "7d",
    team_id: req.nextUrl.searchParams.get("team_id") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const ctx = await getSessionCtx();
  const data = await getSummary(ctx, parsed.data);
  return NextResponse.json(data);
}
