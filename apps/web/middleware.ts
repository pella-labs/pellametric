import { type NextRequest, NextResponse } from "next/server";

/**
 * Route `/` based on deployment mode.
 *
 * Priority:
 *   1. DASHBOARD_ENABLED=1 or NEXT_PUBLIC_DASHBOARD_ENABLED=1
 *      -> `/` renders the dashboard (local dev, future self-host with auth wired).
 *   2. NEXT_PUBLIC_IS_CLOUD=1 or running on Vercel (process.env.VERCEL=1)
 *      -> `/` rewrites to `/home` so visitors land on the marketing page.
 *   3. Anything else (i.e. plain `bun run dev`): `/` renders the dashboard.
 *      Keeps existing e2e tests (tests/e2e/*.e2e.ts) that hit `/` working.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname !== "/") return NextResponse.next();

  const dashboardEnabled =
    process.env.DASHBOARD_ENABLED === "1" || process.env.NEXT_PUBLIC_DASHBOARD_ENABLED === "1";

  if (dashboardEnabled) return NextResponse.next();

  const marketingMode = process.env.NEXT_PUBLIC_IS_CLOUD === "1" || process.env.VERCEL === "1";

  if (marketingMode) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
